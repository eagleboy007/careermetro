import { describe, expect, it } from "vitest";
import { ride as rideSchema } from "@/lib/schemas";
import { buildGoalsSummary, buildRide, type RideGoal, type RidePath } from "./build";

const res = (id: string, minutes = 30) => ({ id, title: `Course ${id}`, provider: "Kaggle Learn", kind: "course", minutes });
const goal = (p: Partial<RideGoal> & { goalId: string }): RideGoal => ({
  skillId: p.goalId,
  name: p.goalId.toUpperCase(),
  status: "missing",
  proved: false,
  resources: [res(`${p.goalId}-1`), res(`${p.goalId}-2`)],
  practice: `Practice ${p.goalId}`,
  learnDone: false,
  ...p,
});
const BUILT: RidePath = { href: "/resume/r1/path/data-analyst", built: true };
const ride = (goals: RideGoal[], d: { before?: string[]; today?: string[]; week?: string[]; path?: RidePath } = {}) =>
  buildRide({
    goals,
    path: d.path ?? BUILT,
    doneBefore: new Set(d.before ?? []),
    doneToday: new Set(d.today ?? []),
    doneThisWeek: new Set(d.week ?? []),
  });
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

  it("offers only certificates that fill the goal, through its one-of group too, and says when it needs renewing", () => {
    const sql = ride([goal({ goalId: "g1", skillId: "sql", name: "SQL" })])!;
    expect(sql.prove).toMatchObject({ goalId: "g1", renew: false });
    expect(sql.prove!.certificates.map((c) => c.id)).toEqual(["oracle-sql-associate"]);

    const cloud = ride([goal({ goalId: "g2", skillId: "aws", proofSkills: ["aws", "azure"], renew: true })])!;
    const ids = cloud.prove!.certificates.map((c) => c.id);
    expect(ids).toContain("aws-cloud-practitioner");
    expect(ids).toContain("azure-fundamentals");
    expect(cloud.prove!.renew).toBe(true);
    expect(cloud.summary).toMatch(/has expired/);
    expect(cloud.prove!.options.find((o) => o.kind === "cert")!.action).toBe("Renew");

    // A certificate rejected after review (FR-44) is said on the prove pitstop.
    expect(sql.prove!.notConfirmed).toBe(false);
    expect(ride([goal({ goalId: "g4", skillId: "sql", notConfirmed: true })])!.prove!.notConfirmed).toBe(true);

    const none = ride([goal({ goalId: "g3", skillId: "no-such-skill" })])!;
    expect(none.prove!.certificates).toEqual([]);
    expect(none.prove!.options.find((o) => o.kind === "cert")!.detail).toMatch(/No certificate on our list/);
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

  it("before a path exists, links each goal to the Path page with a task that can't be ticked by hand", () => {
    const none = { resources: [], practice: null };
    const r = ride([goal({ goalId: "sql", ...none }), goal({ goalId: "pbi", ...none })], { path: { ...BUILT, built: false } })!;
    expect(r).toMatchObject({ goalName: "SQL" });
    expect(r.tasks).toMatchObject([{ id: "sql:open-path", locked: true, done: false, href: BUILT.href }]);
    expect(r.summary).not.toMatch(/are done/);
    expect(rideSchema.safeParse(r).success).toBe(true);
  });

  it("gives a goal the path left out one self-study task", () => {
    const r = ride([goal({ goalId: "sql", resources: [], practice: null })])!;
    expect(r.tasks).toMatchObject([{ id: "sql:self-study", locked: false, href: null }]);
  });

  it("fixes tasks done on an earlier day once the goal waits for proof, so they can't be unticked", () => {
    const r = ride([goal({ goalId: "sql" })], { before: SQL })!;
    expect(r.tasks.every((t) => t.done && t.locked)).toBe(true);
    // Today's own ticks stay open to change until tomorrow.
    expect(ride([goal({ goalId: "sql" })], { today: SQL })!.tasks.every((t) => t.done && !t.locked)).toBe(true);
  });

  it("builds valid tasks from real ids (a goal's and a course's uuid)", () => {
    const goalId = "0f8e9c1a-3b2d-4c5e-8f7a-1b2c3d4e5f60";
    const r = ride([goal({ goalId, resources: [res("7a6b5c4d-3e2f-4a1b-9c8d-7e6f5a4b3c2d")] })])!;
    expect(rideSchema.safeParse(r).success).toBe(true);
    expect(r.tasks[0].id).toBe(`${goalId}:r:7a6b5c4d-3e2f-4a1b-9c8d-7e6f5a4b3c2d`);
  });

  // T14: a rider who proved everything stays a returning rider, at Match, pointed at the roles to board.
  it("arrives at Match once every goal is proved, and has nothing to ride with no goals", () => {
    const r = ride([goal({ goalId: "sql", proved: true })]);
    expect(r).toMatchObject({ pitstop: 3, pitstopCount: 2, goalName: "Practice", prove: null });
    expect(r!.tasks).toEqual([expect.objectContaining({ id: "all-proved", locked: true, href: "/departures" })]);
    expect(ride([])).toBeNull();
  });
});

describe("buildGoalsSummary", () => {
  const gaps = [
    { skillId: "sql", skillName: "SQL", status: "missing" as const, resumeQuote: null, requirement: "r", explanation: "Nothing shows SQL." },
    { skillId: "pbi", skillName: "PBI", status: "weak" as const, resumeQuote: "Power BI", requirement: "r", explanation: "Listed only." },
  ];
  const summary = (goals: RideGoal[], d: { before?: string[]; today?: string[] } = {}) =>
    buildGoalsSummary({
      goals,
      path: BUILT,
      doneBefore: new Set(d.before ?? []),
      doneToday: new Set(d.today ?? []),
      doneThisWeek: new Set(),
      role: "Data Analyst",
      gaps,
    });

  it("lists the person's own open goals with pitstops numbered as on the ride", () => {
    const s = summary([goal({ goalId: "sql" }), goal({ goalId: "pbi", status: "weak" })], { today: ["sql:r:sql-1"] });
    expect(s.track).toBe("Data Analyst");
    expect(s.goals.map((g) => [g.name, g.status, g.evidence, g.quote])).toEqual([
      ["SQL", "missing", "Nothing shows SQL.", null],
      ["PBI", "weak", "Listed only.", "Power BI"],
    ]);
    expect(s.goals[0].pitstops).toMatchObject([
      { number: 1, kind: "learn", state: "now", note: "1 of 3 tasks" },
      { number: 2, kind: "prove", state: "ahead" },
    ]);
    expect(s.goals[1].pitstops.map((p) => [p.number, p.state])).toEqual([
      [3, "ahead"],
      [4, "ahead"],
    ]);
  });

  it("moves to the prove pitstop once learning is done, skips proved goals and counts the rest", () => {
    const goals = ["a", "b", "c", "d", "e"].map((id) => goal({ goalId: id }));
    goals[0].proved = true;
    const s = summary(goals, { before: ["b:r:b-1", "b:r:b-2", "b:practice"] });
    expect(s.goals.map((g) => g.name)).toEqual(["B", "C", "D"]);
    // B waits for proof while the ride moves on to C.
    expect(s.goals[0].pitstops.map((p) => p.state)).toEqual(["done", "ahead"]);
    expect(s.goals[1].pitstops.map((p) => p.state)).toEqual(["now", "ahead"]);
    // Once every goal's learning is done, the ride waits on the first goal's proof.
    const all = goals.slice(1).flatMap((g) => [`${g.goalId}:r:${g.goalId}-1`, `${g.goalId}:r:${g.goalId}-2`, `${g.goalId}:practice`]);
    expect(summary(goals, { before: all }).goals[0].pitstops.map((p) => p.state)).toEqual(["done", "now"]);
    expect(s).toMatchObject({ moreCount: 1, moreNames: ["E"], metThisMonth: [] });
  });

  it("lists Your choice goals apart, on their own spur, tagged with their job, and never moves the train or arrival", () => {
    const chosen = goal({ goalId: "airflow", name: "Data pipeline orchestration", resources: [], practice: null, choice: { company: "Example Analytics Pvt Ltd" } });
    const dbt = goal({ goalId: "dbt", choice: { company: null } });
    const input = (goals: RideGoal[], before: string[] = []) => ({
      goals,
      path: BUILT,
      doneBefore: new Set(before),
      doneToday: new Set<string>(),
      doneThisWeek: new Set<string>(),
      role: "Data Analyst",
      gaps,
      chosen: [chosen, dbt],
    });
    const s = buildGoalsSummary(input([goal({ goalId: "sql" })], ["dbt:r:dbt-1", "dbt:r:dbt-2", "dbt:practice"]));
    expect(s.goals.map((g) => g.name)).toEqual(["SQL"]);
    expect(s.choiceGoals!.map((g) => [g.name, g.choice])).toEqual([
      ["Data pipeline orchestration", { company: "Example Analytics Pvt Ltd" }],
      ["DBT", { company: null }],
    ]);
    expect(s.choiceGoals![0].evidence).toBe("You added this goal for a job at Example Analytics Pvt Ltd. It doesn't change your match or your gaps.");
    expect(s.choiceGoals![1].evidence).toBe("You added this goal. It doesn't change your match or your gaps.");
    // Its own learn and prove pitstops, numbered on its spur; with no path step it studies on its own.
    expect(s.choiceGoals![0].pitstops.map((p) => [p.number, p.kind, p.state, p.title])).toEqual([
      [1, "learn", "ahead", "Study Data pipeline orchestration on your own"],
      [2, "prove", "ahead", "Prove: skill check, certificate or work"],
    ]);
    expect(s.choiceGoals![1].pitstops.map((p) => p.state)).toEqual(["done", "ahead"]);
    // Proved: met.
    const proved = buildGoalsSummary({ ...input([goal({ goalId: "sql" })]), chosen: [{ ...chosen, proved: true }] });
    expect(proved.choiceGoals![0]).toMatchObject({ status: "met", pitstops: [{ state: "done" }, { state: "done" }] });
    // Every gap goal proved: arrived, whatever Your choice goals are open (they aren't on the ride at all).
    expect(ride([{ ...goal({ goalId: "sql" }), proved: true }])).toMatchObject({ pitstop: 3, pitstopCount: 2, goalName: "Practice" });
  });
});
