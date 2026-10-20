import { APIError } from "@anthropic-ai/sdk";
import { eq, inArray, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { roleProfiles } from "@/content";
import * as schema from "@/db/schema";
import { SAMPLE_MIME } from "@/lib/resume/sample-mime";
import { profile as profileSchema, type Profile } from "@/lib/schemas";
import sampleParsed from "../../../fixtures/sample-resume/priya-sharma.parsed.json";
import { SHOWN_GAPS } from "./analysis";
import type { ExplainClient } from "./explain";
import { MATCHER_VERSION } from "./match";
import { GAP_LIMITS, getGapsForOwner, rateAnalysis } from "./store";

// Runs against a real Postgres with migrations applied, like ingest.test.ts.
const url = process.env.TEST_DATABASE_URL;
const sqlClient = url ? postgres(url, { max: 2, onnotice: () => {} }) : null;
const db = sqlClient ? drizzle(sqlClient, { schema }) : null;

const role = roleProfiles.find((r) => r.slug === "data-scientist")!;
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
    expect(first.sample).toBe(false);
    expect(first.analysis.gaps.length).toBeGreaterThan(SHOWN_GAPS);
    expect(first.analysis.gaps[0].explanation).toMatch(/^Explained /);

    const [row] = await db!.select().from(schema.gapAnalyses).where(eq(schema.gapAnalyses.id, first.analysisId));
    expect(row).toMatchObject({ matcherVersion: MATCHER_VERSION });
    const [call] = await db!.select().from(schema.aiCalls).where(eq(schema.aiCalls.id, row.aiCallId!));
    expect(call).toMatchObject({ purpose: "explain-gaps", promptVersion: "explain-gaps/v1", ok: true });
    expect(JSON.stringify(call)).not.toContain("branch reports");

    const again = await getGapsForOwner(resumeId, { sessionId: session }, role, { db: db!, client });
    expect(again).toMatchObject({ ok: true, analysisId: first.analysisId });
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("never calls the model or spends the budget for the sample resume's gaps, with checked-in words or the template (T113)", async () => {
    const session = `gaps-sample-${Date.now()}-${n++}`;
    const [resume] = await db!.insert(schema.resumes).values({ anonymousSessionId: session, mimeType: SAMPLE_MIME, sizeBytes: 10, status: "parsed" }).returning();
    created.push(resume.id);
    const [p] = await db!.insert(schema.profiles).values({ resumeId: resume.id, version: 1, data: profileSchema.parse(sampleParsed), confirmedByUser: true }).returning();
    const { client, create } = explainClient();
    const analyst = roleProfiles.find((r) => r.slug === "data-analyst")!;
    for (const r of [analyst, role]) {
      const got = await getGapsForOwner(resume.id, { sessionId: session }, r, { db: db!, client, now: new Date("2026-10-20T00:00:00Z") });
      if (!got.ok) throw new Error(got.reason);
      expect(got.sample).toBe(true);
      expect(got.analysis.gaps.length).toBeGreaterThan(0);
      expect(got.analysis.gaps.every((g) => !g.explanation.startsWith("Explained "))).toBe(true);
      const [row] = await db!.select().from(schema.gapAnalyses).where(eq(schema.gapAnalyses.id, got.analysisId));
      expect(row.aiCallId).toBeNull();
    }
    expect(create).not.toHaveBeenCalled();
    const calls = await db!.select().from(schema.aiCalls).where(sql`${schema.aiCalls.inputRefs}->>'profileId' = ${p.id}`);
    expect(calls).toEqual([]);
  });

  it("reads the sample as not found once the person's own resume has gaps, and stores nothing for it (T114)", async () => {
    const session = `gaps-sample-own-${Date.now()}-${n++}`;
    const [sample] = await db!.insert(schema.resumes).values({ anonymousSessionId: session, mimeType: SAMPLE_MIME, sizeBytes: 10, status: "parsed" }).returning();
    created.push(sample.id);
    const [sp] = await db!.insert(schema.profiles).values({ resumeId: sample.id, version: 1, data: profileSchema.parse(sampleParsed), confirmedByUser: true }).returning();
    const analyst = roleProfiles.find((r) => r.slug === "data-analyst")!;
    const owner = { sessionId: session };
    // While only the sample has gaps, it opens as usual, and opens again.
    expect(await getGapsForOwner(sample.id, owner, analyst, { db: db! })).toMatchObject({ ok: true, sample: true });

    // Their own resume, checked, with its gaps seen.
    const [own] = await db!.insert(schema.resumes).values({ anonymousSessionId: session, mimeType: "text/plain", sizeBytes: 10, status: "parsed" }).returning();
    created.push(own.id);
    await db!.insert(schema.profiles).values({ resumeId: own.id, version: 1, data: profile, confirmedByUser: true });
    const mine = await getGapsForOwner(own.id, owner, role, { db: db!, client: explainClient().client });
    expect(mine).toMatchObject({ ok: true, sample: false });

    const { client, create } = explainClient();
    for (const r of [analyst, role]) {
      expect(await getGapsForOwner(sample.id, owner, r, { db: db!, client })).toEqual({ ok: false, reason: "not_found" });
    }
    expect(create).not.toHaveBeenCalled();
    // Only the one analysis from before; none for the other role.
    expect(await db!.select().from(schema.gapAnalyses).where(eq(schema.gapAnalyses.profileId, sp.id))).toHaveLength(1);
  });

  it("links the analysis to the call that answered, after a retry", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { session, resumeId } = await seed();
    const { client, create } = explainClient();
    create.mockRejectedValueOnce(APIError.generate(529, { type: "error", error: { type: "overloaded_error", message: "m" } }, "m", new Headers()));
    const r = await getGapsForOwner(resumeId, { sessionId: session }, role, { db: db!, client });
    if (!r.ok) throw new Error(r.reason);
    expect(create).toHaveBeenCalledTimes(2);
    const [row] = await db!.select().from(schema.gapAnalyses).where(eq(schema.gapAnalyses.id, r.analysisId));
    const [call] = await db!.select().from(schema.aiCalls).where(eq(schema.aiCalls.id, row.aiCallId!));
    expect(call).toMatchObject({ purpose: "explain-gaps", ok: true, status: "done" });
    const attempts = await db!.select().from(schema.aiCalls).where(sql`${schema.aiCalls.inputRefs}->>'profileId' = ${call.inputRefs.profileId}`);
    expect(attempts.map((a) => [a.ok, a.status]).sort()).toEqual([[false, null], [true, "done"]]);
  });

  it("extends an analysis stored with only five gaps, keeping its id, rating and words, without the model", async () => {
    const { session, resumeId } = await seed();
    const first = await getGapsForOwner(resumeId, { sessionId: session }, role, { db: db!, client: explainClient().client });
    if (!first.ok) throw new Error(first.reason);
    // With a saved track, which the rebuild keeps (docs/plans/tracks-plan.md).
    const five = { ...first.analysis, gaps: first.analysis.gaps.slice(0, SHOWN_GAPS), trackId: "example-track" };
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
    expect(row.result.trackId).toBe("example-track");
    expect(again.analysis.trackId).toBe("example-track");
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

  it("carries an older matcher's analysis over when today's rules agree, keeping its id, rating and words", async () => {
    const { session, resumeId } = await seed();
    const first = await getGapsForOwner(resumeId, { sessionId: session }, role, { db: db!, client: explainClient().client });
    if (!first.ok) throw new Error(first.reason);
    await db!.update(schema.gapAnalyses).set({ matcherVersion: "matcher/v1", userRating: 5 }).where(eq(schema.gapAnalyses.id, first.analysisId));

    const { client, create } = explainClient();
    const again = await getGapsForOwner(resumeId, { sessionId: session }, role, { db: db!, client });
    expect(create).not.toHaveBeenCalled();
    expect(again).toMatchObject({ ok: true, analysisId: first.analysisId, rating: 5, analysis: first.analysis });
    const [row] = await db!.select().from(schema.gapAnalyses).where(eq(schema.gapAnalyses.id, first.analysisId));
    expect(row.matcherVersion).toBe(MATCHER_VERSION);
  });

  it("makes a fresh analysis when an older matcher's reading differs from today's", async () => {
    const { session, resumeId } = await seed();
    const first = await getGapsForOwner(resumeId, { sessionId: session }, role, { db: db!, client: explainClient().client });
    if (!first.ok) throw new Error(first.reason);
    const moved = { ...first.analysis, gaps: first.analysis.gaps.map((g, i) => (i === 0 ? { ...g, status: g.status === "weak" ? ("outdated" as const) : ("weak" as const) } : g)) };
    await db!.update(schema.gapAnalyses).set({ result: moved, matcherVersion: "matcher/v1" }).where(eq(schema.gapAnalyses.id, first.analysisId));

    const again = await getGapsForOwner(resumeId, { sessionId: session }, role, { db: db!, client: explainClient().client });
    if (!again.ok) throw new Error(again.reason);
    expect(again.analysisId).not.toBe(first.analysisId);
    expect(again.analysis.gaps[0].status).toBe(first.analysis.gaps[0].status);
    const [old] = await db!.select().from(schema.gapAnalyses).where(eq(schema.gapAnalyses.id, first.analysisId));
    expect(old.matcherVersion).toBe("matcher/v1");
    // Today's analysis is the one found next time.
    const third = await getGapsForOwner(resumeId, { sessionId: session }, role, { db: db!, client: explainClient().client });
    expect(third).toMatchObject({ ok: true, analysisId: again.analysisId });
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

  it("uses none of the daily count on a role the person fully meets", async () => {
    const { session, resumeId } = await seed();
    const original = GAP_LIMITS.explainedPerOwnerPerDay;
    GAP_LIMITS.explainedPerOwnerPerDay = 1;
    try {
      const { client, create } = explainClient();
      const met = { ...role, skills: role.skills.map((s) => ({ ...s, importance: "nice_to_have" as const, oneOf: undefined })), groups: [] };
      const r = await getGapsForOwner(resumeId, { sessionId: session }, met, { db: db!, client });
      expect(r.ok && r.analysis.gaps).toEqual([]);
      await getGapsForOwner(resumeId, { sessionId: session }, roleProfiles.find((x) => x.slug === "business-analyst")!, { db: db!, client });
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

  it("holds no lock or connection while the model answers", async () => {
    const { session, resumeId } = await seed();
    const { client, create } = explainClient();
    const answer = create.getMockImplementation()!;
    let lockFree: unknown = null;
    create.mockImplementationOnce(async (body) => {
      // Another load could take this owner's lock now: the slow call doesn't block it.
      lockFree = await db!.transaction(async (tx) => {
        const [r] = await tx.execute<{ ok: boolean }>(sql`select pg_try_advisory_xact_lock(hashtext(${`cm-gaps:s:${session}`})) as ok`);
        return r.ok;
      });
      return answer(body);
    });
    const r = await getGapsForOwner(resumeId, { sessionId: session }, role, { db: db!, client });
    expect(r.ok).toBe(true);
    expect(lockFree).toBe(true);
  });

  it("reserves before calling, so parallel loads of different roles can't pass the daily count", async () => {
    const { session, resumeId } = await seed();
    const original = GAP_LIMITS.explainedPerOwnerPerDay;
    GAP_LIMITS.explainedPerOwnerPerDay = 1;
    try {
      const { client, create } = explainClient();
      const slugs = ["data-scientist", "business-analyst", "data-analyst", "data-engineer"];
      const results = await Promise.all(slugs.map((slug) => getGapsForOwner(resumeId, { sessionId: session }, roleProfiles.find((r) => r.slug === slug)!, { db: db!, client })));
      expect(results.every((r) => r.ok)).toBe(true);
      expect(create).toHaveBeenCalledTimes(1);
    } finally {
      GAP_LIMITS.explainedPerOwnerPerDay = original;
    }
  });

  it("logs the call with its cost even when storing the analysis fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { session, resumeId } = await seed();
    const [{ profileId }] = await db!.select({ profileId: schema.profiles.id }).from(schema.profiles).where(eq(schema.profiles.resumeId, resumeId));
    const { client, create } = explainClient();
    const answer = create.getMockImplementation()!;
    create.mockImplementationOnce(async (body) => {
      // The resume goes while the model answers, so storing the analysis fails on its foreign key.
      await db!.delete(schema.resumes).where(eq(schema.resumes.id, resumeId));
      return answer(body);
    });
    await expect(getGapsForOwner(resumeId, { sessionId: session }, role, { db: db!, client })).rejects.toThrow();
    const calls = await db!.select().from(schema.aiCalls).where(sql`${schema.aiCalls.inputRefs}->>'profileId' = ${profileId}`);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ purpose: "explain-gaps", status: "done", ok: true, inputTokens: 1000, outputTokens: 300 });
    expect(Number(calls[0].costUsd)).toBeGreaterThan(0);
  });

  it("keeps an analysis another request stored meanwhile, and still logs its own call", async () => {
    const a = await seed();
    const stored = await getGapsForOwner(a.resumeId, { sessionId: a.session }, role, { db: db!, client: explainClient().client });
    if (!stored.ok) throw new Error(stored.reason);
    const [source] = await db!.select().from(schema.gapAnalyses).where(eq(schema.gapAnalyses.id, stored.analysisId));

    const b = await seed();
    const [{ profileId }] = await db!.select({ profileId: schema.profiles.id }).from(schema.profiles).where(eq(schema.profiles.resumeId, b.resumeId));
    const { client, create } = explainClient();
    const answer = create.getMockImplementation()!;
    let otherId = "";
    create.mockImplementationOnce(async (body) => {
      // Another server finishes first.
      const [row] = await db!
        .insert(schema.gapAnalyses)
        .values({ profileId, roleProfileId: source.roleProfileId, result: source.result, matcherVersion: MATCHER_VERSION })
        .returning({ id: schema.gapAnalyses.id });
      otherId = row.id;
      return answer(body);
    });
    const r = await getGapsForOwner(b.resumeId, { sessionId: b.session }, role, { db: db!, client });
    expect(r).toMatchObject({ ok: true, analysisId: otherId });
    const rows = await db!.select({ id: schema.gapAnalyses.id }).from(schema.gapAnalyses).where(eq(schema.gapAnalyses.profileId, profileId));
    expect(rows).toHaveLength(1);
    const calls = await db!.select().from(schema.aiCalls).where(sql`${schema.aiCalls.inputRefs}->>'profileId' = ${profileId}`);
    expect(calls).toMatchObject([{ status: "done", ok: true }]);
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
