import type { Departure, LampStatus, Ride } from "@/lib/schemas/today";

/** Plain rules behind the Today screen (handoff section 5). No clock or I/O here, so they are easy to test. */

/**
 * The streak counts ride days. A missed day pauses the count; it never resets to zero.
 * So the streak is simply how many distinct days had at least one ticked task.
 */
export function streakCount(rideDays: readonly string[]): number {
  return new Set(rideDays).size;
}

/** What the streak chip says. A first sign-up reads "Day 1" until a task is ticked. */
export function streakLabel(count: number): { number: string; text: string } {
  return count === 0 ? { number: "Day", text: " 1" } : { number: String(count), text: "-day streak" };
}

const WEEKDAY_LETTERS = ["M", "T", "W", "T", "F", "S", "S"] as const;

export type WeekDay = { date: string; letter: string; rode: boolean; isToday: boolean; isFuture: boolean };

/** Monday to Sunday of the week holding `today`, each marked rode or not. Dates are `YYYY-MM-DD`. */
export function weekStrip(rideDays: readonly string[], today: string): WeekDay[] {
  const rode = new Set(rideDays);
  const t = new Date(`${today}T00:00:00Z`);
  const mondayOffset = (t.getUTCDay() + 6) % 7;
  return WEEKDAY_LETTERS.map((letter, i) => {
    const d = new Date(t);
    d.setUTCDate(t.getUTCDate() - mondayOffset + i);
    const date = d.toISOString().slice(0, 10);
    return { date, letter, rode: rode.has(date), isToday: date === today, isFuture: date > today };
  });
}

/** Share of this week's prep for the current pitstop, from 0 to 1. Drives the ring and the dotted stretch. */
export function rideProgress(ride: Pick<Ride, "weekTotal" | "doneBeforeToday">, doneToday: number): number {
  return Math.min(1, Math.max(0, (ride.doneBeforeToday + doneToday) / ride.weekTotal));
}

export type DepartureTone = "now" | "soon" | "later";

/** The right-hand column of the board. "Boarding now" means zero required gaps. Gaps left are said in words. */
export function departureWhen(gapsLeft: number): { label: string; tone: DepartureTone } {
  if (gapsLeft <= 0) return { label: "Boarding now", tone: "now" };
  const label = `After ${gapsLeft} ${gapsLeft === 1 ? "goal" : "goals"}`;
  return { label, tone: gapsLeft <= 2 ? "soon" : "later" };
}

/** Board rows ordered by gaps left, fewest first. Ties keep their order. */
export function orderDepartures<T extends Pick<Departure, "gaps">>(rows: readonly T[]): T[] {
  return rows.map((row, i) => ({ row, i })).sort((a, b) => a.row.gaps.length - b.row.gaps.length || a.i - b.i).map(({ row }) => row);
}

/** Weeks the whole line takes at the chosen hours a week, for the first sign-up setup. */
export function weeksAt(hoursPerWeek: number, lineHours: number): number {
  return Math.max(1, Math.ceil(lineHours / hoursPerWeek));
}

/** Status is never colour alone: every lamp carries a word. */
export const LAMP_WORD: Record<LampStatus, string> = { missing: "Missing", weak: "Weak", met: "Met" };

/** "Evening, Priya." Uses the hour in India time. */
export function greeting(hour: number, firstName: string): string {
  const part = hour < 12 ? "Morning" : hour < 17 ? "Afternoon" : "Evening";
  return `${part}, ${firstName}.`;
}

/**
 * Where the train sits on the mini line, as a stop index with a fraction. It rides the stretch from the last
 * cleared stop toward the pitstop being prepared, and arrives only when this week's prep is all done.
 */
export function trainPosition(currentStopIndex: number, progress: number): number {
  if (currentStopIndex === 0) return 0;
  return progress >= 1 ? currentStopIndex : currentStopIndex - 1 + progress * 0.94;
}
