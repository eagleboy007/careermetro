import { readFileSync } from "node:fs";
import { eq, inArray, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "@/db/schema";
import { profile as profileSchema } from "@/lib/schemas";
import { LIMITS as SHARED } from "@/lib/shared-limit";
import fixture from "../../../fixtures/sample-resume/priya-sharma.parsed.json";
import { ingestResume, LIMITS } from "./ingest";
import { maskPii } from "./mask";
import { parsedResume, type ParseClient } from "./parse";
import { EXPORT_VERSION, exportAccountData } from "@/lib/account/export";
import { MATCHER_VERSION } from "@/lib/gaps/match";
import { createSampleResume, HAS_OWN_RESUME, isSampleResume, SAMPLE_MIME, sampleProfile } from "./sample";
import { getResumeForOwner } from "./store";
import { verifyProfile } from "./verify";

// parseResume as it is, watched: making the sample must never call it, while a real upload in these tests does.
const watch = vi.hoisted(() => ({ parse: vi.fn() }));
vi.mock("./parse", async (original) => {
  const real = await original<typeof import("./parse")>();
  watch.parse.mockImplementation(real.parseResume);
  return { ...real, parseResume: watch.parse };
});

// The sample's source: the synthetic resume the fixture was written from, by hand, once (no model call).
const resumeText = readFileSync("fixtures/resumes/priya-sharma.txt", "utf8");

describe("the sample resume fixture", () => {
  it("is exactly what the parser returns: its output schema, with no extra keys", () => {
    expect(parsedResume.safeParse(fixture).success).toBe(true);
    // Zod drops unknown keys, so check them too: a typo in the fixture must fail here, not vanish.
    const strict = parsedResume
      .extend({
        roles: profileSchema.shape.roles.element.strict().array(),
        skills: profileSchema.shape.skills.element.strict().array(),
        education: profileSchema.shape.education.element.strict().array(),
        certifications: profileSchema.shape.certifications.element.strict().array(),
      })
      .strict();
    expect(strict.safeParse(fixture).success).toBe(true);
  });

  it("passes the upload's own check against the masked resume text, so nothing in it is invented (AI-5)", () => {
    const { personName, ...rest } = fixture;
    const masked = maskPii(resumeText).text;
    const { profile, report } = verifyProfile(profileSchema.parse(rest), masked);
    expect(report).toEqual({ droppedSkills: [], droppedQuotes: 0, droppedRoles: 0, droppedOther: 0 });
    expect(profile).toEqual(profileSchema.parse(rest));
    expect(masked).toContain(personName);
  });

  it("is stored without the name printed on it", () => {
    const p = sampleProfile();
    expect(profileSchema.safeParse(p).success).toBe(true);
    expect(JSON.stringify(p)).not.toContain("Priya");
    expect(p.skills.map((s) => s.name)).toContain("SQL");
  });

  it("is told apart by its MIME type only", () => {
    expect(isSampleResume(SAMPLE_MIME)).toBe(true);
    expect(isSampleResume("text/plain")).toBe(false);
    expect(isSampleResume(null)).toBe(false);
  });

  it("says where to go when it is refused for the person's own resume", () => {
    expect(HAS_OWN_RESUME).toMatchObject({ ok: false, status: 409, code: "has_resume", message: "You already have your own resume. Open it from your Map." });
  });
});

// Runs against a real Postgres with migrations applied, e.g. TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/cm
const url = process.env.TEST_DATABASE_URL;
const sqlClient = url ? postgres(url, { max: 2, onnotice: () => {} }) : null;
const db = sqlClient ? drizzle(sqlClient, { schema }) : null;

describe.skipIf(!db)("createSampleResume (database)", () => {
  const session = `sample-${Date.now()}`;
  const created: string[] = [];
  beforeEach(() => watch.parse.mockClear());
  afterAll(async () => {
    if (created.length) await db!.delete(schema.resumes).where(inArray(schema.resumes.id, created));
    await sqlClient!.end();
  });

  it("stores a parsed, unconfirmed sample profile with no model call, no ai_calls row and no consent", async () => {
    const result = await createSampleResume({ owner: { sessionId: session }, clientHash: `h-${session}` }, { db: db! });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    created.push(result.resumeId);

    const [resume] = await db!.select().from(schema.resumes).where(eq(schema.resumes.id, result.resumeId));
    expect(resume).toMatchObject({
      status: "parsed",
      anonymousSessionId: session,
      userId: null,
      mimeType: SAMPLE_MIME,
      source: "upload",
      storageKey: null,
      consentId: null,
      nameHashes: null,
      fileDeleteAfter: null,
    });
    const [profile] = await db!.select().from(schema.profiles).where(eq(schema.profiles.resumeId, result.resumeId));
    expect(profile).toMatchObject({ version: 1, confirmedByUser: false, aiCallId: null });
    expect(profile.data).toEqual(sampleProfile());
    const logged = await db!
      .select({ id: schema.aiCalls.id })
      .from(schema.aiCalls)
      .where(sql`${schema.aiCalls.inputRefs}->>'resumeId' = ${result.resumeId}`);
    expect(logged).toEqual([]);
    expect(watch.parse).not.toHaveBeenCalled();

    // The confirm step reads it as any resume, labelled as the sample.
    expect(await getResumeForOwner(result.resumeId, { sessionId: session }, db!)).toMatchObject({ resumeId: result.resumeId, version: 1, confirmed: false, sample: true });
  });

  it("never uses up a real upload, and a real upload afterwards is not a sample", async () => {
    const s = `${session}-then-upload`;
    const tried = await createSampleResume({ owner: { sessionId: s }, clientHash: `h-${s}` }, { db: db! });
    if (!tried.ok) throw new Error("sample failed");
    created.push(tried.resumeId);
    expect(watch.parse).not.toHaveBeenCalled();
    vi.stubEnv("PARSE_DAILY_BUDGET_USD", "1000000");
    const create = vi.fn().mockResolvedValue({
      model: "claude-opus-5-5",
      stop_reason: "end_turn",
      usage: { input_tokens: 3000, output_tokens: 1000 },
      content: [{ type: "text", text: JSON.stringify({ ...sampleProfile(), personName: null }) }],
    });
    const client = { beta: { messages: { create } } } as unknown as ParseClient;
    const bytes = new TextEncoder().encode(resumeText);
    try {
      // All of the day's uploads are still there after the sample.
      for (let i = 0; i < LIMITS.perOwnerPerDay; i++) {
        const r = await ingestResume({ bytes, as: "text", owner: { sessionId: s }, clientHash: `h-${s}-${i}` }, { db: db!, client });
        expect(r.ok).toBe(true);
        if (r.ok) created.push(r.resumeId);
        if (r.ok) expect((await getResumeForOwner(r.resumeId, { sessionId: s }, db!))?.sample).toBe(false);
      }
      expect(watch.parse).toHaveBeenCalledTimes(LIMITS.perOwnerPerDay);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("reuses the owner's sample on every try, even two at once, and stops at its own daily limit per owner", async () => {
    const s = `${session}-limit`;
    const both = await Promise.all([0, 1].map((i) => createSampleResume({ owner: { sessionId: s }, clientHash: `h-${s}-${i}` }, { db: db! })));
    const ids = new Set(both.flatMap((r) => (r.ok ? [r.resumeId] : [])));
    expect(ids.size).toBe(1);
    created.push(...ids);
    for (let i = 2; i < SHARED.sampleResumesPerOwner.max; i++) {
      const r = await createSampleResume({ owner: { sessionId: s }, clientHash: `h-${s}-${i}` }, { db: db! });
      expect(r).toEqual({ ok: true, resumeId: [...ids][0] });
    }
    const over = await createSampleResume({ owner: { sessionId: s }, clientHash: `h-${s}-x` }, { db: db! });
    expect(over).toMatchObject({ ok: false, status: 429, code: "rate_limited" });
    const rows = await db!.select({ id: schema.resumes.id }).from(schema.resumes).where(eq(schema.resumes.anonymousSessionId, s));
    expect(rows).toHaveLength(1);
  });

  it("is refused once the person's own resume has gaps, so the sample never quietly becomes current again (T114)", async () => {
    const s = `${session}-own`;
    const tried = await createSampleResume({ owner: { sessionId: s }, clientHash: `h-${s}` }, { db: db! });
    if (!tried.ok) throw new Error("sample failed");
    created.push(tried.resumeId);
    // Their own resume, checked and with its gaps seen.
    const [own] = await db!.insert(schema.resumes).values({ anonymousSessionId: s, mimeType: "text/plain", sizeBytes: 1, status: "parsed" }).returning();
    created.push(own.id);
    const [p] = await db!.insert(schema.profiles).values({ resumeId: own.id, version: 1, data: sampleProfile(), confirmedByUser: true }).returning();
    const result = { roleSlug: "data-analyst", gaps: [], metSkillIds: [], niceToHave: [], readiness: { headline: "h", explanation: "e", estimatedHours: 1 } };
    await db!.insert(schema.gapAnalyses).values({ profileId: p.id, result, matcherVersion: MATCHER_VERSION });
    expect(await createSampleResume({ owner: { sessionId: s }, clientHash: `h-${s}-2` }, { db: db! })).toEqual(HAS_OWN_RESUME);
    const rows = await db!.select({ id: schema.resumes.id }).from(schema.resumes).where(eq(schema.resumes.anonymousSessionId, s));
    expect(rows).toHaveLength(2);
  });

  it("is marked sample: true in Download your data (version 32) (T114)", async () => {
    const [u] = await db!.insert(schema.users).values({ email: `${session}-export@example.test`, name: "Test Person" }).returning({ id: schema.users.id });
    try {
      const tried = await createSampleResume({ owner: { userId: u.id }, clientHash: `h-${session}-export` }, { db: db! });
      if (!tried.ok) throw new Error("sample failed");
      const data = await exportAccountData(u.id, db!);
      expect(EXPORT_VERSION).toBe(40);
      expect(data!.exportVersion).toBe(40);
      expect(data!.resumes).toEqual([expect.objectContaining({ id: tried.resumeId, sample: true })]);
    } finally {
      await db!.delete(schema.users).where(eq(schema.users.id, u.id));
    }
  });

  it("stops at the per-address limit before counting the owner's", async () => {
    const hash = `h-${session}-ip`;
    for (let i = 0; i < SHARED.sampleResumesPerIp.max; i++) {
      const r = await createSampleResume({ owner: { sessionId: `${session}-ip-${i}` }, clientHash: hash }, { db: db! });
      if (r.ok) created.push(r.resumeId);
    }
    const fresh = { sessionId: `${session}-ip-fresh` };
    expect(await createSampleResume({ owner: fresh, clientHash: hash }, { db: db! })).toMatchObject({ ok: false, status: 429 });
    // The owner's count was never taken, so the same owner from another address still gets the sample.
    const elsewhere = await createSampleResume({ owner: fresh, clientHash: `${hash}-other` }, { db: db! });
    expect(elsewhere.ok).toBe(true);
    if (elsewhere.ok) created.push(elsewhere.resumeId);
  });
});
