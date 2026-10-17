import { roleProfiles, skills } from "@/content";
import { fillingSkills } from "./sync";

/*
 * "Not for me" per goal (handoff section 6, rule 9; docs/plans/not-for-me-plan.md, FR-48). Plain code, no database.
 * Goals come from the role's required gaps, so a goal is either a "one of these" group, which the person can swap to
 * another skill of the group, or a required skill, which they can skip anyway. "Your choice" goals keep "Remove from my
 * goals". Nothing here changes the match, the gaps or readiness: a skipped goal stays a gap, and a swap stays inside a
 * group whose proof already fills the goal.
 */

const skillNames = new Map(skills.map((s) => [s.id, s.name]));
const shares = new Map(roleProfiles.flatMap((r) => r.skills.map((s) => [`${r.slug}:${s.skillId}`, s.postingShare] as const)));

type GoalLike = { source: "gap" | "user"; skillId: string; groupId: string | null; swappedTo?: string | null };

export type NotForMe =
  /** A "one of these" group: learn another skill of it instead. `current` is the skill the goal is on now. */
  | { kind: "swap"; current: string; options: { skillId: string; name: string }[] }
  /** A required skill: skip anyway. `share` is the part of the role's job posts we checked that ask for it, if measured. */
  | { kind: "skip"; share: number | null };

/** The skill a swapped goal is on now, when it is still a skill of the goal's group; else null (the goal's own skill). */
export function swappedSkill(goal: GoalLike, members: ReadonlyMap<string, string[]>): string | null {
  if (!goal.swappedTo || !goal.groupId || goal.swappedTo === goal.skillId) return null;
  return fillingSkills(goal, members).includes(goal.swappedTo) ? goal.swappedTo : null;
}

/** What "Not for me" offers on a goal from a gap; null for "Your choice" goals, which have their own Remove. */
export function notForMeFor(goal: GoalLike, roleSlug: string, members: ReadonlyMap<string, string[]>): NotForMe | null {
  if (goal.source !== "gap") return null;
  const group = fillingSkills(goal, members);
  if (goal.groupId && group.length > 1) {
    const current = swappedSkill(goal, members) ?? goal.skillId;
    return { kind: "swap", current, options: group.filter((id) => id !== current).map((skillId) => ({ skillId, name: skillNames.get(skillId) ?? skillId })) };
  }
  const share = shares.get(`${roleSlug}:${goal.skillId}`) ?? null;
  return { kind: "skip", share: share && share > 0 ? share : null };
}

/** "Asked for in 33% of the job posts we checked for this role." Null when not measured. */
export function shareSentence(share: number | null): string | null {
  if (share === null) return null;
  return `Asked for in ${Math.max(1, Math.round(share * 100))}% of the job posts we checked for this role.`;
}

/** Whether a swap to `skillId` is allowed: a different skill of the goal's own group. */
export function canSwapTo(goal: GoalLike, skillId: string, members: ReadonlyMap<string, string[]>): boolean {
  return goal.source === "gap" && Boolean(goal.groupId) && fillingSkills(goal, members).length > 1 && fillingSkills(goal, members).includes(skillId);
}
