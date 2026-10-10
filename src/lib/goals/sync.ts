import { prerequisitesFirst } from "@/lib/path/build";
import type { Gap, GoalState } from "@/lib/schemas";

export type ExistingGoal = { skillId: string; position: number; status: GoalState; source: "gap" | "user"; groupId: string | null };

export type GoalSyncPlan = {
  insert: { skillId: string; position: number; status: GoalState; groupId: string | null }[];
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
 * - A "one of these" group is one goal. Any skill of the group, shown or proved, meets it, and a group that already has
 *   a goal gets no second one when the analysis suggests a different skill of it.
 */
export function planGoalSync(input: {
  existing: ExistingGoal[];
  gaps: Gap[];
  metSkillIds: string[];
  provedSkillIds: string[];
  implies: ReadonlyMap<string, string[]>;
  groups?: { id: string; skillIds: string[] }[];
}): GoalSyncPlan {
  const proved = new Set(input.provedSkillIds);
  const met = new Set(input.metSkillIds);
  const gapIds = new Set(input.gaps.map((g) => g.skillId));
  const gapGroups = new Set(input.gaps.flatMap((g) => (g.groupId ? [g.groupId] : [])));
  const bySkill = new Map(input.existing.map((g) => [g.skillId, g]));
  const goalGroups = new Set(input.existing.flatMap((g) => (g.groupId ? [g.groupId] : [])));
  const members = new Map((input.groups ?? []).map((g) => [g.id, g.skillIds]));
  // The skills that fill a goal: its own, or every skill of its group in the current role.
  const fills = (skillId: string, groupId: string | null) => (groupId ? (members.get(groupId) ?? [skillId]) : [skillId]);

  const update: GoalSyncPlan["update"] = [];
  for (const g of input.existing) {
    if (g.source !== "gap" || g.status === "skipped") continue;
    const ids = fills(g.skillId, g.groupId);
    const isGap = gapIds.has(g.skillId) || (g.groupId !== null && gapGroups.has(g.groupId));
    const want: GoalState = ids.some((id) => proved.has(id) || met.has(id)) ? "met" : isGap ? "active" : g.status;
    if (want !== g.status) update.push({ skillId: g.skillId, status: want });
  }

  let position = input.existing.reduce((max, g) => Math.max(max, g.position), 0);
  const insert = prerequisitesFirst(input.gaps, input.implies)
    .filter((g) => !bySkill.has(g.skillId) && !(g.groupId && goalGroups.has(g.groupId)))
    .map((g) => {
      const groupId = g.groupId ?? null;
      const status: GoalState = fills(g.skillId, groupId).some((id) => proved.has(id)) ? "met" : "active";
      return { skillId: g.skillId, position: ++position, status, groupId };
    });
  return { insert, update };
}
