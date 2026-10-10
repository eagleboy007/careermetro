import { readFileSync } from "node:fs";
import { inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as schema from "@/db/schema";
import { roleProfiles, skills } from "@/content";
import { GAP_LIMITS, getGapsForOwner } from "@/lib/gaps/store";
import { getPathForOwner, PATH_LIMITS } from "@/lib/path/store";
import { ingestResume } from "@/lib/resume/ingest";
import type { ParseClient } from "@/lib/resume/parse";
import { confirmProfile } from "@/lib/resume/store";
import type { Profile } from "@/lib/schemas";
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

describe.skipIf(!db)("todayStateFor (database)", () => {
  const run = `today-${Date.now()}`;
  const userIds: string[] = [];
  const role = roleProfiles[0];
  const limits = { explain: GAP_LIMITS.explainedPerOwnerPerDay, word: PATH_LIMITS.wordedPerOwnerPerDay };
  beforeAll(async () => {
    // CI's database has migrations but no content, and path steps reference skills.
    await db!.insert(schema.skills).values(skills.map(({ id, name, category }) => ({ id, name, category }))).onConflictDoNothing();
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
    const [row] = await db!.insert(schema.users).values({ email: `${run}-${n}@example.test` }).returning({ id: schema.users.id });
    userIds.push(row.id);
    return row.id;
  }

  it("says No resume for a new account", async () => {
    expect(await todayStateFor(await user("new"), db!)).toEqual({ state: "no_resume", unfinishedResumeId: null });
  });

  it("points back to a resume that was read but whose gaps were never shown", async () => {
    const userId = await user("half");
    const r = await ingestResume({ bytes, as: "text", owner: { userId }, clientHash: `h-${run}-half` }, { db: db!, client });
    if (!r.ok) throw new Error(r.code);
    expect(await todayStateFor(userId, db!)).toEqual({ state: "no_resume", unfinishedResumeId: r.resumeId });
  });

  it("says First sign-up with the person's own tally once gaps exist, and starts the ride from their path", async () => {
    const userId = await user("first");
    const owner = { userId };
    const r = await ingestResume({ bytes, as: "text", owner, clientHash: `h-${run}-first` }, { db: db!, client });
    if (!r.ok) throw new Error(r.code);
    await confirmProfile(r.resumeId, owner, parsed, db!);
    const gaps = await getGapsForOwner(r.resumeId, owner, role, { db: db! });
    if (!gaps.ok) throw new Error(gaps.reason);

    const before = await todayStateFor(userId, db!);
    expect(before).toMatchObject({
      state: "first",
      resumeId: r.resumeId,
      role: { slug: role.slug, title: role.title },
      tally: { skillsFound: gaps.analysis.metSkillIds.length, gaps: gaps.analysis.gaps.length, goals: gaps.analysis.gaps.length },
    });
    if (before.state !== "first") throw new Error("not first");
    expect(before.firstTasks).toHaveLength(1);
    expect(before.firstTasks[0].title).toMatch(/^Open your path for /);

    const path = await getPathForOwner(r.resumeId, owner, role, 5, { db: db! });
    if (!path.ok) throw new Error(path.reason);
    const after = await todayStateFor(userId, db!);
    if (after.state !== "first") throw new Error("not first");
    const proof = after.firstTasks.at(-1)!;
    expect(proof.title).toBe(path.path.steps[0].proofTask.slice(0, 120));
    expect(proof.detail).toMatch(/^Proof task, part 1 · /);
  });

  it("never reads another person's resume", async () => {
    const other = await user("other");
    expect(await todayStateFor(other, db!)).toEqual({ state: "no_resume", unfinishedResumeId: null });
  });
});
