import { readiness } from "@/lib/departures/filter";
import type { JobCheckView } from "@/lib/jobs/groups";
import type { JobPost, MyJobView } from "@/lib/schemas";

/* My jobs rows as the screen shows them (handoff 12m), in plain code. */

export type MyJobFit = NonNullable<MyJobView["fit"]>;

/** An added job's fit from its check, against the current resume: still-open goals as gap chips, extras by name. */
export function checkFit(view: JobCheckView): MyJobFit {
  return {
    have: view.covered.length,
    open: view.alsoGoals.map((s) => ({ status: s.status, name: s.skillName })),
    only: view.onlyThisJob.map((s) => s.skillName),
  };
}

/** A feed job's fit from its Departures row, or null when the row shows none. */
export function postFit(job: Pick<JobPost, "fitNote" | "have" | "gaps">, shown: boolean): MyJobFit | null {
  if (!shown || job.fitNote !== null) return null;
  return { have: job.have.length, open: job.gaps.map((g) => ({ status: g.status, name: g.name })), only: [] };
}

/** "Two gaps away for this job": readiness in words, counting the still-open goals it asks for. */
// readiness reads only how many gaps there are.
export const fitWords = (fit: MyJobFit): string => `${readiness({ gaps: fit.open as JobPost["gaps"], destination: false })} for this job`;

/** "A, B and C". */
export function andList(names: string[]): string {
  return names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** The sentence under "Check these, then save": which skills are already goals, and which this job adds on its own. */
export function fitSentence(fit: MyJobFit): string {
  const parts: string[] = [];
  if (fit.open.length) parts.push(`${andList(fit.open.map((g) => g.name))} ${fit.open.length === 1 ? "is already a goal" : "are already goals"} on your line.`);
  if (fit.only.length)
    parts.push(
      `${andList(fit.only)} ${fit.only.length === 1 ? "is" : "are"} asked for here, not by most roles like it: worth a look before the interview, and ${fit.only.length === 1 ? "it never becomes a main goal" : "they never become main goals"} on ${fit.only.length === 1 ? "its" : "their"} own.`,
    );
  if (!parts.length) parts.push(fit.have ? "Your resume already shows what it asks for." : "It names no skills we can check yet.");
  return parts.join(" ");
}

/** Newest change first, then by key, so the list keeps one order. */
export const newestChange = (a: Pick<MyJobView, "updatedAt" | "key">, b: Pick<MyJobView, "updatedAt" | "key">) =>
  b.updatedAt.localeCompare(a.updatedAt) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);

/** "28 Oct" in IST, as the row's dates show. */
export function shortDay(iso: string | null): string | null {
  if (!iso) return null;
  return new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" }).format(new Date(iso));
}

/** "2026-10-28" in IST, for a date field. */
export function dayValue(iso: string | null): string {
  if (!iso) return "";
  return new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: "Asia/Kolkata" }).format(new Date(iso));
}

const IST_MS = 5.5 * 3600_000;

/** "2026-10-30T10:30" in IST, for the interview's date and time field. */
export function minuteValue(iso: string | null): string {
  if (!iso) return "";
  return new Date(Date.parse(iso) + IST_MS).toISOString().slice(0, 16);
}

/** "Thu 30 Oct, 10:30" in IST, as the row and Today show the interview. */
export function interviewWhen(iso: string): string {
  const parts = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "Asia/Kolkata" }).formatToParts(new Date(iso));
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "";
  return `${part("weekday")} ${part("day")} ${part("month")}, ${part("hour")}:${part("minute")}`;
}

/** Whole India days from `now` to the interview: 0 on its day, 1 the day before. */
export function daysUntil(iso: string, now: Date): number {
  const day = (t: number) => Math.floor((t + IST_MS) / 86_400_000);
  return day(Date.parse(iso)) - day(now.getTime());
}

/** Today's countdown: "today", "tomorrow" or "in 3 days". */
export const countdownWords = (days: number): string => (days <= 0 ? "today" : days === 1 ? "tomorrow" : `in ${days} days`);
