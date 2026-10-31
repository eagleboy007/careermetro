import { roleProfiles, skills } from "@/content";
import { profileMatcher, type MatchedSkill } from "@/lib/gaps/match";
import { formatExperience } from "@/lib/role-view";
import {
  NEARBY_MAX,
  NEARBY_MIN_SHARE,
  NEARBY_MIN_SHARED,
  nearbyLines,
  type NearbyLine,
  type NearbyLines,
  type Profile,
  type RoleProfile,
} from "@/lib/schemas";

export type NearbyInput = {
  profile: Profile;
  /** The person's target role: never a Nearby line of itself. */
  targetSlug: string;
  /** The live role profiles (the same list the role picker offers). */
  roles?: RoleProfile[];
  /** Skills with current accepted proof. Proof is per skill, so it carries over to every role. */
  proved?: ReadonlySet<string>;
  /** The skills of the goals on the person's line, in line order, for where a Nearby line crosses it on the Map. */
  lineSkillIds?: string[];
  now?: Date;
};

const skillNames = new Map(skills.map((s) => [s.id, s.name]));

/** A role's required skills, for how alike two roles are. */
const requiredIds = (role: RoleProfile) => new Set(role.skills.filter((s) => s.importance === "required").map((s) => s.skillId));
/** Shared required skills over all required skills of the two roles (0 to 1). */
const likeness = (a: Set<string>, b: Set<string>) => {
  let both = 0;
  for (const id of a) if (b.has(id)) both++;
  return both / (a.size + b.size - both || 1);
};
/** Communication, problem solving and the like: they count when shown, but never decide which role is nearest. */
const contextIds = new Set(skills.filter((s) => s.scoring === "context").map((s) => s.id));

/** Whether one skill implies another, directly or through a chain (pivot tables → Excel). */
const impliesById = new Map(skills.map((s) => [s.id, s.implies]));
const implies = (from: string, to: string, seen = new Set<string>()): boolean =>
  (impliesById.get(from) ?? []).some((id) => id === to || (!seen.has(id) && (seen.add(id), implies(id, to, seen))));

/** The skills a matcher row stands for: a "one of these" group's skills, or the one skill. */
const unitSkills = (row: MatchedSkill) => row.group?.skillIds ?? [row.skillId];

/**
 * Nearby lines (pending item 24a, dev/nearby-lines-plan.md): the live roles that share at least half their key skills
 * with the person, and at least two. Plain code over the same deterministic matcher as the Gaps page, so "shares 6 of
 * its 9 key skills" says exactly what that role's Gaps page would. Only skills with evidence (or current accepted proof)
 * are shared; listed-only ones are kept apart. Nothing here changes goals, gaps or the match.
 */
export function nearbyLinesFor({ profile, targetSlug, roles = roleProfiles, proved = new Set(), lineSkillIds = [], now = new Date() }: NearbyInput): NearbyLines {
  const years = profile.totalYearsExperience ?? 0;
  const target = roles.find((r) => r.slug === targetSlug) ?? roleProfiles.find((r) => r.slug === targetSlug);
  const targetIds = target ? requiredIds(target) : new Set<string>();
  // The resume is read once for every role (T161): a long one read 150 times took the Map and Me past 10 s.
  const matchRole = profileMatcher(profile, now);
  const scored = roles
    .filter((r) => r.slug !== targetSlug)
    .map((role) => {
      const match = matchRole(role);
      const byProof = (row: MatchedSkill) => unitSkills(row).some((id) => proved.has(id));
      const open = match.gaps.filter((g) => !byProof(g));
      const sharedSkills = [
        ...match.met.map((m) => ({ name: m.skillName, byProof: false })),
        // A "one of these" group filled by proof is named by the proved skill, not by the group's label.
        ...match.gaps.filter(byProof).map((g) => {
          const provedId = g.group?.skillIds.find((id) => proved.has(id));
          return { name: provedId ? (skillNames.get(provedId) ?? g.skillName) : g.skillName, byProof: true };
        }),
      ];
      const openIds = new Set(open.flatMap(unitSkills));
      const line: NearbyLine = {
        slug: role.slug,
        title: role.title,
        experience: formatExperience(role.experienceBand),
        shared: sharedSkills.length,
        total: match.readiness.requiredTotal,
        sharedSkills,
        onResume: open.filter((g) => g.status === "weak").map((g) => g.skillName),
        toAdd: open.filter((g) => g.status !== "weak").map((g) => ({ name: g.skillName, outdated: g.status === "outdated" })),
        crossSkillIds: lineSkillIds.filter((id, i) => openIds.has(id) && lineSkillIds.indexOf(id) === i),
      };
      // Key skills: the role's required skills without any context one (shown or not), so a role can't come first on
      // "communication" alone and listing it never raises a share (T154). The matcher drops a context skill the resume
      // doesn't show, so counting from its rows leaves out every required context skill.
      const isKey = (row: MatchedSkill) => !contextIds.has(row.skillId);
      const key = match.met.filter(isKey).length + match.gaps.filter((g) => isKey(g) && byProof(g)).length;
      const keyTotal = match.met.filter(isKey).length + match.gaps.filter(isKey).length;
      // Shared key skills as separate abilities: one a shared skill implies isn't counted again, so Excel and pivot
      // tables are one, and a role can't be closest on them alone (business batch B1: Telecom RAN for a sales resume).
      const keyIds = [...match.met.filter(isKey), ...match.gaps.filter((g) => isKey(g) && byProof(g))].map((r) => r.skillId);
      const keyAbilities = keyIds.filter((id) => !keyIds.some((other) => other !== id && implies(other, id))).length;
      return {
        line,
        key,
        keyTotal,
        keyAbilities,
        keyShare: keyTotal ? key / keyTotal : 0,
        // How many of the resume's shown skills the role asks for at all, nice-to-have ones included.
        asks: key + match.niceToHave.filter((n) => n.status === "met" && !contextIds.has(n.skillId)).length,
        share: line.total ? line.shared / line.total : 0,
        // A year's grace, as role suggestions give: a role asking for more years than that goes after the ones that fit.
        fits: years >= role.experienceBand.minYears - 1,
        // How alike the role is to the one the person is heading for: breaks ties between roles that share as much.
        like: likeness(targetIds, requiredIds(role)),
      };
    })
    .filter((s) => s.line.total > 0)
    .sort(
      (a, b) =>
        Number(b.fits) - Number(a.fits) ||
        b.keyShare - a.keyShare ||
        b.asks - a.asks ||
        b.share - a.share ||
        b.line.shared - a.line.shared ||
        a.line.toAdd.length - b.line.toAdd.length ||
        b.like - a.like ||
        a.line.title.localeCompare(b.line.title),
    );

  // Near on key skills: a role isn't near because the resume shows communication. The line still shows every shared skill.
  const near = scored.filter((s) => s.keyShare >= NEARBY_MIN_SHARE && s.key >= NEARBY_MIN_SHARED).slice(0, NEARBY_MAX);
  if (near.length) return nearbyLines.parse({ lines: near.map((s) => s.line), closest: null });
  // Closest when none is near: a role whose years fit first, as for the lines (T154), then the one holding the most of
  // the resume's key skills (half for each one only listed), at least two, then the one asking for more of the resume,
  // then share, then likeness to the target role. Two shared skills where one implies the other count as one, so the
  // role must share two separate abilities. So a small role sharing 2 of its 6 doesn't beat a larger one the
  // resume holds as much of, and one shared skill names nothing (src/evals/closest-eval.test.ts). The sentence counts
  // key skills, as the filter above does, so it never says a role shares half while saying none does.
  const held = (s: (typeof scored)[number]) => s.key + s.line.onResume.length / 2;
  const best = scored
    .filter((s) => s.keyAbilities >= NEARBY_MIN_SHARED && s.keyTotal > 0)
    .sort(
      (a, b) =>
        Number(b.fits) - Number(a.fits) ||
        held(b) - held(a) ||
        b.asks - a.asks ||
        b.share - a.share ||
        b.like - a.like ||
        a.line.title.localeCompare(b.line.title),
    )[0];
  return nearbyLines.parse({
    lines: [],
    closest: best ? { slug: best.line.slug, title: best.line.title, shared: best.key, total: best.keyTotal } : null,
  });
}
