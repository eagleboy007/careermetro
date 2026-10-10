import { prerequisitesFirst } from "@/lib/path/build";
import type { Gap, GoalState } from "@/lib/schemas";

export type ExistingGoal = {
  skillId: string;
  position: number;
  status: GoalState;
  source: "gap" | "user";
  groupId: string | null;
};

export type GoalSyncPlan = {
  insert: {
    skillId: string;
    position: number;
    status: GoalState;
    groupId: string | null;
  }[];
  /** Changes to existing goals, by their current skill. `moveTo` points a group's goal at the skill the gap now suggests. */
  update: {
    skillId: string;
    status?: GoalState;
    groupId?: string;
    moveTo?: string;
  }[];
};

/** The skills whose proof fills a goal: its own, or every skill of its "one of these" group. */
export function fillingSkills(
  goal: { skillId: string; groupId: string | null },
  members: ReadonlyMap<string, string[]>,
): string[] {
  return goal.groupId
    ? (members.get(goal.groupId) ?? [goal.skillId])
    : [goal.skillId];
}

/**
 * How a person's goals follow their current gap analysis (dev/goals-proofs-plan.md). Plain code, no database.
 * - Goals belong to the person, not to one resume: existing goals keep their place, and new gaps go at the end in
 *   path order (a skill's prerequisite first).
 * - A goal whose skill a newer resume shows is met. A goal for another role's skill stays as it is.
 * - Proof carries over: a gap whose skill already has accepted proof is met from the start, and stays met.
 * - A goal met only by an earlier resume opens again if the skill is a gap again. Skipped goals and the person's own
 *   goals are never changed here.
 * - A "one of these" group is one goal, under the skill its gap suggests, so pages that pair goals with gaps by skill
 *   keep working. An existing goal for that skill joins the group; else the group's goal moves to that skill; else a
 *   new goal starts. Any skill of the group, shown or proved, meets it (dev/role-one-of-plan.md).
 */
export function planGoalSync(input: {
  existing: ExistingGoal[];
  gaps: Gap[];
  metSkillIds: string[];
  provedSkillIds: string[];
  implies: ReadonlyMap<string, string[]>;
  members?: ReadonlyMap<string, string[]>;
}): GoalSyncPlan {
  const members = input.members ?? new Map<string, string[]>();
  const proved = new Set(input.provedSkillIds);
  const met = new Set(input.metSkillIds);
  const gapIds = new Set(input.gaps.map((g) => g.skillId));

  // Goals as they will be once group gaps have found their goal, keyed by their current skill.
  const goals = input.existing.map((g) => ({ ...g, at: g.skillId }));
  const bySkill = new Map(goals.map((g) => [g.skillId, g]));
  for (const gap of input.gaps) {
    if (!gap.groupId) continue;
    const own = bySkill.get(gap.skillId);
    if (own) {
      if (own.source === "gap" && own.groupId !== gap.groupId)
        own.groupId = gap.groupId;
      continue;
    }
    const held = goals.find(
      (g) =>
        g.source === "gap" &&
        g.groupId === gap.groupId &&
        !gapIds.has(g.skillId),
    );
    if (held) {
      bySkill.delete(held.skillId);
      held.skillId = gap.skillId;
      bySkill.set(held.skillId, held);
    }
  }

  const update: GoalSyncPlan["update"] = [];
  for (const g of goals) {
    if (g.source !== "gap" || g.status === "skipped") continue;
    const before = input.existing.find((e) => e.skillId === g.at)!;
    const want: GoalState = fillingSkills(g, members).some(
      (id) => proved.has(id) || met.has(id),
    )
      ? "met"
      : gapIds.has(g.skillId)
        ? "active"
        : g.status;
    const change: GoalSyncPlan["update"][number] = { skillId: g.at };
    if (want !== g.status) change.status = want;
    if (g.groupId !== before.groupId && g.groupId) change.groupId = g.groupId;
    if (g.skillId !== g.at) change.moveTo = g.skillId;
    if (Object.keys(change).length > 1) update.push(change);
  }

  let position = input.existing.reduce(
    (max, g) => Math.max(max, g.position),
    0,
  );
  const insert = prerequisitesFirst(input.gaps, input.implies)
    .filter((g) => !bySkill.has(g.skillId))
    .map((g) => {
      const groupId = g.groupId ?? null;
      const status: GoalState = fillingSkills(
        { skillId: g.skillId, groupId },
        members,
      ).some((id) => proved.has(id))
        ? "met"
        : "active";
      return { skillId: g.skillId, position: ++position, status, groupId };
    });
  return { insert, update };
}
