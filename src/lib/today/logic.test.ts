import { describe, expect, it } from "vitest";
import { todayView } from "@/lib/schemas/today";
import { todayFixture } from "./fixture";
import { departureWhen, greeting, orderDepartures, rideProgress, streakCount, streakLabel, trainPosition, weekStrip, weeksAt } from "./logic";

describe("streak", () => {
  it("counts distinct ride days and never resets after a missed day", () => {
    expect(streakCount([])).toBe(0);
    expect(streakCount(["2026-10-05", "2026-10-06", "2026-10-09"])).toBe(3);
    expect(streakCount(["2026-10-05", "2026-10-05"])).toBe(1);
  });

  it("reads Day 1 before the first ticked task", () => {
    expect(streakLabel(0)).toEqual({ number: "Day", text: " 1" });
    expect(streakLabel(12)).toEqual({ number: "12", text: "-day streak" });
  });
});

describe("weekStrip", () => {
  it("runs Monday to Sunday around today and marks ride days", () => {
    // 2026-10-08 is a Thursday.
    const week = weekStrip(["2026-10-05", "2026-10-07", "2026-09-30"], "2026-10-08");
    expect(week.map((d) => d.date)).toEqual([
      "2026-10-05",
      "2026-10-06",
      "2026-10-07",
      "2026-10-08",
      "2026-10-09",
      "2026-10-10",
      "2026-10-11",
    ]);
    expect(week.map((d) => d.rode)).toEqual([true, false, true, false, false, false, false]);
    expect(week.findIndex((d) => d.isToday)).toBe(3);
    expect(week.filter((d) => d.isFuture)).toHaveLength(3);
  });

  it("handles a Sunday as the last day of the week", () => {
    const week = weekStrip([], "2026-10-11");
    expect(week[0].date).toBe("2026-10-05");
    expect(week[6].isToday).toBe(true);
  });
});

describe("rideProgress", () => {
  it("adds today's tasks to the week and caps at 1", () => {
    expect(rideProgress({ weekTotal: 5, doneBeforeToday: 2 }, 0)).toBeCloseTo(0.4);
    expect(rideProgress({ weekTotal: 5, doneBeforeToday: 2 }, 3)).toBe(1);
    expect(rideProgress({ weekTotal: 2, doneBeforeToday: 2 }, 2)).toBe(1);
  });
});

describe("departures", () => {
  it("says Boarding now only with zero gaps, and gaps left in words otherwise", () => {
    expect(departureWhen(0)).toEqual({ label: "Boarding now", tone: "now" });
    expect(departureWhen(1)).toEqual({ label: "After 1 goal", tone: "soon" });
    expect(departureWhen(2)).toEqual({ label: "After 2 goals", tone: "soon" });
    expect(departureWhen(4)).toEqual({ label: "After 4 goals", tone: "later" });
  });

  it("orders rows by gaps left and keeps ties stable", () => {
    const rows = [
      { id: "a", gaps: [1, 2] },
      { id: "b", gaps: [] },
      { id: "c", gaps: [1] },
      { id: "d", gaps: [] },
    ].map((r) => ({ ...r, gaps: r.gaps.map(() => ({ skillName: "x", status: "missing" as const })) }));
    expect(orderDepartures(rows).map((r) => r.id)).toEqual(["b", "d", "c", "a"]);
  });
});

describe("trainPosition", () => {
  it("rides toward the current pitstop and arrives only when the week's prep is done", () => {
    expect(trainPosition(3, 0)).toBe(2);
    expect(trainPosition(3, 0.5)).toBeCloseTo(2.47);
    expect(trainPosition(3, 1)).toBe(3);
    expect(trainPosition(0, 0.6)).toBe(0);
  });
});

describe("helpers", () => {
  it("rounds weeks up", () => {
    expect(weeksAt(5, 68)).toBe(14);
    expect(weeksAt(12, 10)).toBe(1);
  });

  it("greets by time of day", () => {
    expect(greeting(9, "Priya")).toBe("Morning, Priya.");
    expect(greeting(14, "Priya")).toBe("Afternoon, Priya.");
    expect(greeting(19, "Priya")).toBe("Evening, Priya.");
  });
});

describe("todayFixture", () => {
  it.each(["returning", "first_signup", "no_resume"] as const)("is a valid %s view", (state) => {
    const view = todayFixture(state);
    expect(() => todayView.parse(view)).not.toThrow();
    expect(view.state).toBe(state);
  });

  it("only fills a goal with a prove pitstop", () => {
    for (const goal of todayFixture("returning").goals) {
      if (goal.status === "met") continue;
      expect(goal.pitstops.at(-1)?.kind).toBe("prove");
    }
  });

  it("has no ride or goals before a resume", () => {
    const view = todayFixture("no_resume");
    expect(view.ride).toBeNull();
    expect(view.goals).toEqual([]);
    expect(view.rideDays).toEqual([]);
  });

  it("has no ride days on first sign-up", () => {
    expect(todayFixture("first_signup").rideDays).toEqual([]);
  });
});
