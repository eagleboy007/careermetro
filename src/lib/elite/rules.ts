import type { PlanRow, PlanView } from "@/lib/schemas";
import { ELITE_NEEDED_MESSAGE, PRACTICE_DAILY_ANSWERS } from "@/lib/schemas/constants";

/*
 * Elite rules (FR-50, handoff 12l), kept apart from the database so they can be tested on their own. The plan is a
 * switch during the beta: nothing here knows a price, a card or a payment. The verified tick never reads the plan.
 */

/** Free: no row, or a row whose `eliteSince` is null. */
export const isElite = (row: PlanRow | null | undefined): boolean => Boolean(row?.eliteSince);

/** The Elite badge shows next to the name only while Elite is on and the person turned the badge on. */
export const badgeOn = (row: PlanRow | null | undefined): boolean => isElite(row) && row!.badgeShown;

const dateText = (d: Date) => d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });

export function planViewOf(row: PlanRow | null | undefined): PlanView {
  const since = row?.eliteSince ?? null;
  return { elite: since !== null, badgeShown: badgeOn(row), since: since ? dateText(since) : null };
}

/**
 * The row after "Turn on Elite" or "Turn off". Turning on again keeps the first date. Turning off sets the date back to
 * null and the badge back to off (its default), and keeps everything the person made, which lives in other tables.
 */
export function switchedPlan(row: PlanRow | null | undefined, on: boolean, now: Date): PlanRow {
  if (!on) return { eliteSince: null, badgeShown: false };
  return { eliteSince: row?.eliteSince ?? now, badgeShown: row?.badgeShown ?? false };
}

/** Practice answers with feedback a day: 10 on Free, no daily cap on Elite (null). */
export const practiceCapFor = (elite: boolean): number | null => (elite ? null : PRACTICE_DAILY_ANSWERS);

export const ELITE_MESSAGES = {
  invalid: "That didn't work. Please refresh the page and try again.",
  /** Plan changes stop at ELITE_CHANGES_PER_DAY a day, badge changes at 20. */
  limit: "That's as many changes as we allow in a day. Try again tomorrow.",
  not_elite: ELITE_NEEDED_MESSAGE,
} as const;
