import { FREE_DAY_LABELS, FREE_DAYS, SLOT_MINUTES, SLOT_TIMES, SLOTS_MAX, type FreeDay } from "@/lib/schemas/constants";

/*
 * Usually free (docs/plans/settings-columns-plan.md, v44 gap item 31, FR-55): the weekday hours a person is usually
 * free, as "mon 17:00" entries (a FREE_DAYS day and a SLOT_TIMES start). Private: it never leaves the person's own
 * pages. It only pre-ticks open times when a company asks for times; the person still picks and sends. Pure, so the
 * browser can use it without zod and without reading the clock.
 */

/** One Usually free hour, "mon 17:00". */
export const freeSlot = (day: FreeDay, time: string): string => `${day} ${time}`;

const dayIndex = (slot: string) => FREE_DAYS.indexOf(slot.slice(0, 3) as FreeDay);
const timeIndex = (slot: string) => (SLOT_TIMES as readonly string[]).indexOf(slot.slice(4));

/** Monday first, then by time: the order the grid shows and the database keeps. */
export const sortFree = (slots: readonly string[]): string[] => [...slots].sort((a, b) => dayIndex(a) - dayIndex(b) || timeIndex(a) - timeIndex(b));

const minutesOf = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
const timeOf = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;

/** "10:00 to 13:00, 17:00 to 19:00": back-to-back hours run together. */
function rangesOf(times: string[]): string {
  const out: [number, number][] = [];
  for (const t of times.map(minutesOf).sort((a, b) => a - b)) {
    const last = out.at(-1);
    if (last && last[1] === t) last[1] = t + SLOT_MINUTES;
    else out.push([t, t + SLOT_MINUTES]);
  }
  return out.map(([a, b]) => `${timeOf(a)} to ${timeOf(b)}`).join(", ");
}

/**
 * The summary over the grid, worked out in code: "Mon to Fri 17:00 to 19:00", "Mon 17:00 to 19:00; Wed 10:00 to
 * 11:00", or "Not set". Days next to each other with the same hours run together.
 */
export function usuallyFreeSummary(slots: readonly string[]): string {
  const byDay = FREE_DAYS.map((day) => ({ day, hours: rangesOf(slots.filter((s) => s.startsWith(`${day} `)).map((s) => s.slice(4))) })).filter((d) => d.hours);
  if (!byDay.length) return "Not set";
  const groups: { first: FreeDay; last: FreeDay; count: number; hours: string }[] = [];
  for (const d of byDay) {
    const g = groups.at(-1);
    if (g && g.hours === d.hours && FREE_DAYS.indexOf(d.day) === FREE_DAYS.indexOf(g.last) + 1) {
      g.last = d.day;
      g.count++;
    } else groups.push({ first: d.day, last: d.day, count: 1, hours: d.hours });
  }
  return groups
    .map((g) => {
      const days = g.count === 1 ? FREE_DAY_LABELS[g.first] : `${FREE_DAY_LABELS[g.first]} ${g.count === 2 ? "and" : "to"} ${FREE_DAY_LABELS[g.last]}`;
      return `${days} ${g.hours}`;
    })
    .join("; ");
}

const WEEKDAY_CODES = [null, "mon", "tue", "wed", "thu", "fri", null] as const;

/** The Usually free day of an India date ("2026-10-19" is a Monday), or null on a weekend. */
export const freeDayOf = (isoDay: string): FreeDay | null => WEEKDAY_CODES[new Date(`${isoDay}T00:00:00Z`).getUTCDay()] ?? null;

/**
 * The times "Ask for times" starts with ticked: the open slots of the ask (not too soon) that fall in Usually free,
 * earliest first, at most SLOTS_MAX. Nothing set, nothing ticked. The person can untick any; nothing is sent until they
 * press Send.
 */
export function preTicks(ask: { days: { day: string }[]; times: readonly string[]; unavailable: readonly string[] }, slots: readonly string[]): string[] {
  if (!slots.length) return [];
  const free = new Set(slots);
  const off = new Set(ask.unavailable);
  const out: string[] = [];
  for (const { day } of ask.days) {
    const code = freeDayOf(day);
    if (!code) continue;
    for (const time of ask.times) {
      const key = `${day}T${time}`;
      if (free.has(freeSlot(code, time)) && !off.has(key)) out.push(key);
    }
  }
  return out.sort().slice(0, SLOTS_MAX);
}
