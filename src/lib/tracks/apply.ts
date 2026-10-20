import { roleTracks as allRoleTracks, skills } from "@/content";
import { OUTDATED_AFTER_YEARS } from "@/lib/gaps/match";
import { MAX_GAPS, requiredUnits, trackPicker, type Gap, type GapAnalysis, type RoleProfile, type RoleTrack, type RoleTracks, type TrackOption, type TrackPicker } from "@/lib/schemas";
import { clip } from "@/lib/text";

/*
 * Tracks on Your goals (v44 gap list item 11, docs/plans/tracks-plan.md), in plain code over the person's stored gap
 * analysis: it already holds every required gap of the role, the met skills and where the resume stands on each
 * nice-to-have, so a track's goals are worked out without reading the resume again and without the model.
 */

const skillName = new Map(skills.map((s) => [s.id, s.name]));

/** The tracks a role offers: reviewed ones only, unless unreviewed content is allowed (local and preview deployments). */
export function allowedTracks(roleSlug: string, allowUnreviewed: boolean, all: readonly RoleTracks[] = allRoleTracks): RoleTrack[] {
  return (all.find((r) => r.roleSlug === roleSlug)?.tracks ?? []).filter((t) => t.reviewed || allowUnreviewed);
}

/** The role as the track sees it: the skills the track adds are required, the ones it drops are nice to have. */
export function trackedRole<R extends Pick<RoleProfile, "skills" | "groups">>(role: R, track: RoleTrack | null): R {
  if (!track) return role;
  return {
    ...role,
    skills: role.skills.map((s) =>
      track.add.includes(s.skillId) ? { ...s, importance: "required" as const } : track.drop.includes(s.skillId) ? { ...s, importance: "nice_to_have" as const } : s,
    ),
  };
}

/** Where a skill goes on the track's line: the track's `first` skills in their order, then everything else. */
export function trackRank(track: RoleTrack | null): (skillId: string) => number {
  const at = new Map((track?.first ?? []).map((id, i) => [id, i]));
  return (skillId) => at.get(skillId) ?? at.size;
}

/** Items in the track's order, keeping their own order otherwise. Unchanged with no track. */
export function orderForTrack<T extends { skillId: string }>(items: readonly T[], track: RoleTrack | null): T[] {
  const rank = trackRank(track);
  return items
    .map((item, i) => ({ item, i }))
    .sort((a, b) => rank(a.item.skillId) - rank(b.item.skillId) || a.i - b.i)
    .map(({ item }) => item);
}

/** "Write joins..." as it reads after "expects you to". */
const task = (expectation: string) => expectation.replace(/\.$/, "").replace(/^(\p{Lu})(?=\p{Ll})/u, (c) => c.toLowerCase());

/** Plain words for a gap a track adds. The stored analysis keeps no resume line for a nice-to-have, so none is quoted. */
export function trackGapExplanation(name: string, status: Gap["status"], expectation: string): string {
  const expects = `This track expects you to ${task(expectation)}.`;
  switch (status) {
    case "missing":
      return `Nothing in your resume shows ${name}. ${expects}`;
    case "weak":
      return `Your resume mentions ${name}, but not enough to count it as shown. ${expects}`;
    case "outdated":
      return `The latest use of ${name} on your resume is more than ${OUTDATED_AFTER_YEARS} years old. ${expects}`;
  }
}

/**
 * The analysis as the track sees it. Gaps the track drops leave the gaps (and become nice to have); nice-to-haves it
 * adds become gaps, or count as met when the resume shows them; then the track's `first` skills lead. A nice-to-have
 * the stored analysis has no status for (a skill only Practice can judge) never becomes a gap, as in the matcher.
 * "One of these" groups are never dropped or added. With no track the analysis is returned as it is.
 */
export function applyTrack(result: GapAnalysis, role: Pick<RoleProfile, "skills">, track: RoleTrack | null): GapAnalysis {
  if (!track) return result;
  const drop = new Set(track.drop);
  const add = new Set(track.add);
  const nice = new Map(result.niceToHave.map((n) => [n.skillId, n]));
  const expectation = new Map(role.skills.map((s) => [s.skillId, s.expectation]));
  const kept = result.gaps.filter((g) => g.groupId !== undefined || !drop.has(g.skillId));
  const added: Gap[] = [];
  const addedMet: string[] = [];
  for (const id of track.add) {
    const n = nice.get(id);
    if (!n || result.gaps.some((g) => g.skillId === id)) continue;
    if (n.status === "met") {
      addedMet.push(id);
      continue;
    }
    added.push({
      skillId: id,
      skillName: n.skillName,
      status: n.status,
      resumeQuote: null,
      requirement: expectation.get(id) ?? n.skillName,
      explanation: trackGapExplanation(n.skillName, n.status, expectation.get(id) ?? n.skillName),
    });
  }
  const dropped = result.gaps
    .filter((g) => g.groupId === undefined && drop.has(g.skillId))
    .map((g) => ({ skillId: g.skillId, skillName: g.skillName, status: g.status }));
  const droppedMet = track.drop
    .filter((id) => result.metSkillIds.includes(id))
    .map((id) => ({ skillId: id, skillName: skillName.get(id) ?? id, status: "met" as const }));
  return {
    ...result,
    gaps: orderForTrack([...kept, ...added], track).slice(0, MAX_GAPS),
    metSkillIds: [...result.metSkillIds, ...addedMet.filter((id) => !result.metSkillIds.includes(id))],
    niceToHave: [...result.niceToHave.filter((n) => !add.has(n.skillId)), ...dropped, ...droppedMet],
  };
}

const WHOLE_ROLE_BLURB = "Every skill the role profile asks for";

/**
 * The Track picker on Your goals: the whole role first, then the role's tracks, each with its goal count (met ones
 * included: shown on the resume or proved) and its first open goals for the preview. Null when the role has no tracks
 * to offer. `current` is the track in use (null for the whole role); one that isn't offered reads as the whole role.
 */
export function trackPickerFor(input: {
  base: GapAnalysis;
  role: Pick<RoleProfile, "title" | "skills" | "groups">;
  tracks: readonly RoleTrack[];
  current: string | null;
  provedSkillIds: ReadonlySet<string>;
}): TrackPicker | null {
  if (!input.tracks.length) return null;
  const { base, role, provedSkillIds: proved } = input;
  const option = (track: RoleTrack | null): TrackOption => {
    const tracked = applyTrack(base, role, track);
    const met = new Set([...tracked.metSkillIds, ...proved]);
    const groupSkills = (groupId: string) => role.skills.filter((s) => s.oneOf === groupId).map((s) => s.skillId);
    const open = tracked.gaps.filter((g) => !(g.groupId ? groupSkills(g.groupId) : [g.skillId]).some((id) => proved.has(id)));
    const metUnits = requiredUnits(trackedRole(role, track)).filter((unit) => unit.some((id) => met.has(id))).length;
    const firstGoals = open.slice(0, 3).map((g) => clip(g.skillName, 80));
    return {
      id: track?.id ?? null,
      name: clip(track?.name ?? role.title, 60),
      blurb: track?.blurb ?? WHOLE_ROLE_BLURB,
      goals: Math.min(40, open.length + metUnits),
      met: Math.min(40, metUnits),
      firstGoals,
      moreGoals: Math.min(40, open.length - firstGoals.length),
    };
  };
  const current = input.tracks.some((t) => t.id === input.current) ? input.current : null;
  return trackPicker.parse({ role: clip(role.title, 80), current, options: [option(null), ...input.tracks.map(option)] });
}
