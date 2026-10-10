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
import { mapLine, type Profile } from "@/lib/schemas";
import { mapLineFor, otherLines } from "./store";

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

describe.skipIf(!db)("mapLineFor (database)", () => {
  const run = `map-${Date.now()}`;
  const userIds: string[] = [];
  const role = roleProfiles[0];
  const limits = { explain: GAP_LIMITS.explainedPerOwnerPerDay, word: PATH_LIMITS.wordedPerOwnerPerDay };
  beforeAll(async () => {
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

  it("has no line before there are gaps", async () => {
    expect(await mapLineFor(await user("new"), db!)).toBeNull();
  });

  it("draws one goal per gap in path order, marks learning done from the path, and never marks a goal proved", async () => {
    const userId = await user("line");
    const owner = { userId };
    const r = await ingestResume({ bytes, as: "text", owner, clientHash: `h-${run}-line` }, { db: db!, client });
    if (!r.ok) throw new Error(r.code);
    await confirmProfile(r.resumeId, owner, parsed, db!);
    const gaps = await getGapsForOwner(r.resumeId, owner, role, { db: db! });
    if (!gaps.ok) throw new Error(gaps.reason);

    const before = await mapLineFor(userId, db!);
    expect(before).toMatchObject({ role: { slug: role.slug }, resumeId: r.resumeId, pathOpened: false });
    expect(before!.goals.map((g) => g.skillId).sort()).toEqual(gaps.analysis.gaps.map((g) => g.skillId).sort());

    const path = await getPathForOwner(r.resumeId, owner, role, 5, { db: db! });
    if (!path.ok) throw new Error(path.reason);
    const first = path.path.steps[0];
    await db!.update(schema.pathSteps).set({ doneAt: new Date() }).where(eq(schema.pathSteps.pathId, path.path.pathId));
    const after = await mapLineFor(userId, db!);
    expect(after!.pathOpened).toBe(true);
    expect(after!.goals.slice(0, path.path.steps.length).map((g) => g.skillId)).toEqual(path.path.steps.map((s) => s.skillId));
    expect(after!.goals[0]).toMatchObject({ skillId: first.skillId, learnDone: true, proved: false });
    expect(after!.goals.every((g) => !g.proved)).toBe(true);
    expect(mapLine.safeParse(after).success).toBe(true);
  });

  it("never reads another person's line", async () => {
    expect(await mapLineFor(await user("other"), db!)).toBeNull();
  });
});

describe("otherLines", () => {
  it("picks other roles that need a gap skill, each crossing at a different goal", () => {
    const own = roleProfiles[0];
    const goals = own.skills
      .filter((s) => s.importance === "required")
      .slice(0, 8)
      .map((s) => ({ skillId: s.skillId, name: s.skillId, status: "missing" as const, learnDone: false, proved: false, resources: [], practice: null }));
    const lines = otherLines(own.slug, goals);
    expect(lines.length).toBeLessThanOrEqual(2);
    expect(lines.every((l) => l.slug !== own.slug)).toBe(true);
    expect(new Set(lines.map((l) => l.skillId)).size).toBe(lines.length);
    for (const l of lines) {
      const other = roleProfiles.find((r) => r.slug === l.slug)!;
      expect(other.skills.some((s) => s.skillId === l.skillId && s.importance === "required")).toBe(true);
    }
  });
});
