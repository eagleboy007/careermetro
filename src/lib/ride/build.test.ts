import { describe, expect, it } from "vitest";
import { ride as rideSchema } from "@/lib/schemas";
import { buildRide, type RideGoal } from "./build";

const res = (id: string, minutes = 30) => ({ id, title: `Course ${id}`, provider: "Kaggle Learn", kind: "course", minutes });
const goal = (p: Partial<RideGoal> & { goalId: string }): RideGoal => ({
  name: p.goalId.toUpperCase(),
  status: "missing",
  proved: false,
  resources: [res(`${p.goalId}-1`), res(`${p.goalId}-2`)],
  practice: `Practice ${p.goalId}`,
  learnDone: false,
  ...p,
});

describe("buildRide", () => {
  it("rides the first goal not proved, with its courses and practice as tasks, and the prove pitstop next", () => {
    const r = buildRide({ goals: [goal({ goalId: "sql" }), goal({ goalId: "pbi" })], everDone: new Set(), doneThisWeek: new Set() })!;
    expect(rideSchema.safeParse(r).success).toBe(true);
    expect(r).toMatchObject({ pitstop: 1, pitstopCount: 4, goalName: "SQL", titleEmphasis: "your SQL goal.", weekTasksDone: 0, weekTasksTotal: 3 });
    expect(r.tasks.map((t) => t.id)).toEqual(["sql:r:sql-1", "sql:r:sql-2", "sql:practice"]);
    expect(r.prove).toMatchObject({ pitstop: 2 });
    expect(r.prove!.options.map((o) => o.kind)).toEqual(["check", "cert", "work"]);
    // A 30 minute course is one 25 minute sitting today; the ride stays about an evening long.
    expect(r.tasks[0]).toMatchObject({ minutes: 25, detail: "Kaggle Learn · course · 25 min of 30 min" });
    expect(r.tasks.reduce((n, t) => n + t.minutes, 0)).toBeLessThanOrEqual(70);
  });

  it("moves on to the next goal once every task is ticked, and the train passes proved goals", () => {
    const done = new Set(["sql:r:sql-1", "sql:r:sql-2", "sql:practice"]);
    const r = buildRide({ goals: [goal({ goalId: "sql" }), goal({ goalId: "pbi" })], everDone: done, doneThisWeek: new Set(["sql:practice"]) })!;
    expect(r).toMatchObject({ goalName: "PBI", pitstop: 3, weekTasksDone: 0 });

    const proved = buildRide({
      goals: [goal({ goalId: "sql", proved: true }), goal({ goalId: "pbi" })],
      everDone: new Set(),
      doneThisWeek: new Set(),
    })!;
    expect(proved).toMatchObject({ goalName: "PBI", pitstop: 3 });
  });

  it("keeps a ticked task showing as done today, and counts this week's ticks", () => {
    const r = buildRide({ goals: [goal({ goalId: "sql" })], everDone: new Set(["sql:r:sql-1"]), doneThisWeek: new Set(["sql:r:sql-1"]) })!;
    expect(r.tasks.map((t) => [t.id, t.done])).toEqual([
      ["sql:r:sql-1", true],
      ["sql:r:sql-2", false],
      ["sql:practice", false],
    ]);
    expect(r.weekTasksDone).toBe(1);
  });

  it("counts a step marked done on the Path page as every task ticked", () => {
    const r = buildRide({
      goals: [goal({ goalId: "sql", learnDone: true }), goal({ goalId: "pbi" })],
      everDone: new Set(),
      doneThisWeek: new Set(),
    })!;
    expect(r).toMatchObject({ goalName: "PBI" });
  });

  it("stays on the last goal not proved when every task is done, waiting for proof", () => {
    const done = new Set(["sql:r:sql-1", "sql:r:sql-2", "sql:practice"]);
    const r = buildRide({ goals: [goal({ goalId: "sql" })], everDone: done, doneThisWeek: new Set() })!;
    expect(r).toMatchObject({ goalName: "SQL", pitstop: 1 });
    expect(r.tasks.every((t) => t.done)).toBe(true);
    expect(r.summary).toMatch(/prove/i);
  });

  it("builds valid tasks from real ids (a goal's and a course's uuid)", () => {
    const goalId = "0f8e9c1a-3b2d-4c5e-8f7a-1b2c3d4e5f60";
    const r = buildRide({ goals: [goal({ goalId, resources: [res("7a6b5c4d-3e2f-4a1b-9c8d-7e6f5a4b3c2d")] })], everDone: new Set(), doneThisWeek: new Set() })!;
    expect(rideSchema.safeParse(r).success).toBe(true);
    expect(r.tasks[0].id).toBe(`${goalId}:r:7a6b5c4d-3e2f-4a1b-9c8d-7e6f5a4b3c2d`);
  });

  it("points to the path when there are no courses yet, and has nothing to ride once every goal is proved", () => {
    const r = buildRide({ goals: [goal({ goalId: "sql", resources: [], practice: null })], everDone: new Set(), doneThisWeek: new Set() })!;
    expect(r.tasks.map((t) => t.id)).toEqual(["open-path"]);
    expect(rideSchema.safeParse(r).success).toBe(true);
    expect(buildRide({ goals: [goal({ goalId: "sql", proved: true })], everDone: new Set(), doneThisWeek: new Set() })).toBeNull();
  });
});
