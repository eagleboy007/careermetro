import { readFileSync } from "node:fs";
import { eq, inArray } from "drizzle-orm";
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

  beforeEach(() => vi.unstubAllEnvs());
  afterAll(async () => {
    if (created.length) await db!.delete(schema.resumes).where(inArray(schema.resumes.id, created));
    await sqlClient!.end();
  });

  it("stores a verified, unconfirmed profile and logs the call without resume text", async () => {
    const { client: c, create } = client(JSON.stringify(parsed));
    const result = await ingestResume({ bytes, as: "text", sessionId: session, clientHash: `h-${session}` }, { db: db!, client: c });
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
    const result = await ingestResume({ bytes, as: "text", sessionId: `${session}-f`, clientHash: `h-${session}-f` }, { db: db!, client: c });
    expect(result).toMatchObject({ ok: false, status: 422, code: "unparsed" });
    const rows = await db!.select().from(schema.resumes).where(eq(schema.resumes.anonymousSessionId, `${session}-f`));
    created.push(...rows.map((r) => r.id));
    expect(rows.map((r) => r.status)).toEqual(["failed"]);
  });

  it("refuses uploads past the per-session limit without calling the model", async () => {
    const s = `${session}-limit`;
    const { client: c, create } = client(JSON.stringify(parsed));
    for (let i = 0; i < LIMITS.perSessionPerDay; i++) {
      const r = await ingestResume({ bytes, as: "text", sessionId: s, clientHash: `h-${s}-${i}` }, { db: db!, client: c });
      if (r.ok) created.push(r.resumeId);
    }
    create.mockClear();
    const result = await ingestResume({ bytes, as: "text", sessionId: s, clientHash: `h-${s}-x` }, { db: db!, client: c });
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
      Array.from({ length: 6 }, (_, i) => ingestResume({ bytes, as: "text", sessionId: s, clientHash: `h-${s}-${i}` }, { db: db!, client: c })),
    );
    for (const r of results) if (r.ok) created.push(r.resumeId);
    expect(results.filter((r) => r.ok)).toHaveLength(LIMITS.perSessionPerDay);
    expect(results.filter((r) => !r.ok && r.status === 429)).toHaveLength(6 - LIMITS.perSessionPerDay);
  });

  it("marks the resume failed when the model call errors, and logs the call", async () => {
    const s = `${session}-throw`;
    const { client: c, create } = client(JSON.stringify(parsed));
    create.mockRejectedValueOnce(new Error("boom"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await ingestResume({ bytes, as: "text", sessionId: s, clientHash: `h-${s}` }, { db: db!, client: c });
    expect(result).toMatchObject({ ok: false, status: 503, code: "unavailable" });
    const rows = await db!.select().from(schema.resumes).where(eq(schema.resumes.anonymousSessionId, s));
    created.push(...rows.map((r) => r.id));
    expect(rows.map((r) => r.status)).toEqual(["failed"]);
  });

  it("pauses parsing once the daily budget is spent", async () => {
    vi.stubEnv("PARSE_DAILY_BUDGET_USD", "0");
    const { client: c, create } = client(JSON.stringify(parsed));
    const result = await ingestResume({ bytes, as: "text", sessionId: `${session}-b`, clientHash: `h-${session}-b` }, { db: db!, client: c });
    expect(result).toMatchObject({ ok: false, status: 503, code: "busy" });
    expect(create).not.toHaveBeenCalled();
  });

  it("rejects unreadable input before storing anything", async () => {
    const { client: c } = client(JSON.stringify(parsed));
    const result = await ingestResume({ bytes: new TextEncoder().encode("GIF89a"), sessionId: `${session}-g`, clientHash: `h-${session}-g` }, { db: db!, client: c });
    expect(result).toMatchObject({ ok: false, status: 422, code: "unsupported_type" });
    const rows = await db!.select().from(schema.resumes).where(eq(schema.resumes.anonymousSessionId, `${session}-g`));
    expect(rows).toHaveLength(0);
  });

  it("deletes anonymous resumes and their profiles after 24 hours", async () => {
    const { client: c } = client(JSON.stringify(parsed));
    const r = await ingestResume({ bytes, as: "text", sessionId: `${session}-old`, clientHash: `h-${session}-old` }, { db: db!, client: c });
    if (!r.ok) throw new Error("setup failed");
    await db!.update(schema.resumes).set({ createdAt: new Date(Date.now() - 25 * 3600_000) }).where(eq(schema.resumes.id, r.resumeId));
    expect(await deleteExpiredAnonymousResumes(db!)).toBeGreaterThanOrEqual(1);
    expect(await db!.select().from(schema.profiles).where(eq(schema.profiles.resumeId, r.resumeId))).toHaveLength(0);
  });
});
