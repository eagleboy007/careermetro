import { eq, inArray, like } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { roleProfiles, skills } from "@/content";
import * as schema from "@/db/schema";
import type { Profile } from "@/lib/schemas";
import { getPathForOwner, markStepDone, PATH_LIMITS } from "./store";
import type { WriteClient } from "./write";

// Runs against a real Postgres with migrations applied, like the gaps store tests.
const url = process.env.TEST_DATABASE_URL;
const sqlClient = url ? postgres(url, { max: 2, onnotice: () => {} }) : null;
const db = sqlClient ? drizzle(sqlClient, { schema }) : null;

const role = roleProfiles.find((r) => r.slug === "data-analyst")!;
const profile: Profile = {
  headline: "MIS Executive",
  totalYearsExperience: 2,
  roles: [{ title: "MIS Executive", employer: "Example Bank", start: "2023-01", end: null, highlights: ["Wrote SQL queries for branch reports"] }],
  skills: [],
  education: [],
  certifications: [],
};
const TEST_URL = "https://example.com/careermetro-path-test/";

function writeClient() {
  const create = vi.fn().mockImplementation(async (body: { messages: { content: string }[] }) => {
    const data = JSON.parse(body.messages[0].content.replace(/^<path>|<\/path>$/g, ""));
    const steps = data.steps.map((s: { skillId: string }) => ({
      skillId: s.skillId,
      reason: `Worded ${s.skillId}.`,
      proofTask: `Make one small ${s.skillId} piece and share a screenshot.`,
    }));
    return { model: "claude-opus-5-5", stop_reason: "end_turn", usage: { input_tokens: 900, output_tokens: 300 }, content: [{ type: "text", text: JSON.stringify({ steps }) }] };
  });
  return { client: { beta: { messages: { create } } } as unknown as WriteClient, create };
}

describe.skipIf(!db)("paths (database)", () => {
  const created: string[] = [];
  let n = 0;

  async function seed() {
    const session = `path-${Date.now()}-${n++}`;
    const [resume] = await db!.insert(schema.resumes).values({ anonymousSessionId: session, mimeType: "text/plain", sizeBytes: 10, status: "parsed" }).returning();
    created.push(resume.id);
    await db!.insert(schema.profiles).values({ resumeId: resume.id, version: 1, data: profile, confirmedByUser: true });
    return { session, resumeId: resume.id };
  }

  beforeAll(async () => {
    // CI's database has migrations but no content, and path steps reference skills.
    await db!.insert(schema.skills).values(skills.map(({ id, name, category }) => ({ id, name, category }))).onConflictDoNothing();
    const skillIds = role.skills.map((s) => s.skillId);
    await db!
      .insert(schema.resources)
      .values(skillIds.map((id, i) => ({ title: `Test course ${id}`, url: `${TEST_URL}${id}`, provider: "Test", kind: i % 2 ? "video" : "course", skillIds: [id], minutes: 120 })))
      .onConflictDoNothing();
  });
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.stubEnv("EXPLAIN_DAILY_BUDGET_USD", "0");
    vi.stubEnv("WRITE_PATH_DAILY_BUDGET_USD", "1000000");
  });
  afterAll(async () => {
    if (created.length) await db!.delete(schema.resumes).where(inArray(schema.resumes.id, created));
    await db!.delete(schema.resources).where(like(schema.resources.url, `${TEST_URL}%`));
    await sqlClient!.end();
  });

  it("builds, words, stores and then reuses a path, logging the call", async () => {
    const { session, resumeId } = await seed();
    const { client, create } = writeClient();
    const first = await getPathForOwner(resumeId, { sessionId: session }, role, 5, { db: db!, client });
    if (!first.ok) throw new Error(first.reason);
    expect(first.path.weeklyHours).toBe(5);
    expect(first.path.steps.length).toBeGreaterThan(0);
    expect(first.path.steps[0]).toMatchObject({ position: 1, week: 1, doneAt: null });
    expect(first.path.steps[0].reason).toMatch(/^Worded /);
    expect(first.path.steps[0].resources[0].url).toContain(TEST_URL);

    const [row] = await db!.select().from(schema.paths).where(eq(schema.paths.id, first.path.pathId));
    const [call] = await db!.select().from(schema.aiCalls).where(eq(schema.aiCalls.id, row.aiCallId!));
    expect(call).toMatchObject({ purpose: "write-path", promptVersion: "write-path/v1", ok: true });
    expect(JSON.stringify(call)).not.toContain("branch reports");

    const again = await getPathForOwner(resumeId, { sessionId: session }, role, 5, { db: db!, client });
    expect(again.ok && again.path.pathId).toBe(first.path.pathId);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("makes a separate path for other weekly hours", async () => {
    const { session, resumeId } = await seed();
    const five = await getPathForOwner(resumeId, { sessionId: session }, role, 5, { db: db! });
    const ten = await getPathForOwner(resumeId, { sessionId: session }, role, 10, { db: db! });
    expect(five.ok && ten.ok && five.path.pathId !== ten.path.pathId).toBe(true);
  });

  it("uses template wording without calling the model once the budget is spent", async () => {
    vi.stubEnv("WRITE_PATH_DAILY_BUDGET_USD", "0");
    const { session, resumeId } = await seed();
    const { client, create } = writeClient();
    const r = await getPathForOwner(resumeId, { sessionId: session }, role, 5, { db: db!, client });
    expect(create).not.toHaveBeenCalled();
    expect(r.ok && r.path.steps[0].reason).not.toMatch(/^Worded /);
  });

  it("stops wording paths past the per-session daily count", async () => {
    const { session, resumeId } = await seed();
    const { client, create } = writeClient();
    const original = PATH_LIMITS.wordedPerOwnerPerDay;
    PATH_LIMITS.wordedPerOwnerPerDay = 1;
    try {
      await getPathForOwner(resumeId, { sessionId: session }, role, 5, { db: db!, client });
      await getPathForOwner(resumeId, { sessionId: session }, role, 8, { db: db!, client });
    } finally {
      PATH_LIMITS.wordedPerOwnerPerDay = original;
    }
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("hides other sessions' paths and lets only the owner mark a step done", async () => {
    const { session, resumeId } = await seed();
    expect(await getPathForOwner(resumeId, { sessionId: "someone-else" }, role, 5, { db: db! })).toEqual({ ok: false, reason: "not_found" });
    const r = await getPathForOwner(resumeId, { sessionId: session }, role, 5, { db: db! });
    if (!r.ok) throw new Error(r.reason);
    const step = r.path.steps[0];
    expect(await markStepDone(step.id, { sessionId: "someone-else" }, true, db!)).toBe(false);
    expect(await markStepDone("not-a-uuid", { sessionId: session }, true, db!)).toBe(false);
    expect(await markStepDone("-".repeat(36), { sessionId: session }, true, db!)).toBe(false);
    expect(await markStepDone(step.id, { sessionId: session }, true, db!)).toBe(true);

    const after = await getPathForOwner(resumeId, { sessionId: session }, role, 5, { db: db! });
    expect(after.ok && after.path.doneCount).toBe(1);
    expect(after.ok && after.path.steps[0].doneAt).not.toBeNull();
    expect(await markStepDone(step.id, { sessionId: session }, false, db!)).toBe(true);
    const undone = await getPathForOwner(resumeId, { sessionId: session }, role, 5, { db: db! });
    expect(undone.ok && undone.path.doneCount).toBe(0);
  });

  it("keeps progress when the weekly hours change", async () => {
    const { session, resumeId } = await seed();
    const five = await getPathForOwner(resumeId, { sessionId: session }, role, 5, { db: db! });
    if (!five.ok) throw new Error(five.reason);
    const first = five.path.steps[0];
    expect(await markStepDone(first.id, { sessionId: session }, true, db!)).toBe(true);

    // A path made after the step was done starts with it done.
    const ten = await getPathForOwner(resumeId, { sessionId: session }, role, 10, { db: db! });
    if (!ten.ok) throw new Error(ten.reason);
    expect(ten.path.steps.find((s) => s.skillId === first.skillId)?.doneAt).not.toBeNull();

    // Undoing it at 10 hours undoes it at 5 hours too.
    const tenStep = ten.path.steps.find((s) => s.skillId === first.skillId)!;
    expect(await markStepDone(tenStep.id, { sessionId: session }, false, db!)).toBe(true);
    const fiveAgain = await getPathForOwner(resumeId, { sessionId: session }, role, 5, { db: db! });
    expect(fiveAgain.ok && fiveAgain.path.doneCount).toBe(0);
  });
});
