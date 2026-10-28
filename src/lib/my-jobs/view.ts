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
