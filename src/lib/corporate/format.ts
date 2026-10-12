/** "12 Oct 2026" from an ISO date ("2026-10-12"), read as a calendar day so it never shifts with the time zone. */
export function formatDay(iso: string): string {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

/** "14 days", "1 day", "0 days". */
export const daysText = (n: number): string => `${n} ${n === 1 ? "day" : "days"}`;
