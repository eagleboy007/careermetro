import { calendarDayWords } from "@/lib/day-words";

/** "12 Oct 2026" from an ISO date ("2026-10-12"), read as a calendar day so it never shifts with the time zone. */
export const formatDay = (iso: string): string => calendarDayWords(iso, { year: true });

/** "14 days", "1 day", "0 days". */
export const daysText = (n: number): string => `${n} ${n === 1 ? "day" : "days"}`;
