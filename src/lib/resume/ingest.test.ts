import { readFileSync } from "node:fs";
import { and, eq, gte, inArray, ne, sum } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "@/db/schema";
import type { Profile } from "@/lib/schemas";
import { deleteExpiredAnonymousResumes, ingestResume, LIMITS } from "./ingest";
import type { ParseClient } from "./parse";

// Runs against a real Postgres with migrations applied, e.g. TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/cm
const url = process.env.TEST_DATABASE_URL;
const sqlClient = url ? postgres(url, { max: 2, onnotice: () => {} }) : null;
const db = sqlClient ? drizzle(sqlClient, { schema }) : null;

const resumeText = readFileSync("fixtures/resumes/priya-sharma.txt", "utf8");
const bytes = new TextEncoder().encode(resumeText);
const parsed: Profile = {
  headline: "Data Analyst",
  totalYearsExperience: 3,
  roles: [{ title: "Data Analyst", employer: "Example Retail Pvt Ltd", start: "2022-06", end: null, highlights: [] }],
  skills: [{ name: "SQL", lastUsed: null, evidence: ["Wrote SQL queries for weekly sales reports across 40 stores"] }],
  education: [],
  certifications: [],
};

function client(text: string) {
  const create = vi.fn().mockResolvedValue({
    model: "claude-opus-5-5",
    stop_reason: "end_turn",
    usage: { input_tokens: 3000, output_tokens: 1000 },
    content: [{ type: "text", text }],
  });
  return { client: { beta: { messages: { create } } } as unknown as ParseClient, create };
}

describe.skipIf(!db)("ingestResume (database)", () => {
  const session = `test-${Date.now()}`;
  const created: string[] = [];

  beforeEach(() => {
    vi.unstubAllEnvs();
    // Spend from earlier runs against the same database must not trip the budget in unrelated tests.
    vi.stubEnv("PARSE_DAILY_BUDGET_USD", "1000000");
  });
  afterAll(async () => {
    if (created.length) await db!.delete(schema.resumes).where(inArray(schema.resumes.id, created));
    await sqlClient!.end();
  });

  it("stores a verified, unconfirmed profile and logs the call without resume text", async () => {
    const { client: c, create } = client(JSON.stringify(parsed));
    const result = await ingestResume({ bytes, as: "text", owner: { sessionId: session }, clientHash: `h-${session}` }, { db: db!, client: c });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    created.push(result.resumeId);

    const sent = create.mock.calls[0][0].messages[0].content as string;
    expect(sent).not.toContain("98765");
    expect(sent).toContain("[PHONE]");

    const [resume] = await db!.select().from(schema.resumes).where(eq(schema.resumes.id, result.resumeId));
    expect(resume).toMatchObject({ status: "parsed", anonymousSessionId: session, mimeType: "text/plain", fileDeleteAfter: null });
    expect(resume.consentId).not.toBeNull();

    const [profile] = await db!.select().from(schema.profiles).where(eq(schema.profiles.resumeId, result.resumeId));
    expect(profile).toMatchObject({ version: 1, confirmedByUser: false });
    expect(profile.data.skills.map((s) => s.name)).toEqual(["SQL"]);

    const [call] = await db!.select().from(schema.aiCalls).where(eq(schema.aiCalls.id, profile.aiCallId!));
    expect(call).toMatchObject({ purpose: "parse-resume", promptVersion: "parse-resume/v1", ok: true });
    expect(JSON.stringify(call)).not.toContain("Priya");
  });

  it("marks the resume failed when the model output can't be used", async () => {
    const { client: c } = client("not json");
    const result = await ingestResume({ bytes, as: "text", owner: { sessionId: `${session}-f` }, clientHash: `h-${session}-f` }, { db: db!, client: c });
    expect(result).toMatchObject({ ok: false, status: 422, code: "unparsed" });
    const rows = await db!.select().from(schema.resumes).where(eq(schema.resumes.anonymousSessionId, `${session}-f`));
    created.push(...rows.map((r) => r.id));
    expect(rows.map((r) => r.status)).toEqual(["failed"]);
  });

  it("refuses uploads past the per-session limit without calling the model", async () => {
    const s = `${session}-limit`;
    const { client: c, create } = client(JSON.stringify(parsed));
    for (let i = 0; i < LIMITS.perOwnerPerDay; i++) {
      const r = await ingestResume({ bytes, as: "text", owner: { sessionId: s }, clientHash: `h-${s}-${i}` }, { db: db!, client: c });
      if (r.ok) created.push(r.resumeId);
    }
    create.mockClear();
    const result = await ingestResume({ bytes, as: "text", owner: { sessionId: s }, clientHash: `h-${s}-x` }, { db: db!, client: c });
    expect(result).toMatchObject({ ok: false, status: 429 });
    expect(create).not.toHaveBeenCalled();
  });

  it("lets only the allowed number of parallel uploads through", async () => {
    const s = `${session}-race`;
    const { client: c, create } = client(JSON.stringify(parsed));
    create.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
      return { model: "claude-opus-5-5", stop_reason: "end_turn", usage: { input_tokens: 3000, output_tokens: 1000 }, content: [{ type: "text", text: JSON.stringify(parsed) }] };
    });
    const results = await Promise.all(
      Array.from({ length: 6 }, (_, i) => ingestResume({ bytes, as: "text", owner: { sessionId: s }, clientHash: `h-${s}-${i}` }, { db: db!, client: c })),
    );
    for (const r of results) if (r.ok) created.push(r.resumeId);
    expect(results.filter((r) => r.ok)).toHaveLength(LIMITS.perOwnerPerDay);
    expect(results.filter((r) => !r.ok && r.status === 429)).toHaveLength(6 - LIMITS.perOwnerPerDay);
  });

  it("marks the resume failed when the model call errors, and logs the call", async () => {
    const s = `${session}-throw`;
    const { client: c, create } = client(JSON.stringify(parsed));
    create.mockRejectedValueOnce(new Error("boom"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await ingestResume({ bytes, as: "text", owner: { sessionId: s }, clientHash: `h-${s}` }, { db: db!, client: c });
    expect(result).toMatchObject({ ok: false, status: 503, code: "unavailable" });
    const rows = await db!.select().from(schema.resumes).where(eq(schema.resumes.anonymousSessionId, s));
    created.push(...rows.map((r) => r.id));
    expect(rows.map((r) => r.status)).toEqual(["failed"]);
  });

  it("refuses an over-limit client before reading the file", async () => {
    const s = `${session}-early`;
    const { client: c, create } = client(JSON.stringify(parsed));
    for (let i = 0; i < LIMITS.perOwnerPerDay; i++) {
      const r = await ingestResume({ bytes, as: "text", owner: { sessionId: s }, clientHash: `h-${s}-${i}` }, { db: db!, client: c });
      if (r.ok) created.push(r.resumeId);
    }
    create.mockClear();
    // Unreadable bytes would give 422 if they were extracted; the limit answers first.
    const result = await ingestResume({ bytes: new TextEncoder().encode("GIF89a"), owner: { sessionId: s }, clientHash: `h-${s}-x` }, { db: db!, client: c });
    expect(result).toMatchObject({ ok: false, status: 429 });
  });

  it("answers busy instead of queueing when the reservation lock is held", async () => {
    const s = `${session}-lock`;
    // A short wait keeps the lock from stalling other database test files that run alongside this one.
    const original = LIMITS.reserveLockTimeoutMs;
    LIMITS.reserveLockTimeoutMs = 200;
    const { client: c, create } = client(JSON.stringify(parsed));
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    let locked!: () => void;
    const isLocked = new Promise<void>((resolve) => (locked = resolve));
    const holder = sqlClient!.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(${0x63_6d_72_73})`;
      locked();
      await held;
    });
    await isLocked;
    const result = await ingestResume({ bytes, as: "text", owner: { sessionId: s }, clientHash: `h-${s}` }, { db: db!, client: c }).finally(() => {
      LIMITS.reserveLockTimeoutMs = original;
    });
    release();
    await holder;
    expect(result).toMatchObject({ ok: false, status: 503, code: "crowded" });
    expect(create).not.toHaveBeenCalled();
  });

  it("pauses parsing once the daily budget is spent", async () => {
    vi.stubEnv("PARSE_DAILY_BUDGET_USD", "0");
    const { client: c, create } = client(JSON.stringify(parsed));
    const result = await ingestResume({ bytes, as: "text", owner: { sessionId: `${session}-b` }, clientHash: `h-${session}-b` }, { db: db!, client: c });
    expect(result).toMatchObject({ ok: false, status: 503, code: "busy" });
    expect(create).not.toHaveBeenCalled();
  });

  it("leaves health pings out of the daily budget", async () => {
    const [ping] = await db!
      .insert(schema.aiCalls)
      .values({ purpose: "health-check", model: "claude-opus-5-5", promptVersion: "health-check/none", inputRefs: {}, inputTokens: 0, outputTokens: 0, costUsd: "9999", latencyMs: 1, ok: true })
      .returning({ id: schema.aiCalls.id });
    try {
      const [{ usd }] = await db!
        .select({ usd: sum(schema.aiCalls.costUsd) })
        .from(schema.aiCalls)
        .where(and(gte(schema.aiCalls.createdAt, new Date(new Date().setUTCHours(0, 0, 0, 0))), ne(schema.aiCalls.purpose, "health-check")));
      vi.stubEnv("PARSE_DAILY_BUDGET_USD", String(Number(usd ?? 0) + 100));
      const { client: c } = client(JSON.stringify(parsed));
      const result = await ingestResume({ bytes, as: "text", owner: { sessionId: `${session}-h` }, clientHash: `h-${session}-h` }, { db: db!, client: c });
      expect(result).toMatchObject({ ok: true });
      if (result.ok) created.push(result.resumeId);
    } finally {
      await db!.delete(schema.aiCalls).where(eq(schema.aiCalls.id, ping.id));
    }
  });

  it("rejects unreadable input before storing anything", async () => {
    const { client: c } = client(JSON.stringify(parsed));
    const result = await ingestResume({ bytes: new TextEncoder().encode("GIF89a"), owner: { sessionId: `${session}-g` }, clientHash: `h-${session}-g` }, { db: db!, client: c });
    expect(result).toMatchObject({ ok: false, status: 422, code: "unsupported_type" });
    const rows = await db!.select().from(schema.resumes).where(eq(schema.resumes.anonymousSessionId, `${session}-g`));
    expect(rows).toHaveLength(0);
  });

  it("caps files that fail to read per client, though they never become rows", async () => {
    const { client: c, create } = client(JSON.stringify(parsed));
    const owner = { sessionId: `${session}-f` };
    const clientHash = `h-${session}-f`;
    const bad = { bytes: new TextEncoder().encode("GIF89a"), owner, clientHash };
    for (let i = 0; i < 10; i++) expect(await ingestResume(bad, { db: db!, client: c })).toMatchObject({ code: "unsupported_type" });
    expect(await ingestResume(bad, { db: db!, client: c })).toMatchObject({ ok: false, status: 429, code: "rate_limited" });
    // A good file from the same client is refused too until the window passes, and the model is never called.
    expect(await ingestResume({ bytes, as: "text", owner, clientHash }, { db: db!, client: c })).toMatchObject({ code: "rate_limited" });
    expect(create).not.toHaveBeenCalled();
  });

  it("deletes anonymous resumes and their profiles after 24 hours", async () => {
    const { client: c } = client(JSON.stringify(parsed));
    const r = await ingestResume({ bytes, as: "text", owner: { sessionId: `${session}-old` }, clientHash: `h-${session}-old` }, { db: db!, client: c });
    if (!r.ok) throw new Error("setup failed");
    await db!.update(schema.resumes).set({ createdAt: new Date(Date.now() - 25 * 3600_000) }).where(eq(schema.resumes.id, r.resumeId));
    expect(await deleteExpiredAnonymousResumes(db!)).toBeGreaterThanOrEqual(1);
    expect(await db!.select().from(schema.profiles).where(eq(schema.profiles.resumeId, r.resumeId))).toHaveLength(0);
  });
});
