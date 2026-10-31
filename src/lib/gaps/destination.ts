/*
 * The rules of a change of destination (docs/plans/change-destination-plan.md section 5; C25, Project manager approved
 * on Milin's behalf, 2026-10-31). Plain code, no database, so the store, the readers and the tests share them.
 */

/** The person's destination as the Gaps page sees it: its analysis, its role, and whether it is the sample resume's. */
export type DestinationNow = { id: string; roleSlug: string; sample: boolean } | null;

/**
 * Whether opening a role's Gaps page may make its analysis the destination without asking. Only when the person has no
 * destination yet (their first analysis, as before), when it is the sample resume's (a made-up person's, so their own
 * resume takes over, as before), or when it is the same role (another resume of theirs for it: not a change of
 * destination). Any other role shows its gaps and "Make this my destination".
 */
export function picksSilently(current: DestinationNow, roleSlug: string): boolean {
  return current === null || current.sample || current.roleSlug === roleSlug;
}

/**
 * Whether a goal waits on the earlier line: a goal the gaps made (never one the person chose) whose skill isn't a gap of
 * the current analysis. Such goals stop counting for the current destination (Library, Timetable, On your line,
 * Departures fit, Practice, Mock) and come back on a switch back; nothing about them is changed or lost. With no current
 * analysis (`gapSkillIds` null) nothing is left behind.
 */
export function leftOnEarlierLine(goal: { skillId: string; source: "gap" | "user" }, gapSkillIds: ReadonlySet<string> | null): boolean {
  return gapSkillIds !== null && goal.source === "gap" && !gapSkillIds.has(goal.skillId);
}

/** The skills of an analysis's gaps, for `leftOnEarlierLine`; null without an analysis. */
export const gapSkillsOf = (analysis: { result: { gaps: { skillId: string }[] } } | null): ReadonlySet<string> | null =>
  analysis ? new Set(analysis.result.gaps.map((g) => g.skillId)) : null;
