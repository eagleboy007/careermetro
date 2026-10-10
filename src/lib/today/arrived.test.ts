import { readFileSync } from "node:fs";
import { inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as schema from "@/db/schema";
import { roleProfiles, skills } from "@/content";
import { GAP_LIMITS } from "@/lib/gaps/store";
import { getPathForOwner, PATH_LIMITS } from "@/lib/path/store";
import { ingestResume } from "@/lib/resume/ingest";
import type { ParseClient } from "@/lib/resume/parse";
import { confirmProfile } from "@/lib/resume/store";
import type { Profile } from "@/lib/schemas";
import { goalsOf } from "@/lib/goals/store";
import { tickTask } from "@/lib/ride/store";
import { todayStateFor } from "./state";

vi.mock("server-only", () => ({}));

// Runs against a real Postgres with migrations applied, like the other store tests.
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
        model: "claude-opus-5-5",
        stop_reason: "end_turn",
        usage: { input_tokens: 3000, output_tokens: 1000 },
        content: [{ type: "text", text: JSON.stringify(parsed) }],
      }),
    },
  },
} as unknown as ParseClient;

describe.skipIf(!db)("Today once every goal is proved (database)", () => {
  const now = new Date("2026-10-10T12:00:00Z");
  const run = `arrived-${Date.now()}`;
  const userIds: string[] = [];
  const role = roleProfiles[0];
  const limits = { explain: GAP_LIMITS.explainedPerOwnerPerDay, word: PATH_LIMITS.wordedPerOwnerPerDay };
  beforeAll(async () => {
    // CI's database has migrations but no content, and path steps reference skills.
    await db!
      .insert(schema.skills)
      .values(skills.map(({ id, name, category }) => ({ id, name, category })))
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
    await sqlClient!.end();
  });

  async function user(n: string) {
    const [row] = await db!
      .insert(schema.users)
      .values({ email: `${run}-${n}@example.test` })
      .returning({ id: schema.users.id });
    userIds.push(row.id);
    return row.id;
  }

  async function lineFor(n: string) {
    const userId = await user(n);
    const owner = { userId };
    const r = await ingestResume({ bytes, as: "text", owner, clientHash: `h-${run}-${n}` }, { db: db!, client });
    if (!r.ok) throw new Error(r.code);
    await confirmProfile(r.resumeId, owner, parsed, db!);
    const path = await getPathForOwner(r.resumeId, owner, role, 5, { db: db! });
    if (!path.ok) throw new Error(path.reason);
    return userId;
  }
  async function proveAll(userId: string, except = 0) {
    await todayStateFor(userId, now, db!);
    const goals = await goalsOf(userId, db!);
    if (!goals.length) throw new Error("no goals");
    const toProve = goals.slice(0, goals.length - except);
    for (const g of toProve)
      await db!
        .insert(schema.gapProofs)
        .values({ userId, skillId: g.skillId, type: "skill_check", status: "accepted", evidence: { type: "skill_check", checkId: "c" } });
    return goals;
  }

  it("a rider who proves every goal arrives, and the board task never ticks", async () => {
    const userId = await lineFor("rider");
    const s = await todayStateFor(userId, now, db!);
    if (s.state !== "first") throw new Error(s.state);
    const t = s.firstTasks.find((t) => !t.locked)!;
    expect(await tickTask(userId, t.id, true, now, db!)).toBe(true);
    await proveAll(userId);
    const after = await todayStateFor(userId, now, db!);
    expect(after.state).toBe("returning");
    if (after.state !== "returning") return;
    expect(after.ride.pitstop).toBe(after.ride.pitstopCount + 1);
    expect(await tickTask(userId, "all-proved", true, now, db!)).toBe(false);
    // Today's earlier tick is no longer on the ride, so it cannot be taken back.
    expect(await tickTask(userId, t.id, false, now, db!)).toBe(false);
    const tomorrow = new Date(now.getTime() + 86_400_000);
    expect(await tickTask(userId, "all-proved", true, tomorrow, db!)).toBe(false);
  });

  it("one goal left unproved is not arrived", async () => {
    const userId = await lineFor("partial");
    await proveAll(userId, 1);
    const s = await todayStateFor(userId, now, db!);
    if (s.state !== "first") throw new Error(s.state);
    expect(s.firstTasks.some((t) => t.id === "all-proved")).toBe(false);
  });

  it("someone who never ticked a task but proved every goal is returning", async () => {
    const userId = await lineFor("neverrode");
    await proveAll(userId);
    const s = await todayStateFor(userId, now, db!);
    expect(s.state).toBe("returning");
    if (s.state !== "returning") return;
    expect(await tickTask(userId, "all-proved", true, now, db!)).toBe(false);
  });
});
