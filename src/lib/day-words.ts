/*
 * Dates in words, from fixed English names and plain arithmetic, for anything a page shows. Never Intl or toLocale*:
 * their month and weekday names and their punctuation come from the ICU data of whichever runtime renders, and Node on
 * the server and the browser can carry different versions ("28 Sep 2026" in one, "28 Sept 2026" in the other). A client
 * component then renders one thing on the server and another in the browser, and hydration fails (React #418, seen on
 * /design in a local walk while CI agreed). The client-bundle test keeps Intl dates out of what client components load.
 * India time is UTC+5:30 with no daylight saving, whatever zone the server or the browser runs in.
 */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const WEEKDAYS_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;
const IST_MS = 5.5 * 3600_000;

type Words = { weekday?: boolean; year?: boolean };

/** The moment shifted to India time, read back with the UTC getters. */
const ist = (at: Date | string): Date => new Date((typeof at === "string" ? Date.parse(at) : at.getTime()) + IST_MS);
/** A calendar day ("2026-10-13", or the date part of a longer ISO string) at UTC midnight. */
const calendar = (iso: string): Date => new Date(`${iso.slice(0, 10)}T00:00:00Z`);

function words(d: Date, { weekday = false, year = false }: Words): string {
  const day = `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}${year ? ` ${d.getUTCFullYear()}` : ""}`;
  return weekday ? `${WEEKDAYS[d.getUTCDay()]} ${day}` : day;
}

/** "13 Oct", "Tue 13 Oct" or "13 Oct 2026": the India date of a moment. */
export const istDayWords = (at: Date | string, opts: Words = {}): string => words(ist(at), opts);

/** The same for a calendar day ("2026-10-13"), which never moves with a time zone. The input as given if it isn't one. */
export function calendarDayWords(iso: string, opts: Words = {}): string {
  const d = calendar(iso);
  return Number.isNaN(d.getTime()) ? iso : words(d, opts);
}

/** "10:30", 24-hour, India time. */
export const istClock = (at: Date | string): string => ist(at).toISOString().slice(11, 16);

/** The hour in India, 0 to 23. */
export const istHour = (at: Date): number => ist(at).getUTCHours();

/** "2026-10-13": the India date of a moment, as a date field takes it. */
export const istDate = (at: Date | string): string => ist(at).toISOString().slice(0, 10);

/** "Thu" to "Thursday"; the input as given if it isn't a short weekday name. */
export const longWeekday = (short: string): string => WEEKDAYS_LONG[WEEKDAYS.indexOf(short as (typeof WEEKDAYS)[number])] ?? short;
