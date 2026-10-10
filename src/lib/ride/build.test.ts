import { describe, expect, it } from "vitest";
import { ride as rideSchema } from "@/lib/schemas";
import { buildRide, taskIdsOf, type RideGoal } from "./build";

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
const ride = (goals: RideGoal[], d: { before?: string[]; today?: string[]; week?: string[] } = {}) =>
  buildRide({ goals, doneBefore: new Set(d.before ?? []), doneToday: new Set(d.today ?? []), doneThisWeek: new Set(d.week ?? []) });
const SQL = ["sql:r:sql-1", "sql:r:sql-2", "sql:practice"];

describe("buildRide", () => {
  it("rides the first goal not proved, with its courses and practice as tasks, and the prove pitstop next", () => {
    const r = ride([goal({ goalId: "sql" }), goal({ goalId: "pbi" })])!;
    expect(rideSchema.safeParse(r).success).toBe(true);
    expect(r).toMatchObject({ pitstop: 1, pitstopCount: 4, goalName: "SQL", titleEmphasis: "your SQL goal.", weekTasksDone: 0, weekTasksTotal: 3 });
    expect(r.tasks.map((t) => t.id)).toEqual(SQL);
    expect(r.prove).toMatchObject({ pitstop: 2 });
    expect(r.prove!.options.map((o) => o.kind)).toEqual(["check", "cert", "work"]);
    // A 30 minute course is one 25 minute sitting today; the ride stays about an evening long.
    expect(r.tasks[0]).toMatchObject({ minutes: 25, detail: "Kaggle Learn · course · 25 min of 30 min" });
    expect(r.tasks.reduce((n, t) => n + t.minutes, 0)).toBeLessThanOrEqual(70);
  });

  it("drops tasks done on an earlier day, keeps today's ticks so they can be taken back, and counts the week", () => {
    const r = ride([goal({ goalId: "sql" })], { before: ["sql:r:sql-1"], today: ["sql:r:sql-2"], week: ["sql:r:sql-1", "sql:r:sql-2"] })!;
    expect(r.tasks.map((t) => [t.id, t.done])).toEqual([
      ["sql:r:sql-2", true],
      ["sql:practice", false],
    ]);
    expect(r).toMatchObject({ weekTasksDone: 2, weekTasksTotal: 3 });
  });

  it("stays on a goal while today's ticks finish it, then moves on the next day; proved goals are passed", () => {
    expect(ride([goal({ goalId: "sql" }), goal({ goalId: "pbi" })], { today: SQL })).toMatchObject({ goalName: "SQL" });
    expect(ride([goal({ goalId: "sql" }), goal({ goalId: "pbi" })], { before: SQL })).toMatchObject({ goalName: "PBI", pitstop: 3 });
    expect(ride([goal({ goalId: "sql", proved: true }), goal({ goalId: "pbi" })])).toMatchObject({ goalName: "PBI", pitstop: 3 });
  });

  it("counts a step marked done on the Path page as every task ticked", () => {
    expect(ride([goal({ goalId: "sql", learnDone: true }), goal({ goalId: "pbi" })])).toMatchObject({ goalName: "PBI" });
  });

  it("waits on the first goal not proved, showing its tasks done, once every task is done", () => {
    const r = ride([goal({ goalId: "sql" })], { before: SQL })!;
    expect(r).toMatchObject({ goalName: "SQL", pitstop: 1 });
    expect(r.tasks.every((t) => t.done)).toBe(true);
    expect(r.summary).toMatch(/prove/i);
  });

  it("treats a goal with no courses yet as unfinished, with its own open-path task", () => {
    const r = ride([goal({ goalId: "sql", resources: [], practice: null }), goal({ goalId: "pbi" })])!;
    expect(r).toMatchObject({ goalName: "SQL" });
    expect(r.tasks.map((t) => t.id)).toEqual(["sql:open-path"]);
    expect(r.summary).not.toMatch(/are done/);
    expect(rideSchema.safeParse(r).success).toBe(true);
  });

  it("builds valid tasks from real ids (a goal's and a course's uuid)", () => {
    const goalId = "0f8e9c1a-3b2d-4c5e-8f7a-1b2c3d4e5f60";
    const r = ride([goal({ goalId, resources: [res("7a6b5c4d-3e2f-4a1b-9c8d-7e6f5a4b3c2d")] })])!;
    expect(rideSchema.safeParse(r).success).toBe(true);
    expect(r.tasks[0].id).toBe(`${goalId}:r:7a6b5c4d-3e2f-4a1b-9c8d-7e6f5a4b3c2d`);
  });

  it("has nothing to ride once every goal is proved, and only open goals' tasks can be ticked", () => {
    expect(ride([goal({ goalId: "sql", proved: true })])).toBeNull();
    expect([...taskIdsOf([goal({ goalId: "sql", proved: true }), goal({ goalId: "pbi", resources: [], practice: null })])]).toEqual([
      "pbi:open-path",
    ]);
  });
});
