import { skillGroupMembers } from "@/content";
import { matchProfile } from "@/lib/gaps/match";
import type { GapAnalysis, GapStatus, Profile, RoleProfile } from "@/lib/schemas";

/**
 * "Check against a job" (role-suggest-plan.md part B), in plain code. The target role from our library stays the
 * ideal and its gaps stay the person's goals; one pasted posting only shows what that job adds. Nothing here changes
 * goals, the match, the analysis or the train: the posting's skills are matched by the same deterministic matcher, as
 * a role of their own, and set beside the stored target analysis.
 */

/** A saved job check as stored: the skills the posting asks for, never its text. */
export type StoredJobCheck = {
  id: string;
  company: string;
  title: string;
  requiredSkillIds: string[];
  niceSkillIds: string[];
  unknownSkills: string[];
  createdAt: Date;
};

export type JobCheckSkill = { skillId: string; skillName: string; status: GapStatus };

/** One saved check as the Gaps page shows it. Plain data, so the client and /design can render it. */
export type JobCheckView = {
  id: string;
  company: string;
  title: string;
  /** ISO date-time the check was saved. */
  createdAt: string;
  /** Skills the posting asks for that the resume already shows, or that accepted proof covers. */
  covered: (Omit<JobCheckSkill, "status"> & { by: "resume" | "proof" })[];
  /** Posting skills that are also gaps of the target role: the person's goals, which this job asks for too. */
  alsoGoals: JobCheckSkill[];
  /** Posting skills that are gaps for this job only. They never become goals or change the match on their own. */
  onlyThisJob: JobCheckSkill[];
  /** Target-role gaps this posting doesn't mention. They stay goals. */
  notAsked: Omit<JobCheckSkill, "status">[];
  /** The posting's nice-to-haves, never counted as gaps. */
  goodToHave: JobCheckSkill[];
  /** Skills the posting names that our skill list doesn't have yet. Not scored. */
  unknown: string[];
};

export const POSTING_REQUIREMENT = "Asked for in this job posting";
export const POSTING_NICE = "Good to have in this job posting";

/**
 * The posting as a role profile for the matcher: its required and nice-to-have skills, with no posting shares and no
 * "one of these" groups. Never validated against the library's rules (a posting may name fewer than three skills).
 */
export function postingRole(check: Pick<StoredJobCheck, "requiredSkillIds" | "niceSkillIds">, today = new Date()): RoleProfile {
  const required = new Set(check.requiredSkillIds);
  return {
    slug: "job-check",
    title: "This job",
    experienceBand: { minYears: 0, maxYears: 50 },
    skills: [
      ...check.requiredSkillIds.map((skillId) => ({ skillId, importance: "required" as const, expectation: POSTING_REQUIREMENT, postingShare: null })),
      ...check.niceSkillIds
        .filter((id) => !required.has(id))
        .map((skillId) => ({ skillId, importance: "nice_to_have" as const, expectation: POSTING_NICE, postingShare: null })),
    ],
    groups: [],
    certifications: [],
    sources: [{ description: "A job posting the person pasted", url: null }],
    reviewedBy: null,
    updatedOn: today.toISOString().slice(0, 10),
  };
}

/** The skills a target gap stands for: its own, or every skill of its "one of these" group. */
function gapSkills(gap: GapAnalysis["gaps"][number], members: ReadonlyMap<string, string[]>): string[] {
  return gap.groupId ? [gap.skillId, ...(members.get(gap.groupId) ?? [])] : [gap.skillId];
}

/**
 * The groups of one saved check: the posting matched against the confirmed profile, set beside the target role's
 * stored gaps. `proved` holds the skills with current accepted proof (an account's only; empty for anyone else).
 * The order within each group follows the posting.
 */
export function jobCheckView(
  check: StoredJobCheck,
  profile: Profile,
  target: Pick<GapAnalysis, "gaps">,
  proved: ReadonlySet<string> = new Set(),
  { now = new Date(), members = skillGroupMembers }: { now?: Date; members?: ReadonlyMap<string, string[]> } = {},
): JobCheckView {
  const match = matchProfile(profile, postingRole(check, now), now);
  const met = new Map(match.met.map((m) => [m.skillId, m]));
  const gaps = new Map(match.gaps.map((g) => [g.skillId, g]));
  const targetGapSkills = new Set(target.gaps.flatMap((g) => gapSkills(g, members)));

  const view: JobCheckView = {
    id: check.id,
    company: check.company,
    title: check.title,
    createdAt: check.createdAt.toISOString(),
    covered: [],
    alsoGoals: [],
    onlyThisJob: [],
    notAsked: [],
    goodToHave: [],
    unknown: check.unknownSkills,
  };
  for (const skillId of new Set(check.requiredSkillIds)) {
    const shown = met.get(skillId);
    const gap = gaps.get(skillId);
    if (shown) view.covered.push({ skillId, skillName: shown.skillName, by: "resume" });
    else if (gap && proved.has(skillId)) view.covered.push({ skillId, skillName: gap.skillName, by: "proof" });
    else if (gap) (targetGapSkills.has(skillId) ? view.alsoGoals : view.onlyThisJob).push({ skillId, skillName: gap.skillName, status: gap.status });
    // A context skill (communication) the resume doesn't show is never a gap: the matcher leaves it out, and so do we.
  }
  view.goodToHave = match.niceToHave.map((n) => ({
    skillId: n.skillId,
    skillName: n.skillName,
    status: n.status !== "met" && proved.has(n.skillId) ? "met" : n.status,
  }));
  const mentioned = new Set([...check.requiredSkillIds, ...check.niceSkillIds]);
  view.notAsked = target.gaps
    .filter((g) => !gapSkills(g, members).some((id) => mentioned.has(id)))
    .map((g) => ({ skillId: g.skillId, skillName: g.skillName }));
  return view;
}

/** A job's "also goals" in the order of the path's steps; goals the path left for later follow in the check's order. */
export function inPathOrder<T extends { skillId: string }>(skills: T[], stepSkillIds: string[]): T[] {
  const at = (id: string) => {
    const i = stepSkillIds.indexOf(id);
    return i === -1 ? Number.MAX_SAFE_INTEGER : i;
  };
  return skills.map((s, i) => ({ s, i })).sort((a, b) => at(a.s.skillId) - at(b.s.skillId) || a.i - b.i).map(({ s }) => s);
}
