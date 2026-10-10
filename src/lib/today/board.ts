/** Words for a Departures row: 0 required gaps is "Boarding now"; otherwise how many goals stand in the way. */
export function departureWhen(gapsLeft: number): string {
  if (gapsLeft === 0) return "Boarding now";
  return gapsLeft === 1 ? "After 1 goal" : `After ${gapsLeft} goals`;
}

export type DepartureTone = "now" | "soon" | "later";

/** Green only for zero gaps; amber for one or two; the rest stay dim. */
export function departureTone(gapsLeft: number): DepartureTone {
  if (gapsLeft === 0) return "now";
  return gapsLeft <= 2 ? "soon" : "later";
}

/** Streak chip words: "Day 1" before the first ride, then "N-day streak". */
export function streakLabel(days: number): string {
  return days === 0 ? "Day 1" : `${days}-day streak`;
}

/** "Morning", "Afternoon" or "Evening" for the ride card, by the hour in India. */
export function greetingAt(date: Date): "Morning" | "Afternoon" | "Evening" {
  const hour = Number(new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hourCycle: "h23", timeZone: "Asia/Kolkata" }).format(date));
  if (hour >= 4 && hour < 12) return "Morning";
  return hour >= 12 && hour < 17 ? "Afternoon" : "Evening";
}
