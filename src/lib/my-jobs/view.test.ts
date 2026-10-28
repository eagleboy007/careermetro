import { describe, expect, it } from "vitest";
import { countdownWords, daysUntil, interviewWhen, minuteValue } from "./view";

describe("the interview in IST (handoff 12m)", () => {
  const at = "2026-10-30T05:00:00.000Z"; // 10:30 IST on Thursday 30 October

  it("fills the date and time field in IST", () => {
    expect(minuteValue(at)).toBe("2026-10-30T10:30");
    expect(minuteValue(null)).toBe("");
  });

  it("shows the day and time in IST", () => {
    expect(interviewWhen(at)).toBe("Thu 30 Oct, 10:30");
    expect(interviewWhen("2026-10-30T19:00:00.000Z")).toBe("Sat 31 Oct, 00:30");
  });

  it("counts India days, not 24-hour spans", () => {
    expect(daysUntil(at, new Date("2026-10-30T01:00:00.000Z"))).toBe(0);
    // 23:00 IST the evening before is one day out, though only 11.5 hours remain.
    expect(daysUntil(at, new Date("2026-10-29T17:30:00.000Z"))).toBe(1);
    // 00:30 IST on the 30th, still 29 October in UTC, is already the day.
    expect(daysUntil(at, new Date("2026-10-29T19:00:00.000Z"))).toBe(0);
    expect(daysUntil(at, new Date("2026-10-27T05:00:00.000Z"))).toBe(3);
  });

  it("says the countdown in words", () => {
    expect([0, 1, 3].map(countdownWords)).toEqual(["today", "tomorrow", "in 3 days"]);
  });
});
