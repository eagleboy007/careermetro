import { indiaDay } from "@/lib/ride/days";
import { SLOT_DAYS, SLOT_LEAD_HOURS, SLOT_TIMES } from "@/lib/schemas/constants";

/*
 * Interview times (dev/corporate-plan.md build step 6). Everything a person sees is India time (IST, UTC+5:30, no
 * daylight saving), whatever the server's zone. A slot is named by its India date and start time, "2026-10-14T11:00",
 * and stored as the instant it starts. Pure, so the server works out every label and the browser never reads the clock.
 */

const IST_OFFSET_MS = 5.5 * 3600_000;
const DAY = 86_400_000;
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/** "2026-10-14T11:00": an India date and a start time on the picker. */
export const SLOT_KEY = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})$/;

const dayOf = (iso: string) => new Date(`${iso}T00:00:00Z`);
const addDays = (iso: string, n: number) => new Date(dayOf(iso).getTime() + n * DAY).toISOString().slice(0, 10);

/** The weekdays a new "Ask for times" offers: the next SLOT_DAYS Monday-to-Friday days after today in India. */
export function askDays(now: Date): string[] {
  const out: string[] = [];
  for (let d = indiaDay(now), i = 1; out.length < SLOT_DAYS && i < 15; i++) {
    const day = addDays(d, i);
    const wd = dayOf(day).getUTCDay();
    if (wd !== 0 && wd !== 6) out.push(day);
  }
  return out;
}

/** The instant a slot starts, or null for a key that isn't a picker time or a real date. */
export function slotStart(key: string): Date | null {
  const m = SLOT_KEY.exec(key);
  if (!m || !(SLOT_TIMES as readonly string[]).includes(m[2]!)) return null;
  const at = new Date(`${m[1]}T${m[2]}:00+05:30`);
  if (Number.isNaN(at.getTime()) || indiaDay(at) !== m[1]) return null;
  return at;
}

/** The slot key of an instant, in India time. */
export function slotKeyOf(at: Date): string {
  return new Date(at.getTime() + IST_OFFSET_MS).toISOString().slice(0, 16);
}

/** ["Wed", "14 Oct"] for an India date. */
export function dayParts(iso: string): [string, string] {
  const d = dayOf(iso);
  return [WEEKDAYS[d.getUTCDay()]!, `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`];
}

/** "Wed 14 Oct, 11:00" in India time. */
export function slotLabel(at: Date): string {
  const key = slotKeyOf(at);
  const [wd, date] = dayParts(key.slice(0, 10));
  return `${wd} ${date}, ${key.slice(11)}`;
}

/** "11:00 to 11:45" in India time. */
export function timeRange(at: Date, minutes: number): string {
  return `${slotKeyOf(at).slice(11)} to ${slotKeyOf(new Date(at.getTime() + minutes * 60_000)).slice(11)}`;
}

/** Whether a slot is far enough ahead to offer or book now. */
export const slotOpen = (at: Date, now: Date): boolean => at.getTime() - now.getTime() >= SLOT_LEAD_HOURS * 3600_000;

/** The question an "Ask for times" message asks, naming its first and last day. */
export function askText(days: string[]): string {
  const [a, b] = [dayParts(days[0]!), dayParts(days[days.length - 1]!)];
  return `Which times work for you between ${a[0]} ${a[1]} and ${b[0]} ${b[1]}? Pick the ones that suit you; we only see the times you pick.`;
}

/**
 * Whether an "Ask for times" has nothing left to book (build step 7): `passed` when every time offered is too soon or
 * gone (or the daily clean-up already deleted them, `answered`), `unanswered` when every day asked has gone by with no
 * answer. Undefined while it is still of use.
 */
export function askEnded(ask: { days: string[]; offered: Date[]; answered: boolean }, now: Date): "passed" | "unanswered" | undefined {
  if (ask.offered.length) return ask.offered.some((at) => slotOpen(at, now)) ? undefined : "passed";
  if (ask.answered) return "passed";
  const today = indiaDay(now);
  return ask.days.some((d) => d >= today) ? undefined : "unanswered";
}

/** The clean-up's mark on an ask whose offered times it deleted. */
export const askAnswered = (payload: unknown): boolean => (payload as { answered?: unknown } | null)?.answered === true;

/** Whole days from one India date to another (both "YYYY-MM-DD"). */
export const daysBetween = (from: string, to: string): number => Math.round((dayOf(to).getTime() - dayOf(from).getTime()) / DAY);

/** The India dates of the next `n` days from `today`, today first: Arrivals' 10-day strip. */
export const nextDays = (today: string, n: number): string[] => Array.from({ length: n }, (_, i) => addDays(today, i));
