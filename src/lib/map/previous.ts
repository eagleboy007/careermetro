import { MAX_GAPS, OWN_PITSTOPS_PER_GOAL, type Gap, type PreviousLine } from "@/lib/schemas";

/*
 * The Map's earlier line after a change of destination (handoff section 14, open decision 5;
 * docs/plans/change-destination-plan.md). Plain code, no database, so the design page and the server share it.
 * Goals belong to the person, not to one role: a goal the new line doesn't need is kept as it was, with its proof and
 * the pitstops the person added, and the earlier line says what waits there.
 */

const clip = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s);

export function earlierLine(input: {
  /** The earlier destination's analysis: its role and gaps. */
  previous: { roleSlug: string; gaps: Pick<Gap, "skillId" | "skillName">[] };
  /** The earlier role's title, or its slug when the role is gone. */
  title: string;
  /** The role of the new line, and the skills of its goals. */
  currentRoleSlug: string;
  lineSkillIds: ReadonlySet<string>;
  /** The person's goals, by skill: its id (for their own pitstops) and whether accepted proof filled it. */
  goals: ReadonlyMap<string, { id: string; proved: boolean }>;
  /** How many pitstops of their own the person added, by goal id (FR-58). */
  ownByGoal: ReadonlyMap<string, number>;
}): PreviousLine | null {
  const { previous } = input;
  if (previous.roleSlug === input.currentRoleSlug) return null;
  const gaps = previous.gaps.slice(0, MAX_GAPS);
  const left = gaps
    .filter((g) => !input.lineSkillIds.has(g.skillId))
    .map((g) => {
      const goal = input.goals.get(g.skillId);
      return {
        skillId: g.skillId,
        name: clip(g.skillName, 80),
        proved: goal?.proved ?? false,
        ownPitstops: Math.min(OWN_PITSTOPS_PER_GOAL, goal ? (input.ownByGoal.get(goal.id) ?? 0) : 0),
      };
    });
  return { role: { slug: previous.roleSlug, title: input.title }, left, shared: gaps.length - left.length };
}
