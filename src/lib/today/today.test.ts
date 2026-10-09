import { describe, expect, it } from "vitest";
import { departure, goalsSummary, ride, rideWeek, signalCheck, streak } from "@/lib/schemas";
import { departureTone, departureWhen, streakLabel } from "./board";
import { exampleDepartures, exampleGoals, exampleRide, exampleSignalCheck, exampleStreak, exampleWeek } from "./fixtures";

describe("Today fixtures", () => {
  it("match the Today schemas", () => {
    expect(() => ride.parse(exampleRide)).not.toThrow();
    expect(() => rideWeek.parse(exampleWeek)).not.toThrow();
    expect(() => streak.parse(exampleStreak)).not.toThrow();
    expect(() => goalsSummary.parse(exampleGoals)).not.toThrow();
    for (const d of exampleDepartures) expect(() => departure.parse(d)).not.toThrow();
  });

  it("mark exactly one day as today", () => {
    expect(exampleWeek.filter((d) => d.today)).toHaveLength(1);
  });

  it("list as many gaps as each departure says are left", () => {
    for (const d of exampleDepartures) expect(d.gaps).toHaveLength(d.gapsLeft);
  });
});

describe("Today schemas", () => {
  it("reject a ride with more than three tasks", () => {
    const task = exampleRide.tasks[0];
    expect(ride.safeParse({ ...exampleRide, tasks: [task, task, task, task] }).success).toBe(false);
  });

  it("reject a week that is not seven days", () => {
    expect(rideWeek.safeParse(exampleWeek.slice(0, 6)).success).toBe(false);
  });

  it("keep met out of a departure's gaps", () => {
    expect(departure.safeParse({ ...exampleDepartures[0], gapsLeft: 1, gaps: [{ status: "met", name: "SQL" }] }).success).toBe(false);
  });
});

describe("board words", () => {
  it("says Boarding now only at zero gaps", () => {
    expect(departureWhen(0)).toBe("Boarding now");
    expect(departureWhen(1)).toBe("After 1 goal");
    expect(departureWhen(4)).toBe("After 4 goals");
  });

  it("keeps green for zero gaps and amber for one or two", () => {
    expect([0, 1, 2, 3].map(departureTone)).toEqual(["now", "soon", "soon", "later"]);
  });

  it("reads Day 1 before the first ride", () => {
    expect(streakLabel(0)).toBe("Day 1");
    expect(streakLabel(12)).toBe("12-day streak");
  });
});

describe("Today schema checks", () => {
  it("reject a pitstop past the last one and more tasks done than planned", () => {
    expect(ride.safeParse({ ...exampleRide, pitstop: 10, pitstopCount: 9 }).success).toBe(false);
    expect(ride.safeParse({ ...exampleRide, weekTasksDone: 6, weekTasksTotal: 5 }).success).toBe(false);
  });

  it("need exactly one today in the week", () => {
    expect(rideWeek.safeParse(exampleWeek.map((d) => ({ ...d, today: false }))).success).toBe(false);
    expect(rideWeek.safeParse(exampleWeek.map((d) => ({ ...d, today: true }))).success).toBe(false);
  });

  it("allow at most one current pitstop per goal", () => {
    const g = exampleGoals.goals[0];
    const twoNow = { ...g, pitstops: g.pitstops.map((p) => ({ ...p, state: "now" as const })) };
    expect(goalsSummary.safeParse({ ...exampleGoals, goals: [twoNow] }).success).toBe(false);
  });
});

describe("signal check schema", () => {
  it("accepts the example and needs the right answer among the options", () => {
    expect(() => signalCheck.parse(exampleSignalCheck)).not.toThrow();
    expect(signalCheck.safeParse({ ...exampleSignalCheck, options: exampleSignalCheck.options.slice(0, 1) }).success).toBe(false);
    const noB = exampleSignalCheck.options.filter((o) => o.key !== "B");
    expect(signalCheck.safeParse({ ...exampleSignalCheck, options: noB }).success).toBe(false);
  });

  it("rejects repeated option keys", () => {
    const [a, b] = exampleSignalCheck.options;
    expect(signalCheck.safeParse({ ...exampleSignalCheck, options: [a, { ...b, key: "A" }, b] }).success).toBe(false);
  });
});
