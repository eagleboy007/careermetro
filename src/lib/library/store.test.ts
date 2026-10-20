import { readFileSync } from "node:fs";
import { eq, inArray, like } from "drizzle-orm";
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
import { tickTask } from "@/lib/ride/store";
import { libraryView, type Profile } from "@/lib/schemas";
import { libraryFor } from "./store";

vi.mock("server-only", () => ({}));

// The Library (FR-51) against a real Postgres with migrations applied. Every person, resume and link here is made up.
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

describe.skipIf(!db)("libraryFor (database)", () => {
  const run = `library-${Date.now()}`;
  const linkPrefix = `https://library-test.example.test/${run}/`;
  const userIds: string[] = [];
  const role = roleProfiles[0];
  const limits = { explain: GAP_LIMITS.explainedPerOwnerPerDay, word: PATH_LIMITS.wordedPerOwnerPerDay };
  // Mid-afternoon in India, so the India day is the same date as the UTC one.
  const clock = new Date("2026-10-20T09:00:00Z");

  beforeAll(async () => {
    await db!.insert(schema.skills).values(skills.map(({ id, name, category }) => ({ id, name, category }))).onConflictDoNothing();
    // A free link for every skill of the role, so the path has courses even on an unseeded database.
    await db!
      .insert(schema.resources)
      .values(
        role.skills.map(({ skillId }, i) => ({
          title: `Test course ${i}`,
          url: `${linkPrefix}${skillId}`,
          provider: "Example Learn",
          kind: "course",
          skillIds: [skillId],
          minutes: 30,
        })),
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
    await db!.delete(schema.resources).where(like(schema.resources.url, `${linkPrefix}%`));
    await sqlClient!.end();
  });

  async function user(n: string) {
    const [row] = await db!.insert(schema.users).values({ email: `${run}-${n}@example.test`, name: "Test User" }).returning({ id: schema.users.id });
    userIds.push(row.id);
    return row.id;
  }

  it("is the healthy catalog alone before there are gaps, for search", async () => {
    const view = await libraryFor(await user("new"), clock, db!);
    expect(libraryView.safeParse(view).success).toBe(true);
    expect(view).toMatchObject({ role: null, pathHref: null, goals: [], onRide: [], finished: [] });
    expect(view.items.some((i) => i.url.startsWith(linkPrefix))).toBe(true);
    // A broken link leaves the Library.
    const [broken] = await db!.select({ id: schema.resources.id }).from(schema.resources).where(eq(schema.resources.url, `${linkPrefix}${role.skills[0].skillId}`));
    await db!.update(schema.resources).set({ healthy: false }).where(eq(schema.resources.id, broken.id));
    expect((await libraryFor(await user("new2"), clock, db!)).items.some((i) => i.id === broken.id)).toBe(false);
    await db!.update(schema.resources).set({ healthy: true }).where(eq(schema.resources.id, broken.id));
  });

  it("shows the person's open goals in line order, today's ride courses, and only their own ticks as finished", async () => {
    const userId = await user("line");
    const owner = { userId };
    const r = await ingestResume({ bytes, as: "text", owner, clientHash: `h-${run}-line` }, { db: db!, client });
    if (!r.ok) throw new Error(r.code);
    await confirmProfile(r.resumeId, owner, parsed, db!);
    const gaps = await getGapsForOwner(r.resumeId, owner, role, { db: db! });
    if (!gaps.ok) throw new Error(gaps.reason);

    const before = await libraryFor(userId, clock, db!);
    expect(libraryView.safeParse(before).success).toBe(true);
    expect(before.role).toBe(role.title);
    expect(before.goals.map((g) => g.skillId).sort()).toEqual(gaps.analysis.gaps.map((g) => g.skillId).sort());

    const path = await getPathForOwner(r.resumeId, owner, role, 5, { db: db! });
    if (!path.ok) throw new Error(path.reason);
    const view = await libraryFor(userId, clock, db!);
    expect(view.pathHref).toBe(`/resume/${r.resumeId}/path/${role.slug}`);
    expect(view.goals.slice(0, path.path.steps.length).map((g) => g.skillId)).toEqual(path.path.steps.map((s) => s.skillId));
    expect(view.goals.filter((g) => g.now)).toHaveLength(1);
    expect(view.onRide.length).toBeGreaterThan(0);
    expect(view.finished).toEqual([]);

    // Ticking a ride task on Today shows the course as finished; the goal stays open (only proof fills it).
    const now = view.goals.find((g) => g.now)!;
    const course = view.onRide[0];
    expect(await tickTask(userId, `${now.goalId}:r:${course}`, true, clock, db!)).toBe(true);
    const after = await libraryFor(userId, clock, db!);
    expect(after.finished).toContain(course);
    expect(after.goals.map((g) => g.skillId)).toEqual(view.goals.map((g) => g.skillId));

    // Someone else's ticks never show.
    const other = await libraryFor(await user("other"), clock, db!);
    expect(other.finished).toEqual([]);
  });
});
