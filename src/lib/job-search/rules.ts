import { CAN_JOIN, type NoticeDays } from "@/lib/schemas/constants";

/*
 * Job search switch and notice period rules (handoff 6, docs/plans/job-search-plan.md), kept apart from the database so
 * the screens and the server share them and they can be tested on their own. Days are India dates (YYYY-MM-DD, from
 * indiaDay in src/lib/ride/days.ts), so the maths is plain calendar days with no time zone in it.
 */

const DAY = 86_400_000;
const at = (day: string) => Date.parse(`${day}T00:00:00Z`);

/** `day` plus `n` calendar days. */
export const addDays = (day: string, n: number): string => new Date(at(day) + n * DAY).toISOString().slice(0, 10);

/** Calendar days from `from` to `to` (negative when `to` is earlier). */
export const daysBetween = (from: string, to: string): number => Math.round((at(to) - at(from)) / DAY);

export type NoticeCountdown = {
  /** Last working day: the resignation date plus the notice days. */
  lastDay: string;
  /** Free to join from: the day after the last working day. */
  joinFrom: string;
  /** Days left to the last working day, never below 0. */
  left: number;
  /** How much of the notice is served, 0 to 100, for the progress bar. */
  served: number;
};

export function noticeCountdown(resignedOn: string, days: NoticeDays, today: string): NoticeCountdown {
  const lastDay = addDays(resignedOn, days);
  const left = Math.min(days, Math.max(0, daysBetween(today, lastDay)));
  return { lastDay, joinFrom: addDays(lastDay, 1), left, served: Math.round(((days - left) / days) * 100) };
}

/**
 * Can join, prefilled on applying while a countdown runs: the nearest choice that is not earlier than "Free to join
 * from". Immediately once that day has come; then within 30 days, 30 to 60 and 60 to 90. The person can still change it.
 */
export function canJoinFrom(joinFrom: string, today: string): (typeof CAN_JOIN)[number] {
  const wait = daysBetween(today, joinFrom);
  if (wait <= 0) return "now";
  if (wait <= 30) return "30";
  return wait <= 60 ? "60" : "90";
}

/** "Fri 9 Oct", as the prototype's notice card writes a day. */
export const noticeDayText = (day: string): string =>
  new Date(at(day)).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).replace(",", "");

/**
 * The status line on the person's own profile: "Looking for a next role" while job search is on; "Working at
 * {company}" from the latest current role on the resume while it is off; no line when off with no current role.
 */
export function jobSearchStatus(on: boolean, currentEmployer: string | null): string | null {
  if (on) return "Looking for a next role";
  return currentEmployer ? `Working at ${currentEmployer}` : null;
}

/** The toast after the switch moves. */
export const jobSearchToast = (on: boolean): string =>
  on ? "Job search is on. Departures and Arrivals are back." : "Job search is off. Your rides and map keep going.";

/** The Can join to prefill on applying: from the countdown while one runs, otherwise none (the person picks). */
export function suggestedCanJoin(view: { noticeDays: NoticeDays | null; resignedOn: string | null }, today: string): (typeof CAN_JOIN)[number] | null {
  if (!view.noticeDays || !view.resignedOn) return null;
  return canJoinFrom(noticeCountdown(view.resignedOn, view.noticeDays, today).joinFrom, today);
}
