import { describe, expect, it } from "vitest";
import { calendarDayWords, istClock, istDate, istDayWords, istHour, longWeekday } from "./day-words";

describe("day words", () => {
  it("writes a moment's India date and time, across the IST midnight", () => {
    expect(istDayWords("2026-10-13T05:00:00.000Z")).toBe("13 Oct");
    expect(istDayWords("2026-10-30T19:00:00.000Z", { weekday: true })).toBe("Sat 31 Oct");
    expect(istDayWords(new Date("2026-12-31T18:30:00.000Z"), { year: true })).toBe("1 Jan 2027");
    expect(istClock("2026-10-30T19:00:00.000Z")).toBe("00:30");
    expect(istClock("2026-10-30T05:00:00.000Z")).toBe("10:30");
    expect(istHour(new Date("2026-10-30T18:29:00.000Z"))).toBe(23);
    expect(istDate("2026-10-31T18:30:00.000Z")).toBe("2026-11-01");
  });

  it("writes September as Sep, whatever ICU data the runtime has", () => {
    expect(calendarDayWords("2026-09-28", { year: true })).toBe("28 Sep 2026");
    expect(istDayWords("2026-09-01T00:00:00.000Z")).toBe("1 Sep");
  });

  it("reads a calendar day without a time zone, and hands back what isn't one", () => {
    expect(calendarDayWords("2026-11-30", { weekday: true })).toBe("Mon 30 Nov");
    expect(calendarDayWords("2026-10-12T23:59:00Z", { year: true })).toBe("12 Oct 2026");
    expect(calendarDayWords("soon")).toBe("soon");
  });

  it("names a weekday in full", () => {
    expect(longWeekday("Thu")).toBe("Thursday");
    expect(longWeekday("Sun")).toBe("Sunday");
    expect(longWeekday("Someday")).toBe("Someday");
  });
});
