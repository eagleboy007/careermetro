import { eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { roleProfiles } from "@/content";
import * as schema from "@/db/schema";
import type { Profile } from "@/lib/schemas";
import { SHOWN_GAPS } from "./analysis";
import type { ExplainClient } from "./explain";
import { GAP_LIMITS, getGapsForOwner, rateAnalysis } from "./store";

// Runs against a real Postgres with migrations applied, like ingest.test.ts.
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

function explainClient() {
  const create = vi.fn().mockImplementation(async (body: { messages: { content: string }[] }) => {
    const data = JSON.parse(body.messages[0].content.replace(/^<analysis>|<\/analysis>$/g, ""));
    const gaps = data.gaps.map((g: { skillId: string }) => ({ skillId: g.skillId, explanation: `Explained ${g.skillId}.` }));
    return { model: "claude-opus-5-5", stop_reason: "end_turn", usage: { input_tokens: 1000, output_tokens: 300 }, content: [{ type: "text", text: JSON.stringify({ readiness: "Close.", gaps }) }] };
  });
  return { client: { beta: { messages: { create } } } as unknown as ExplainClient, create };
}

describe.skipIf(!db)("gap analyses (database)", () => {
  const created: string[] = [];
  let n = 0;

  async function seed(confirmed = true) {
    const session = `gaps-${Date.now()}-${n++}`;
    const [resume] = await db!.insert(schema.resumes).values({ anonymousSessionId: session, mimeType: "text/plain", sizeBytes: 10, status: "parsed" }).returning();
    created.push(resume.id);
    await db!.insert(schema.profiles).values({ resumeId: resume.id, version: 1, data: profile, confirmedByUser: confirmed });
    return { session, resumeId: resume.id };
  }

  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.stubEnv("EXPLAIN_DAILY_BUDGET_USD", "1000000");
  });
  afterAll(async () => {
    if (created.length) await db!.delete(schema.resumes).where(inArray(schema.resumes.id, created));
    await sqlClient!.end();
  });

  it("explains, stores and then reuses the analysis, logging the call", async () => {
    const { session, resumeId } = await seed();
    const { client, create } = explainClient();
    const first = await getGapsForOwner(resumeId, { sessionId: session }, role, { db: db!, client });
    if (!first.ok) throw new Error(first.reason);
    expect(first.analysis.gaps.length).toBeGreaterThan(SHOWN_GAPS);
    expect(first.analysis.gaps[0].explanation).toMatch(/^Explained /);

    const [row] = await db!.select().from(schema.gapAnalyses).where(eq(schema.gapAnalyses.id, first.analysisId));
    expect(row).toMatchObject({ matcherVersion: "matcher/v1" });
    const [call] = await db!.select().from(schema.aiCalls).where(eq(schema.aiCalls.id, row.aiCallId!));
    expect(call).toMatchObject({ purpose: "explain-gaps", promptVersion: "explain-gaps/v1", ok: true });
    expect(JSON.stringify(call)).not.toContain("branch reports");

    const again = await getGapsForOwner(resumeId, { sessionId: session }, role, { db: db!, client });
    expect(again).toMatchObject({ ok: true, analysisId: first.analysisId });
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("extends an analysis stored with only five gaps, keeping its id, rating and words, without the model", async () => {
    const { session, resumeId } = await seed();
    const first = await getGapsForOwner(resumeId, { sessionId: session }, role, { db: db!, client: explainClient().client });
    if (!first.ok) throw new Error(first.reason);
    const five = { ...first.analysis, gaps: first.analysis.gaps.slice(0, SHOWN_GAPS) };
    await db!.update(schema.gapAnalyses).set({ result: five, userRating: 4 }).where(eq(schema.gapAnalyses.id, first.analysisId));

    const { client, create } = explainClient();
    const again = await getGapsForOwner(resumeId, { sessionId: session }, role, { db: db!, client });
    if (!again.ok) throw new Error(again.reason);
    expect(create).not.toHaveBeenCalled();
    expect(again).toMatchObject({ analysisId: first.analysisId, rating: 4 });
    expect(again.analysis.gaps.map((g) => g.explanation)).toEqual(first.analysis.gaps.map((g, i) => (i < SHOWN_GAPS ? g.explanation : expect.any(String))));
    expect(again.analysis.gaps.length).toBe(first.analysis.gaps.length);
    const [row] = await db!.select().from(schema.gapAnalyses).where(eq(schema.gapAnalyses.id, first.analysisId));
    expect((row.result as { gaps: unknown[] }).gaps).toHaveLength(first.analysis.gaps.length);
  });

  it("leaves a stored analysis alone when the date has changed the match since", async () => {
    const { session, resumeId } = await seed();
    const first = await getGapsForOwner(resumeId, { sessionId: session }, role, { db: db!, client: explainClient().client });
    if (!first.ok) throw new Error(first.reason);
    const five = { ...first.analysis, gaps: first.analysis.gaps.slice(0, SHOWN_GAPS) };
    const moved = { ...five, gaps: five.gaps.map((g, i) => (i === 0 ? { ...g, status: g.status === "weak" ? ("outdated" as const) : ("weak" as const) } : g)) };
    await db!.update(schema.gapAnalyses).set({ result: moved }).where(eq(schema.gapAnalyses.id, first.analysisId));
    const again = await getGapsForOwner(resumeId, { sessionId: session }, role, { db: db!, client: explainClient().client });
    expect(again.ok && again.analysis.gaps).toHaveLength(SHOWN_GAPS);
  });

  it("hides other sessions' resumes and waits for a confirmed profile", async () => {
    const { resumeId } = await seed();
    expect(await getGapsForOwner(resumeId, { sessionId: "someone-else" }, role, { db: db! })).toEqual({ ok: false, reason: "not_found" });
    const unconfirmed = await seed(false);
    expect(await getGapsForOwner(unconfirmed.resumeId, { sessionId: unconfirmed.session }, role, { db: db! })).toEqual({ ok: false, reason: "not_confirmed" });
  });

  it("uses template sentences without calling the model once the budget is spent", async () => {
    vi.stubEnv("EXPLAIN_DAILY_BUDGET_USD", "0");
    const { session, resumeId } = await seed();
    const { client, create } = explainClient();
    const r = await getGapsForOwner(resumeId, { sessionId: session }, role, { db: db!, client });
    expect(create).not.toHaveBeenCalled();
    expect(r.ok && r.analysis.gaps[0].explanation).toMatch(/^This role expects you to|^Your resume names|^The latest use/);
  });

  it("stops explaining past the per-session daily count", async () => {
    const { session, resumeId } = await seed();
    const original = GAP_LIMITS.explainedPerOwnerPerDay;
    GAP_LIMITS.explainedPerOwnerPerDay = 1;
    try {
      const { client, create } = explainClient();
      await getGapsForOwner(resumeId, { sessionId: session }, role, { db: db!, client });
      await getGapsForOwner(resumeId, { sessionId: session }, roleProfiles.find((r) => r.slug === "business-analyst")!, { db: db!, client });
      expect(create).toHaveBeenCalledTimes(1);
    } finally {
      GAP_LIMITS.explainedPerOwnerPerDay = original;
    }
  });

  it("saves a rating only for the session's own analysis and only from 1 to 5", async () => {
    const { session, resumeId } = await seed();
    const r = await getGapsForOwner(resumeId, { sessionId: session }, role, { db: db!, client: explainClient().client });
    if (!r.ok) throw new Error(r.reason);
    expect(await rateAnalysis(r.analysisId, { sessionId: "someone-else" }, 4, db!)).toBe(false);
    expect(await rateAnalysis(r.analysisId, { sessionId: session }, 6, db!)).toBe(false);
    expect(await rateAnalysis(r.analysisId, { sessionId: session }, 4, db!)).toBe(true);
    const again = await getGapsForOwner(resumeId, { sessionId: session }, role, { db: db! });
    expect(again).toMatchObject({ ok: true, rating: 4 });
  });

  it("calls the model once and stores one row when the page loads several times at once", async () => {
    const { session, resumeId } = await seed();
    const { client, create } = explainClient();
    const results = await Promise.all(Array.from({ length: 4 }, () => getGapsForOwner(resumeId, { sessionId: session }, role, { db: db!, client })));
    expect(create).toHaveBeenCalledTimes(1);
    const ids = new Set(results.map((r) => (r.ok ? r.analysisId : r.reason)));
    expect(ids.size).toBe(1);
  });

  it("makes a fresh analysis after the user confirms a new profile version", async () => {
    const { session, resumeId } = await seed();
    const { client } = explainClient();
    const first = await getGapsForOwner(resumeId, { sessionId: session }, role, { db: db!, client });
    await db!.insert(schema.profiles).values({ resumeId, version: 2, data: { ...profile, skills: [{ name: "Python", lastUsed: null, evidence: [] }] }, confirmedByUser: true });
    const second = await getGapsForOwner(resumeId, { sessionId: session }, role, { db: db!, client });
    expect(first.ok && second.ok && first.analysisId !== second.analysisId).toBe(true);
  });

  it("won't rate an analysis once its resume is past 24 hours", async () => {
    const { session, resumeId } = await seed();
    const r = await getGapsForOwner(resumeId, { sessionId: session }, role, { db: db!, client: explainClient().client });
    if (!r.ok) throw new Error(r.reason);
    await db!.update(schema.resumes).set({ createdAt: new Date(Date.now() - 25 * 3600_000) }).where(eq(schema.resumes.id, resumeId));
    expect(await rateAnalysis(r.analysisId, { sessionId: session }, 3, db!)).toBe(false);
  });
});
