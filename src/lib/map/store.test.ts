import { readFileSync } from "node:fs";
import { and, eq, inArray } from "drizzle-orm";
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
import { lifeLine, mapLine, type Profile } from "@/lib/schemas";
import { makeDestination } from "@/lib/gaps/choose";
import { currentAnalysis, goalOnCurrentLine } from "@/lib/gaps/current";
import { addProof, setProofStatus } from "@/lib/goals/store";
import { lifeLineFor, mapLineFor, otherLines } from "./store";

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
    const [row] = await db!.insert(schema.users).values({ email: `${run}-${n}@example.test`, name: "Test User" }).returning({ id: schema.users.id });
    userIds.push(row.id);
    return row.id;
  }

  it("has no line before there are gaps", async () => {
    expect(await mapLineFor(await user("new"), db!)).toBeNull();
  });

  it("draws one goal per gap in path order, marks learning done from the path, and marks a goal proved only with accepted proof", async () => {
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
    // Mark only the first step done: only that goal's learning counts.
    await db!
      .update(schema.pathSteps)
      .set({ doneAt: new Date() })
      .where(and(eq(schema.pathSteps.pathId, path.path.pathId), eq(schema.pathSteps.position, first.position)));
    const after = await mapLineFor(userId, db!);
    expect(after!.pathOpened).toBe(true);
    expect(after!.goals.slice(0, path.path.steps.length).map((g) => g.skillId)).toEqual(path.path.steps.map((s) => s.skillId));
    expect(after!.goals[0]).toMatchObject({ skillId: first.skillId, learnDone: true, proved: false });
    if (after!.goals.length > 1) expect(after!.goals[1].learnDone).toBe(false);
    expect(after!.goals.every((g) => !g.proved)).toBe(true);
    // Each goal carries the person's goal id and the certificates that can fill it.
    expect(after!.goals.every((g) => g.goalId && !g.renew)).toBe(true);
    expect(after!.goals.every((g) => g.certificates.every((c) => c.id && c.issuer))).toBe(true);
    expect(mapLine.safeParse(after).success).toBe(true);
    // Nearby lines come from the same profile, and only an interchange that is a Nearby line is marked as one.
    expect(after!.nearby).toBeDefined();
    for (const o of after!.otherLines.filter((x) => x.nearby)) expect(after!.nearby!.lines.some((n) => n.slug === o.slug)).toBe(true);
    // Reading them changes no goal.
    const goalsBefore = await db!.select().from(schema.userGoals).where(eq(schema.userGoals.userId, userId));
    await mapLineFor(userId, db!);
    expect(await db!.select().from(schema.userGoals).where(eq(schema.userGoals.userId, userId))).toEqual(goalsBefore);

    const life = await lifeLineFor(userId, new Date(), db!);
    expect(lifeLine.safeParse(life).success).toBe(true);
    expect(life).toMatchObject({ destination: role.title });
    expect(life!.moments.some((m) => m.id === "joined")).toBe(true);
    // Interests added on Me join as one undated row at the end, oldest first.
    expect(life!.undated.some((u) => u.row === "interests")).toBe(false);
    await db!.insert(schema.userInterests).values([
      { userId, name: "Cricket stats", nameKey: "cricket stats", createdAt: new Date("2026-10-01T00:00:00Z") },
      { userId, name: "Marathi theatre", nameKey: "marathi theatre", createdAt: new Date("2026-10-02T00:00:00Z") },
    ]);
    expect((await lifeLineFor(userId, new Date(), db!))!.undated.at(-1)).toEqual({ row: "interests", name: "Cricket stats · Marathi theatre" });
    expect(await lifeLineFor(await user("nolife"), new Date(), db!)).toBeNull();
    // A page that already read the analysis hands it on (docs/plans/perf-pass.md): the same lines, and none for null.
    const read = await currentAnalysis(userId, db!);
    const at = new Date("2026-10-10T12:00:00Z");
    expect(read).not.toBeNull();
    expect(await mapLineFor(userId, db!, at, read)).toEqual(await mapLineFor(userId, db!, at));
    expect(await lifeLineFor(userId, at, db!, read)).toEqual(await lifeLineFor(userId, at, db!));
    expect(await mapLineFor(userId, db!, at, null)).toBeNull();
    expect(await lifeLineFor(userId, at, db!, null)).toBeNull();

    // Accepted proof, and only accepted proof, marks the goal proved.
    const proof = await addProof(userId, first.skillId, { type: "skill_check", checkId: "c1" }, db!);
    expect((await mapLineFor(userId, db!))!.goals[0].proved).toBe(false);
    await setProofStatus(proof!, userId, "accepted", "app", db!);
    const proved = await mapLineFor(userId, db!);
    expect(proved!.goals[0]).toMatchObject({ skillId: first.skillId, proved: true });
    expect(proved!.goals.slice(1).every((g) => !g.proved)).toBe(true);
  });

  it("gives each person their own line, even when someone else's analysis is newer", async () => {
    const mine = await user("mine");
    const theirs = await user("theirs");
    const ids: Record<string, string> = {};
    for (const [userId, n] of [[mine, "mine"], [theirs, "theirs"]] as const) {
      const owner = { userId };
      const r = await ingestResume({ bytes, as: "text", owner, clientHash: `h-${run}-${n}` }, { db: db!, client });
      if (!r.ok) throw new Error(r.code);
      await confirmProfile(r.resumeId, owner, parsed, db!);
      const gaps = await getGapsForOwner(r.resumeId, owner, role, { db: db! });
      if (!gaps.ok) throw new Error(gaps.reason);
      ids[userId] = r.resumeId;
    }
    expect((await mapLineFor(mine, db!))?.resumeId).toBe(ids[mine]);
    expect((await mapLineFor(theirs, db!))?.resumeId).toBe(ids[theirs]);
    expect(await mapLineFor(await user("other"), db!)).toBeNull();
  });

  // Change of destination (handoff section 14, open decision 5; docs/plans/change-destination-plan.md).
  it("after a change of destination draws the new line, carries proof over and greys out the earlier line; switching back swaps them", async () => {
    const userId = await user("switch");
    const owner = { userId };
    const r = await ingestResume({ bytes, as: "text", owner, clientHash: `h-${run}-switch` }, { db: db!, client });
    if (!r.ok) throw new Error(r.code);
    await confirmProfile(r.resumeId, owner, parsed, db!);
    // Two roles with gaps in common and gaps of their own.
    const pair = roleProfiles
      .flatMap((a) => roleProfiles.map((b) => [a, b] as const))
      .find(([a, b]) => {
        const req = (x: typeof a) => new Set(x.skills.filter((s) => s.importance === "required").map((s) => s.skillId));
        const [ra, rb] = [req(a), req(b)];
        return a.slug !== b.slug && [...ra].some((id) => rb.has(id)) && [...ra].some((id) => !rb.has(id)) && [...rb].some((id) => !ra.has(id));
      })!;
    const [first, second] = pair;
    const a = await getGapsForOwner(r.resumeId, owner, first, { db: db! });
    if (!a.ok) throw new Error(a.reason);
    const onFirst = await mapLineFor(userId, db!);
    expect(onFirst!.previous).toBeNull();
    // Proof for a gap of the first role that the second one also has.
    const secondGapIds = new Set(second.skills.map((s) => s.skillId));
    const shared = a.analysis.gaps.find((g) => secondGapIds.has(g.skillId) && !g.groupId);
    if (shared) {
      const proof = await addProof(userId, shared.skillId, { type: "skill_check", checkId: "switch" }, db!);
      await setProofStatus(proof!, userId, "accepted", "app", db!);
    }
    const ownLeft = a.analysis.gaps.map((g) => g.skillId);

    const b = await getGapsForOwner(r.resumeId, owner, second, { db: db! });
    if (!b.ok) throw new Error(b.reason);
    // Opening the second role's Gaps page switches nothing (C25): the Map stays on the first role.
    expect((await mapLineFor(userId, db!))!.role.slug).toBe(first.slug);
    expect(await makeDestination(userId, { analysisId: b.analysisId }, { db: db! })).toEqual({ ok: true, changed: true });
    const onSecond = await mapLineFor(userId, db!);
    expect(mapLine.safeParse(onSecond).success).toBe(true);
    expect(onSecond!.role.slug).toBe(second.slug);
    // Gaps worked out again: the line is the second role's.
    expect(onSecond!.goals.map((g) => g.skillId).sort()).toEqual(b.analysis.gaps.map((g) => g.skillId).sort());
    // Proof carried over.
    if (shared && onSecond!.goals.some((g) => g.skillId === shared.skillId)) {
      expect(onSecond!.goals.find((g) => g.skillId === shared.skillId)!.proved).toBe(true);
    }
    // The earlier line: the first role, with its gaps the new line doesn't need.
    const lineIds = new Set(onSecond!.goals.map((g) => g.skillId));
    expect(onSecond!.previous).toMatchObject({ role: { slug: first.slug, title: first.title }, analysisId: a.analysisId });
    expect(onSecond!.previous!.changedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(onSecond!.previous!.came.map((g) => g.skillId)).toEqual(ownLeft.filter((id) => lineIds.has(id)));
    expect(onSecond!.previous!.left.map((g) => g.skillId)).toEqual(ownLeft.filter((id) => !lineIds.has(id)));
    expect(onSecond!.previous!.shared).toBe(ownLeft.filter((id) => lineIds.has(id)).length);
    // Goals left behind are kept, not removed.
    const goals = await db!.select().from(schema.userGoals).where(eq(schema.userGoals.userId, userId));
    for (const g of onSecond!.previous!.left) expect(goals.some((x) => x.skillId === g.skillId)).toBe(true);

    // Goals only the first role needs stop counting for the destination (c): Library suggestions, Timetable and
    // On your line read only goals on the current line, and they come back on a switch back. Nothing is changed.
    const counted = async () =>
      (await db!.select({ skillId: schema.userGoals.skillId }).from(schema.userGoals).where(and(eq(schema.userGoals.userId, userId), goalOnCurrentLine))).map((g) => g.skillId);
    const leftIds = onSecond!.previous!.left.map((g) => g.skillId);
    const onLine = await counted();
    for (const id of leftIds) expect(onLine).not.toContain(id);
    for (const g of onSecond!.goals) expect(onLine).toContain(g.skillId);
    const statuses = await db!.select({ skillId: schema.userGoals.skillId, status: schema.userGoals.status }).from(schema.userGoals).where(eq(schema.userGoals.userId, userId));

    // Switching back: the first role is the destination again, its analysis reused, and the second is the earlier line.
    const back = await getGapsForOwner(r.resumeId, owner, first, { db: db! });
    if (!back.ok) throw new Error(back.reason);
    expect(back.analysisId).toBe(a.analysisId);
    expect(back.choosable).toBe(true);
    expect(await makeDestination(userId, { analysisId: onSecond!.previous!.analysisId }, { db: db! })).toEqual({ ok: true, changed: true });
    const backOnLine = await counted();
    for (const id of leftIds) expect(backOnLine).toContain(id);
    // The left goals were never changed: the same rows, the same statuses.
    const statusesAfter = await db!.select({ skillId: schema.userGoals.skillId, status: schema.userGoals.status }).from(schema.userGoals).where(eq(schema.userGoals.userId, userId));
    for (const g of statuses.filter((x) => leftIds.includes(x.skillId))) expect(statusesAfter).toContainEqual(g);
    const onFirstAgain = await mapLineFor(userId, db!);
    expect(onFirstAgain!.role.slug).toBe(first.slug);
    expect(onFirstAgain!.previous!.role.slug).toBe(second.slug);
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
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.length).toBeLessThanOrEqual(2);
    expect(lines.every((l) => l.slug !== own.slug)).toBe(true);
    expect(new Set(lines.map((l) => l.skillId)).size).toBe(lines.length);
    for (const l of lines) {
      const other = roleProfiles.find((r) => r.slug === l.slug)!;
      expect(other.skills.some((s) => s.skillId === l.skillId && s.importance === "required")).toBe(true);
    }
  });
  it("puts Nearby lines first, each crossing at a goal it also needs, then fills with other roles", () => {
    const goal = (skillId: string) => ({ skillId, name: skillId, status: "missing" as const, learnDone: false, proved: false, resources: [], practice: null });
    const goals = ["statistics", "machine-learning", "power-bi"].map(goal);
    const nearby = {
      lines: [
        { slug: "data-scientist", title: "Data Scientist", crossSkillIds: ["statistics", "machine-learning"] },
        { slug: "business-analyst", title: "Business Analyst", crossSkillIds: ["machine-learning"] },
        { slug: "data-engineer", title: "Data Engineer", crossSkillIds: [] },
      ],
    };
    const lines = otherLines("data-analyst", goals, nearby);
    expect(lines[0]).toEqual({ slug: "data-scientist", title: "Data Scientist", skillId: "machine-learning", nearby: true });
    // Machine learning is taken, so Business Analyst has no free goal to cross at and the last slot goes to another role.
    expect(lines.some((l) => l.slug === "business-analyst" && l.nearby)).toBe(false);
    expect(lines.some((l) => l.slug === "data-engineer")).toBe(false);
    expect(lines).toHaveLength(2);
    expect(lines[1].nearby).toBeUndefined();
    expect(new Set(lines.map((l) => l.skillId)).size).toBe(2);
    expect(mapLine.shape.otherLines.safeParse(lines).success).toBe(true);
  });
});
