import { readFileSync } from "node:fs";
import { eq, inArray } from "drizzle-orm";
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
import { tickTask } from "@/lib/ride/store";
import { clip, todayStateFor } from "./state";

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
  const now = new Date("2026-10-10T12:00:00Z");
  const run = `today-${Date.now()}`;
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

  it("says No resume for a new account", async () => {
    expect(await todayStateFor(await user("new"), now, db!)).toEqual({ state: "no_resume", unfinishedResumeId: null });
  });

  it("points back to a resume that was read but whose gaps were never shown", async () => {
    const userId = await user("half");
    const r = await ingestResume({ bytes, as: "text", owner: { userId }, clientHash: `h-${run}-half` }, { db: db!, client });
    if (!r.ok) throw new Error(r.code);
    expect(await todayStateFor(userId, now, db!)).toEqual({ state: "no_resume", unfinishedResumeId: r.resumeId });
  });

  it("says First sign-up with the person's own tally once gaps exist, and starts the ride from their path", async () => {
    const userId = await user("first");
    const owner = { userId };
    const r = await ingestResume({ bytes, as: "text", owner, clientHash: `h-${run}-first` }, { db: db!, client });
    if (!r.ok) throw new Error(r.code);
    await confirmProfile(r.resumeId, owner, parsed, db!);
    const gaps = await getGapsForOwner(r.resumeId, owner, role, { db: db! });
    if (!gaps.ok) throw new Error(gaps.reason);

    const before = await todayStateFor(userId, now, db!);
    expect(before).toMatchObject({
      state: "first",
      resumeId: r.resumeId,
      role: { slug: role.slug, title: role.title },
      tally: { skillsFound: gaps.analysis.metSkillIds.length, gaps: gaps.analysis.gaps.length, goals: gaps.analysis.gaps.length },
    });
    if (before.state !== "first") throw new Error("not first");
    expect(before.firstTasks).toHaveLength(1);
    expect(before.firstTasks[0].id).toMatch(/:open-path$/);
    expect(before.firstTasks[0].title).toMatch(/^Open your path for /);

    const path = await getPathForOwner(r.resumeId, owner, role, 5, { db: db! });
    if (!path.ok) throw new Error(path.reason);
    const after = await todayStateFor(userId, now, db!);
    if (after.state !== "first") throw new Error("not first");
    const practice = after.firstTasks.at(-1)!;
    expect(practice.title).toBe(clip(path.path.steps[0].proofTask, 120));
    expect(practice.id).toMatch(/:practice$/);

    // Ticking a first task makes it a ride day: Today switches to Returning with that task done.
    expect(await tickTask(userId, practice.id, true, now, db!)).toBe(true);
    expect(await tickTask(userId, practice.id, true, now, db!)).toBe(true);
    const back = await todayStateFor(userId, now, db!);
    if (back.state !== "returning") throw new Error("not returning");
    expect(back.streak).toEqual({ days: 1, todayCounted: true });
    // The ticked task shows done, or, when it was the goal's only task, the ride has moved on to the next goal.
    const ticked = back.ride.tasks.find((t) => t.id === practice.id);
    expect(ticked ? ticked.done : back.ride.pitstop > 1).toBe(true);
    expect(back.week.find((d) => d.today)?.rode).toBe(true);
    expect(await db!.select().from(schema.rideDays).where(eq(schema.rideDays.userId, userId))).toHaveLength(1);

    // The next day still counts it: the streak pauses but never resets, and the task stays done.
    const tomorrow = new Date(now.getTime() + 86_400_000);
    const next = await todayStateFor(userId, tomorrow, db!);
    if (next.state !== "returning") throw new Error("not returning");
    expect(next.streak).toEqual({ days: 1, todayCounted: false });
    // Yesterday's task is done for good: it leaves today's list, can't be ticked again for a new ride day, and
    // unticking it today changes nothing.
    expect(next.ride.tasks.some((t) => t.id === practice.id)).toBe(false);
    expect(await tickTask(userId, practice.id, true, tomorrow, db!)).toBe(false);
    expect(await tickTask(userId, practice.id, false, tomorrow, db!)).toBe(false);
    expect(await db!.select().from(schema.rideDays).where(eq(schema.rideDays.userId, userId))).toHaveLength(1);

    // Only tasks on the person's own line count.
    expect(await tickTask(userId, "made-up:task", true, now, db!)).toBe(false);
    const other = await user("ride-other");
    expect(await tickTask(other, practice.id, true, now, db!)).toBe(false);
    expect(await db!.select().from(schema.rideDays).where(eq(schema.rideDays.userId, other))).toEqual([]);

    // Taking the only tick back leaves no ride that day.
    await tickTask(userId, practice.id, false, now, db!);
    expect(await todayStateFor(userId, now, db!)).toMatchObject({ state: "first" });
  });

  it("keeps the analysed line when a newer upload is still being read or was left half-done", async () => {
    const userId = await user("second");
    const owner = { userId };
    const r = await ingestResume({ bytes, as: "text", owner, clientHash: `h-${run}-second-a` }, { db: db!, client });
    if (!r.ok) throw new Error(r.code);
    await confirmProfile(r.resumeId, owner, parsed, db!);
    const gaps = await getGapsForOwner(r.resumeId, owner, role, { db: db! });
    if (!gaps.ok) throw new Error(gaps.reason);
    await db!.insert(schema.resumes).values({ userId, status: "parsing", mimeType: "text/plain", sizeBytes: 10 });
    const r2 = await ingestResume({ bytes, as: "text", owner, clientHash: `h-${run}-second-c` }, { db: db!, client });
    if (!r2.ok) throw new Error(r2.code);
    expect(await todayStateFor(userId, now, db!)).toMatchObject({ state: "first", resumeId: r.resumeId });
  });

  it("sends the person back to their gaps after they correct the profile", async () => {
    const userId = await user("corrected");
    const owner = { userId };
    const r = await ingestResume({ bytes, as: "text", owner, clientHash: `h-${run}-corrected` }, { db: db!, client });
    if (!r.ok) throw new Error(r.code);
    await confirmProfile(r.resumeId, owner, parsed, db!);
    const gaps = await getGapsForOwner(r.resumeId, owner, role, { db: db! });
    if (!gaps.ok) throw new Error(gaps.reason);
    await confirmProfile(r.resumeId, owner, { ...parsed, headline: "Senior Data Analyst" }, db!);
    expect(await todayStateFor(userId, now, db!)).toEqual({ state: "no_resume", unfinishedResumeId: r.resumeId });
  });

  it("shows the first tasks done once every path step is marked done", async () => {
    const userId = await user("done");
    const owner = { userId };
    const r = await ingestResume({ bytes, as: "text", owner, clientHash: `h-${run}-done` }, { db: db!, client });
    if (!r.ok) throw new Error(r.code);
    await confirmProfile(r.resumeId, owner, parsed, db!);
    const path = await getPathForOwner(r.resumeId, owner, role, 5, { db: db! });
    if (!path.ok) throw new Error(path.reason);
    await db!.update(schema.pathSteps).set({ doneAt: new Date() }).where(eq(schema.pathSteps.pathId, path.path.pathId));
    const state = await todayStateFor(userId, now, db!);
    if (state.state !== "first") throw new Error("not first");
    // Goals the path covered are done; the ride waits on them, or moves to a goal the path left for later.
    expect(state.firstTasks.every((t) => t.done || t.id.endsWith(":open-path"))).toBe(true);
  });

  it("never reads another person's resume", async () => {
    const other = await user("other");
    expect(await todayStateFor(other, now, db!)).toEqual({ state: "no_resume", unfinishedResumeId: null });
  });
});

describe("clip", () => {
  it("keeps short text and cuts long text at a word break", () => {
    expect(clip("  Short  text ", 20)).toBe("Short text");
    expect(clip("Build a dashboard of failed logins, then write it up", 30)).toBe("Build a dashboard of failed…");
    expect(clip("x".repeat(50), 10)).toBe(`${"x".repeat(9)}…`);
  });
});
