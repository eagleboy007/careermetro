import type { RideWeek, Streak } from "@/lib/schemas";

/** A ride day: the tasks ticked on one India date. A row whose ticks were all taken back is not a ride. */
export type RideDay = { day: string; taskIds: string[] };

const IST_OFFSET_MS = 5.5 * 3600_000;
const LABELS = ["M", "T", "W", "T", "F", "S", "S"];

/** The India date (YYYY-MM-DD) of a moment. Ride days follow India time wherever the server runs. */
export function indiaDay(at: Date): string {
  return new Date(at.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

const rode = (d: RideDay) => d.taskIds.length > 0;

/**
 * "Day N": the number of days ridden. A missed day pauses the count; it never resets (handoff section 5), so the count
 * is every ride day so far.
 */
export function streakFor(days: RideDay[], today: string): Streak {
  return { days: days.filter(rode).length, todayCounted: days.some((d) => d.day === today && rode(d)) };
}

/** The Monday (YYYY-MM-DD) of the week holding `day`. */
export function mondayOf(day: string): string {
  const t = new Date(`${day}T00:00:00Z`);
  return new Date(t.getTime() - ((t.getUTCDay() + 6) % 7) * 86_400_000).toISOString().slice(0, 10);
}

/** Monday to Sunday of the week holding `today`, each marked ridden or not. */
export function weekFor(days: RideDay[], today: string): RideWeek {
  const monday = new Date(`${mondayOf(today)}T00:00:00Z`);
  const ridden = new Set(days.filter(rode).map((d) => d.day));
  return LABELS.map((label, i) => {
    const day = new Date(monday.getTime() + i * 86_400_000).toISOString().slice(0, 10);
    return { label, rode: ridden.has(day), today: day === today };
  });
}

/** The day's ticked task ids after ticking or unticking one. */
export function toggled(taskIds: string[], taskId: string, on: boolean): string[] {
  const rest = taskIds.filter((id) => id !== taskId);
  return on ? [...rest, taskId] : rest;
}
