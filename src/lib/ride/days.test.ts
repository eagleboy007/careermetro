import { describe, expect, it } from "vitest";
import { rideWeek, streak } from "@/lib/schemas";
import { indiaDay, streakFor, toggled, weekFor } from "./days";

describe("indiaDay", () => {
  it("counts a tick at 11:30 pm India time for that day, not the next", () => {
    expect(indiaDay(new Date("2026-10-10T18:00:00Z"))).toBe("2026-10-10"); // 11:30 pm IST
    expect(indiaDay(new Date("2026-10-10T18:30:00Z"))).toBe("2026-10-11"); // midnight IST
    expect(indiaDay(new Date("2026-10-09T19:00:00Z"))).toBe("2026-10-10"); // 00:30 am IST
  });
});

describe("streakFor", () => {
  it("counts ride days, and a missed day pauses the count without resetting it", () => {
    const days = [
      { day: "2026-10-01", taskIds: ["a"] },
      { day: "2026-10-02", taskIds: ["a", "b"] },
      // 3 to 6 missed
      { day: "2026-10-07", taskIds: ["c"] },
      { day: "2026-10-08", taskIds: [] }, // ticked then unticked: not a ride
    ];
    expect(streakFor(days, "2026-10-09")).toEqual({ days: 3, todayCounted: false });
    expect(streakFor(days, "2026-10-07")).toEqual({ days: 3, todayCounted: true });
    expect(streakFor([], "2026-10-07")).toEqual({ days: 0, todayCounted: false });
    expect(streak.safeParse(streakFor(days, "2026-10-09")).success).toBe(true);
  });
});

describe("weekFor", () => {
  it("shows Monday to Sunday of today's week with the days ridden", () => {
    // 2026-10-08 is a Thursday.
    const week = weekFor(
      [
        { day: "2026-10-05", taskIds: ["a"] },
        { day: "2026-10-07", taskIds: ["b"] },
        { day: "2026-10-04", taskIds: ["z"] },
      ],
      "2026-10-08",
    );
    expect(week.map((d) => [d.label, d.rode, d.today])).toEqual([
      ["M", true, false],
      ["T", false, false],
      ["W", true, false],
      ["T", false, true],
      ["F", false, false],
      ["S", false, false],
      ["S", false, false],
    ]);
    expect(rideWeek.safeParse(week).success).toBe(true);
    // Sunday belongs to the week that started on Monday before it.
    expect(weekFor([], "2026-10-11").findIndex((d) => d.today)).toBe(6);
  });
});

describe("toggled", () => {
  it("adds a task once and removes it", () => {
    expect(toggled(["a"], "b", true)).toEqual(["a", "b"]);
    expect(toggled(["a", "b"], "b", true)).toEqual(["a", "b"]);
    expect(toggled(["a", "b"], "a", false)).toEqual(["b"]);
  });
});
