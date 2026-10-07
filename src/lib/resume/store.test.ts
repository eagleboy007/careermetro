import { readFileSync } from "node:fs";
import { eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as schema from "@/db/schema";
import type { Profile } from "@/lib/schemas";
import { ingestResume } from "./ingest";
import type { ParseClient } from "./parse";
import { confirmProfile, getResumeForSession } from "./store";

// Runs against a real Postgres with migrations applied, like ingest.test.ts.
const url = process.env.TEST_DATABASE_URL;
const sqlClient = url ? postgres(url, { max: 2, onnotice: () => {} }) : null;
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

describe.skipIf(!db)("resume store (database)", () => {
  const session = `store-${Date.now()}`;
  const created: string[] = [];
  // Spend from earlier runs against the same database must not trip the budget.
  beforeAll(() => vi.stubEnv("PARSE_DAILY_BUDGET_USD", "1000000"));
  afterAll(async () => {
    vi.unstubAllEnvs();
    if (created.length) await db!.delete(schema.resumes).where(inArray(schema.resumes.id, created));
    await sqlClient!.end();
  });

  async function upload(s: string) {
    const r = await ingestResume({ bytes, as: "text", sessionId: s, clientHash: `h-${s}` }, { db: db!, client });
    if (!r.ok) throw new Error(`setup failed: ${r.code}`);
    created.push(r.resumeId);
    return r.resumeId;
  }

  it("shows a resume only to the session that uploaded it", async () => {
    const id = await upload(session);
    expect(await getResumeForSession(id, session, db!)).toMatchObject({ resumeId: id, version: 1, confirmed: false });
    expect(await getResumeForSession(id, `${session}-other`, db!)).toBeNull();
    expect(await getResumeForSession("not-a-uuid", session, db!)).toBeNull();
  });

  it("saves a confirmed profile as a new version", async () => {
    const id = await upload(`${session}-c`);
    expect(await confirmProfile(id, `${session}-c`, parsed, db!)).toBe(2);
    expect(await getResumeForSession(id, `${session}-c`, db!)).toMatchObject({ version: 2, confirmed: true });
    expect(await confirmProfile(id, `${session}-x`, parsed, db!)).toBeNull();
  });

  it("hides anonymous resumes older than 24 hours before cleanup runs", async () => {
    const id = await upload(`${session}-old`);
    await db!.update(schema.resumes).set({ createdAt: new Date(Date.now() - 25 * 3600_000) }).where(eq(schema.resumes.id, id));
    expect(await getResumeForSession(id, `${session}-old`, db!)).toBeNull();
    expect(await confirmProfile(id, `${session}-old`, parsed, db!)).toBeNull();
  });
});
