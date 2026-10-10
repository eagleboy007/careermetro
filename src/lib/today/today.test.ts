import { describe, expect, it } from "vitest";
import { departure, eventTeaser, goalsSummary, onYourLine, ride, rideWeek, signalCheck, streak } from "@/lib/schemas";
import { departureTone, departureWhen, greetingAt, streakLabel } from "./board";
import { exampleDepartures, exampleEvents, exampleGoals, exampleOnYourLine, exampleRide, exampleSignalCheck, exampleStreak, exampleWeek } from "./fixtures";

describe("Today fixtures", () => {
  it("match the Today schemas", () => {
    expect(() => ride.parse(exampleRide)).not.toThrow();
    expect(() => rideWeek.parse(exampleWeek)).not.toThrow();
    expect(() => streak.parse(exampleStreak)).not.toThrow();
    expect(() => goalsSummary.parse(exampleGoals)).not.toThrow();
    for (const d of exampleDepartures) expect(() => departure.parse(d)).not.toThrow();
    for (const e of exampleEvents) expect(() => eventTeaser.parse(e)).not.toThrow();
    expect(() => onYourLine.parse(exampleOnYourLine)).not.toThrow();
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

  it("reject a title emphasis that is not the end of the title, and a prove pitstop before this one", () => {
    expect(ride.safeParse({ ...exampleRide, titleEmphasis: "This week" }).success).toBe(false);
    expect(ride.safeParse({ ...exampleRide, prove: { ...exampleRide.prove!, pitstop: exampleRide.pitstop } }).success).toBe(false);
    expect(ride.parse({ ...exampleRide, titleEmphasis: undefined, prove: undefined })).toMatchObject({ titleEmphasis: "", prove: null });
  });

  it("reject a way to prove listed twice, and more faces than people on the line", () => {
    const [first] = exampleRide.prove!.options;
    expect(ride.safeParse({ ...exampleRide, prove: { ...exampleRide.prove!, options: [first, first] } }).success).toBe(false);
    expect(onYourLine.safeParse({ ...exampleOnYourLine, count: 2 }).success).toBe(false);
  });

  it("reject more named goals than goals left", () => {
    expect(goalsSummary.safeParse({ ...exampleGoals, moreCount: 0, moreNames: ["Statistics"] }).success).toBe(false);
  });

  it("reject a week that is not seven days", () => {
    expect(rideWeek.safeParse(exampleWeek.slice(0, 6)).success).toBe(false);
  });

  it("keep met out of a departure's gaps", () => {
    expect(
      departure.safeParse({
        ...exampleDepartures[0],
        gapsLeft: 1,
        gaps: [{ status: "met", name: "SQL" }],
      }).success,
    ).toBe(false);
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
    const twoNow = {
      ...g,
      pitstops: g.pitstops.map((p) => ({ ...p, state: "now" as const })),
    };
    expect(goalsSummary.safeParse({ ...exampleGoals, goals: [twoNow] }).success).toBe(false);
  });
});

describe("signal check schema", () => {
  it("accepts the example and needs the right answer among the options", () => {
    expect(() => signalCheck.parse(exampleSignalCheck)).not.toThrow();
    expect(
      signalCheck.safeParse({
        ...exampleSignalCheck,
        options: exampleSignalCheck.options.slice(0, 1),
      }).success,
    ).toBe(false);
    expect(
      signalCheck.safeParse({
        ...exampleSignalCheck,
        options: exampleSignalCheck.options.slice(0, 2),
        correctKey: "D",
      }).success,
    ).toBe(false);
  });

  it("needs options keyed A, B, C, D in order", () => {
    const [a, b, c] = exampleSignalCheck.options;
    expect(
      signalCheck.safeParse({
        ...exampleSignalCheck,
        options: [a, { ...b, key: "A" }, c],
      }).success,
    ).toBe(false);
    expect(signalCheck.safeParse({ ...exampleSignalCheck, options: [b, a, c] }).success).toBe(false);
  });

  it("needs an explanation and a source", () => {
    expect(signalCheck.safeParse({ ...exampleSignalCheck, explanation: "" }).success).toBe(false);
    expect(signalCheck.safeParse({ ...exampleSignalCheck, from: "" }).success).toBe(false);
  });
});

describe("ride signal task", () => {
  it("allows the signal check task only last, and locked", () => {
    const tasks = exampleRide.tasks.map((t) => ({ ...t, locked: false, signal: false }));
    const last = tasks.length - 1;
    expect(
      ride.safeParse({
        ...exampleRide,
        tasks: tasks.map((t, i) => ({ ...t, locked: i === last, signal: i === last })),
      }).success,
    ).toBe(true);
    expect(ride.safeParse({ ...exampleRide, tasks: tasks.map((t, i) => ({ ...t, signal: i === last })) }).success).toBe(false);
    expect(
      ride.safeParse({
        ...exampleRide,
        tasks: tasks.map((t, i) => ({ ...t, locked: i === 0, signal: i === 0 })),
      }).success,
    ).toBe(false);
  });
});

describe("greetingAt", () => {
  it("greets by the hour in India", () => {
    expect(greetingAt(new Date("2026-10-09T03:30:00Z"))).toBe("Morning"); // 09:00 IST
    expect(greetingAt(new Date("2026-10-09T08:30:00Z"))).toBe("Afternoon"); // 14:00 IST
    expect(greetingAt(new Date("2026-10-09T14:00:00Z"))).toBe("Evening"); // 19:30 IST
    expect(greetingAt(new Date("2026-10-09T20:00:00Z"))).toBe("Evening"); // 01:30 IST
  });
});
