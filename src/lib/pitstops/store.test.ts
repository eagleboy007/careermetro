import { readFileSync } from "node:fs";
import { and, eq, inArray, like } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as schema from "@/db/schema";
import { roleProfiles, skillGroupMembers, skills } from "@/content";
import { exportAccountData } from "@/lib/account/export";
import { GAP_LIMITS, getGapsForOwner } from "@/lib/gaps/store";
import { mapLineFor } from "@/lib/map/store";
import { matchFor } from "@/lib/match/store";
import { getPathForOwner, markStepDone, PATH_LIMITS } from "@/lib/path/store";
import { ingestResume } from "@/lib/resume/ingest";
import { PARSE_MODEL, type ParseClient } from "@/lib/resume/parse";
import { confirmProfile } from "@/lib/resume/store";
import { mapLine, OWN_PITSTOPS_PER_GOAL, type Profile } from "@/lib/schemas";
import { addOwnPitstop, editOwnPitstop, OWN_POSITION_BASE, removeOwnPitstop } from "./store";

vi.mock("server-only", () => ({}));

// Add a pitstop on the Map (FR-58), against a real Postgres with migrations applied, like the other store tests.
const url = process.env.TEST_DATABASE_URL;
const sqlClient = url ? postgres(url, { max: 4, onnotice: () => {} }) : null;
const db = sqlClient ? drizzle(sqlClient, { schema }) : null;

const bytes = new TextEncoder().encode(readFileSync("fixtures/resumes/priya-sharma.txt", "utf8"));
const parsed: Profile = {
  headline: "Data Analyst",
  totalYearsExperience: 3,
  roles: [],
  skills: [{ name: "SQL", lastUsed: null, evidence: [] }],
  education: [],
  certifications: [],
};
const client = {
  beta: {
    messages: {
      create: vi.fn().mockResolvedValue({
        model: PARSE_MODEL,
        stop_reason: "end_turn",
        usage: { input_tokens: 3000, output_tokens: 1000 },
        content: [{ type: "text", text: JSON.stringify(parsed) }],
      }),
    },
  },
} as unknown as ParseClient;
const TEST_URL = "https://example.com/careermetro-pitstop-test/";

describe.skipIf(!db)("own pitstops (database)", () => {
  const run = `pit-${Date.now()}`;
  const userIds: string[] = [];
  const role = roleProfiles.find((r) => r.slug === "data-analyst")!;
  const limits = { explain: GAP_LIMITS.explainedPerOwnerPerDay, word: PATH_LIMITS.wordedPerOwnerPerDay };
  beforeAll(async () => {
    await db!.insert(schema.skills).values(skills.map(({ id, name, category }) => ({ id, name, category }))).onConflictDoNothing();
    // Five free courses for every skill of the role: the path picks at most three, so some are left to offer.
    await db!
      .insert(schema.resources)
      .values(
        role.skills.flatMap((s) => [1, 2, 3, 4, 5].map((n) => ({ title: `Pitstop course ${n} ${s.skillId}`, url: `${TEST_URL}${s.skillId}/${n}`, provider: "Test", kind: "course", skillIds: [s.skillId], minutes: 60 * n }))),
      )
      .onConflictDoNothing();
    vi.stubEnv("PARSE_DAILY_BUDGET_USD", "1000000");
    GAP_LIMITS.explainedPerOwnerPerDay = 0;
    PATH_LIMITS.wordedPerOwnerPerDay = 0;
  });
  afterAll(async () => {
    vi.unstubAllEnvs();
    GAP_LIMITS.explainedPerOwnerPerDay = limits.explain;
    PATH_LIMITS.wordedPerOwnerPerDay = limits.word;
    if (userIds.length) await db!.delete(schema.users).where(inArray(schema.users.id, userIds));
    await db!.delete(schema.resources).where(like(schema.resources.url, `${TEST_URL}%`));
    await sqlClient!.end();
  });

  async function person(n: string, { path = true } = {}) {
    const [row] = await db!.insert(schema.users).values({ email: `${run}-${n}@example.test`, name: "Test User" }).returning({ id: schema.users.id });
    userIds.push(row.id);
    const owner = { userId: row.id };
    const r = await ingestResume({ bytes, as: "text", owner, clientHash: `h-${run}-${n}` }, { db: db!, client });
    if (!r.ok) throw new Error(r.code);
    await confirmProfile(r.resumeId, owner, parsed, db!);
    const gaps = await getGapsForOwner(r.resumeId, owner, role, { db: db! });
    if (!gaps.ok) throw new Error(gaps.reason);
    await mapLineFor(row.id, db!); // makes the goals
    if (path) {
      const p = await getPathForOwner(r.resumeId, owner, role, 5, { db: db! });
      if (!p.ok) throw new Error(p.reason);
    }
    return { userId: row.id, resumeId: r.resumeId };
  }

  it("needs a path first", async () => {
    const { userId } = await person("nopath", { path: false });
    const line = await mapLineFor(userId, db!);
    expect(await addOwnPitstop(userId, { goalId: line!.goals[0].goalId, title: "Labs" }, { db: db! })).toEqual({ ok: false, error: "no_path" });
  });

  it("adds, shows, edits and removes one, and changes no gap, path, train, ride estimate or match", async () => {
    const { userId, resumeId } = await person("main");
    const before = await mapLineFor(userId, db!);
    const goal = before!.goals.find((g) => g.status === "missing" && g.goalId)!;
    const pathBefore = await getPathForOwner(resumeId, { userId }, role, 5, { db: db! });
    const at = new Date();
    const matchBefore = await matchFor(userId, 5, db!, at);
    const option = goal.pitstopOptions?.[0];
    expect(option).toBeDefined();
    // The courses offered are the next unused ones: never one already on the goal's path step.
    expect(goal.resources.map((r) => r.title)).not.toContain(option!.title);

    const added = await addOwnPitstop(userId, { goalId: goal.goalId, title: "  Blue   team labs ", resourceId: option!.id }, { db: db! });
    if (!added.ok) throw new Error(added.error);
    const [row] = await db!.select().from(schema.pathSteps).where(eq(schema.pathSteps.id, added.id));
    expect(row).toMatchObject({ source: "user", kind: "learn", reason: "Blue team labs", hours: 0, proofTask: "", doneAt: null, goalId: goal.goalId, skillId: goal.skillId });
    expect(row.position).toBeGreaterThan(OWN_POSITION_BASE);

    const after = await mapLineFor(userId, db!);
    expect(mapLine.safeParse(after).success).toBe(true);
    const shown = after!.goals.find((g) => g.goalId === goal.goalId)!;
    expect(shown.ownPitstops).toEqual([{ id: added.id, title: "Blue team labs", course: { id: option!.id, title: option!.title, detail: option!.detail } }]);
    // The course picked is no longer offered.
    expect(shown.pitstopOptions?.map((o) => o.id)).not.toContain(option!.id);
    // The line, the gaps, the path and the match are as they were.
    const strip = (l: typeof before) =>
      l!.goals.map((g) => {
        const rest = { ...g };
        delete rest.ownPitstops;
        delete rest.pitstopOptions;
        return rest;
      });
    expect(strip(after)).toEqual(strip(before));
    expect(await getPathForOwner(resumeId, { userId }, role, 5, { db: db! })).toEqual(pathBefore);
    expect(await matchFor(userId, 5, db!, at)).toEqual(matchBefore);
    // It can't be ticked as a path step.
    expect(await markStepDone(added.id, { userId }, true, db!)).toBe(false);

    expect(await editOwnPitstop(userId, added.id, { title: "Detection labs", resourceId: null }, { db: db! })).toEqual({ ok: true, id: added.id });
    expect((await mapLineFor(userId, db!))!.goals.find((g) => g.goalId === goal.goalId)!.ownPitstops).toEqual([{ id: added.id, title: "Detection labs", course: null }]);

    // Download your data lists it apart from the path's own steps.
    const data = await exportAccountData(userId, db!);
    expect(data!.exportVersion).toBe(38);
    expect(data!.ownPitstops).toEqual([{ goalSkill: goal.skillId, name: "Detection labs", resourceId: null }]);
    const steps = data!.resumes.flatMap((r) => r.profiles.flatMap((p) => p.gapAnalyses.flatMap((a) => a.paths.flatMap((x) => x.steps))));
    expect(steps.some((s) => s.reason === "Detection labs")).toBe(false);

    expect(await removeOwnPitstop(userId, added.id, { db: db! })).toEqual({ ok: true, id: added.id });
    expect(await removeOwnPitstop(userId, added.id, { db: db! })).toEqual({ ok: false, error: "not_found" });
    expect((await mapLineFor(userId, db!))!.goals.find((g) => g.goalId === goal.goalId)!.ownPitstops).toBeUndefined();
  });

  it("refuses bad names, other goals and courses, someone else's ids, app steps and more than the limits", async () => {
    const a = await person("limits");
    const b = await person("other");
    const line = await mapLineFor(a.userId, db!);
    const goal = line!.goals.find((g) => g.goalId && !g.proved)!;
    const other = (await mapLineFor(b.userId, db!))!.goals[0];
    const add = (body: unknown, userId = a.userId) => addOwnPitstop(userId, body, { db: db! });

    expect(await add({ goalId: goal.goalId, title: "" })).toEqual({ ok: false, error: "title" });
    expect(await add({ goalId: goal.goalId, title: "https://example.com/labs" })).toEqual({ ok: false, error: "link" });
    expect(await add({ goalId: other.goalId, title: "Labs" })).toEqual({ ok: false, error: "not_found" });
    // A course for another skill doesn't fit this goal.
    const courses = await db!.select({ id: schema.resources.id, skillIds: schema.resources.skillIds }).from(schema.resources).where(like(schema.resources.url, `${TEST_URL}%`));
    const fills = new Set([goal.skillId, ...[...skillGroupMembers.values()].filter((m) => m.includes(goal.skillId)).flat()]);
    const foreign = courses.find((c) => !c.skillIds.some((id) => fills.has(id)))!;
    expect(await add({ goalId: goal.goalId, title: "Labs", resourceId: foreign.id })).toEqual({ ok: false, error: "course" });

    const ids: string[] = [];
    for (let i = 0; i < OWN_PITSTOPS_PER_GOAL; i++) {
      const r = await add({ goalId: goal.goalId, title: `Labs ${i}` });
      if (!r.ok) throw new Error(r.error);
      ids.push(r.id);
    }
    expect(await add({ goalId: goal.goalId, title: "One more" })).toEqual({ ok: false, error: "per_goal" });
    // Someone else can't edit or remove them, and an app step is never one of them.
    expect(await editOwnPitstop(b.userId, ids[0], { title: "Mine now", resourceId: null }, { db: db! })).toEqual({ ok: false, error: "not_found" });
    expect(await removeOwnPitstop(b.userId, ids[0], { db: db! })).toEqual({ ok: false, error: "not_found" });
    const [appStep] = await db!.select({ id: schema.pathSteps.id }).from(schema.pathSteps).where(and(eq(schema.pathSteps.goalId, goal.goalId!), eq(schema.pathSteps.source, "app")));
    if (appStep) {
      expect(await removeOwnPitstop(a.userId, appStep.id, { db: db! })).toEqual({ ok: false, error: "not_found" });
      expect(await editOwnPitstop(a.userId, appStep.id, { title: "Renamed", resourceId: null }, { db: db! })).toEqual({ ok: false, error: "not_found" });
    }
    expect(await removeOwnPitstop(a.userId, "not-a-uuid", { db: db! })).toEqual({ ok: false, error: "not_found" });
  });

  it("keeps them on a new path for other hours, and deletes them with the account", async () => {
    const { userId, resumeId } = await person("keep");
    const goal = (await mapLineFor(userId, db!))!.goals.find((g) => g.goalId && !g.proved)!;
    const r = await addOwnPitstop(userId, { goalId: goal.goalId, title: "Labs" }, { db: db! });
    if (!r.ok) throw new Error(r.error);
    const other = await getPathForOwner(resumeId, { userId }, role, 10, { db: db! });
    if (!other.ok) throw new Error(other.reason);
    const [row] = await db!.select({ pathId: schema.pathSteps.pathId }).from(schema.pathSteps).where(eq(schema.pathSteps.id, r.id));
    expect(row.pathId).toBe(other.path.pathId);
    // The new path's own steps and hours don't include it.
    expect(other.path.steps.some((s) => s.id === r.id)).toBe(false);
    expect((await mapLineFor(userId, db!))!.goals.find((g) => g.goalId === goal.goalId)!.ownPitstops?.map((p) => p.title)).toEqual(["Labs"]);

    await db!.delete(schema.users).where(eq(schema.users.id, userId));
    expect(await db!.select().from(schema.pathSteps).where(eq(schema.pathSteps.id, r.id))).toEqual([]);
  });
});
