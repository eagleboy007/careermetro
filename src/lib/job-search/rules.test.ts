import { describe, expect, it } from "vitest";
import { CAN_JOIN } from "@/lib/schemas/constants";
import { addDays, canJoinFrom, daysBetween, jobSearchStatus, jobSearchToast, noticeCountdown, noticeDayText } from "./rules";

describe("job search rules", () => {
  it("counts calendar days across months and years", () => {
    expect(addDays("2026-10-01", 60)).toBe("2026-11-30");
    expect(addDays("2026-12-20", 15)).toBe("2027-01-04");
    expect(daysBetween("2026-10-09", "2026-11-30")).toBe(52);
    expect(daysBetween("2026-11-30", "2026-10-09")).toBe(-52);
  });

  it("works out the last working day, the day free to join, the days left and how much is served", () => {
    // The prototype's example: 60 days from 1 Oct, seen on 9 Oct.
    expect(noticeCountdown("2026-10-01", 60, "2026-10-09")).toEqual({ lastDay: "2026-11-30", joinFrom: "2026-12-01", left: 52, served: 13 });
    // On the day of resigning nothing is served yet.
    expect(noticeCountdown("2026-10-20", 30, "2026-10-20")).toMatchObject({ left: 30, served: 0 });
    // After the last working day there are no days left, never fewer.
    expect(noticeCountdown("2026-01-01", 15, "2026-10-20")).toMatchObject({ lastDay: "2026-01-16", joinFrom: "2026-01-17", left: 0, served: 100 });
  });

  it("prefills Can join with the nearest choice not earlier than the day free to join", () => {
    expect(canJoinFrom("2026-10-20", "2026-10-20")).toBe("now");
    expect(canJoinFrom("2026-10-01", "2026-10-20")).toBe("now");
    expect(canJoinFrom("2026-10-21", "2026-10-20")).toBe("30");
    expect(canJoinFrom("2026-11-19", "2026-10-20")).toBe("30");
    expect(canJoinFrom("2026-11-20", "2026-10-20")).toBe("60");
    expect(canJoinFrom("2026-12-19", "2026-10-20")).toBe("60");
    expect(canJoinFrom("2026-12-20", "2026-10-20")).toBe("90");
    expect(canJoinFrom("2027-01-19", "2026-10-20")).toBe("90");
    for (const day of ["2026-10-20", "2026-11-01", "2026-12-01", "2027-01-19"]) expect(CAN_JOIN).toContain(canJoinFrom(day, "2026-10-20"));
  });

  it("writes a day as the prototype does", () => {
    expect(noticeDayText("2026-11-30")).toBe("Mon 30 Nov");
    expect(noticeDayText("2026-12-01")).toBe("Tue 1 Dec");
  });

  it("says looking while on, the current employer while off, and nothing without one", () => {
    expect(jobSearchStatus(true, "Konkan Co-operative Bank")).toBe("Looking for a next role");
    expect(jobSearchStatus(false, "Konkan Co-operative Bank")).toBe("Working at Konkan Co-operative Bank");
    expect(jobSearchStatus(false, null)).toBeNull();
    expect(jobSearchToast(true)).toBe("Job search is on. Departures and Arrivals are back.");
    expect(jobSearchToast(false)).toBe("Job search is off. Your rides and map keep going.");
  });
});
