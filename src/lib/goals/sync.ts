import { prerequisitesFirst } from "@/lib/path/build";
import type { Gap, GoalState } from "@/lib/schemas";

export type ExistingGoal = { skillId: string; position: number; status: GoalState; source: "gap" | "user" };

export type GoalSyncPlan = {
  insert: { skillId: string; position: number; status: GoalState }[];
  update: { skillId: string; status: GoalState }[];
};

/**
 * How a person's goals follow their current gap analysis (dev/goals-proofs-plan.md). Plain code, no database.
 * - Goals belong to the person, not to one resume: existing goals keep their place, and new gaps go at the end in
 *   path order (a skill's prerequisite first).
 * - A goal whose skill a newer resume shows is met. A goal for another role's skill stays as it is.
 * - Proof carries over: a gap whose skill already has accepted proof is met from the start, and stays met.
 * - A goal met only by an earlier resume opens again if the skill is a gap again. Skipped goals and the person's own
 *   goals are never changed here.
 */
export function planGoalSync(input: {
  existing: ExistingGoal[];
  gaps: Gap[];
  metSkillIds: string[];
  provedSkillIds: string[];
  implies: ReadonlyMap<string, string[]>;
}): GoalSyncPlan {
  const proved = new Set(input.provedSkillIds);
  const met = new Set(input.metSkillIds);
  const gapIds = new Set(input.gaps.map((g) => g.skillId));
  const bySkill = new Map(input.existing.map((g) => [g.skillId, g]));

  const update: GoalSyncPlan["update"] = [];
  for (const g of input.existing) {
    if (g.source !== "gap" || g.status === "skipped") continue;
    const want: GoalState = proved.has(g.skillId) || met.has(g.skillId) ? "met" : gapIds.has(g.skillId) ? "active" : g.status;
    if (want !== g.status) update.push({ skillId: g.skillId, status: want });
  }

  let position = input.existing.reduce((max, g) => Math.max(max, g.position), 0);
  const insert = prerequisitesFirst(input.gaps, input.implies)
    .filter((g) => !bySkill.has(g.skillId))
    .map((g) => ({ skillId: g.skillId, position: ++position, status: (proved.has(g.skillId) ? "met" : "active") as GoalState }));
  return { insert, update };
}
