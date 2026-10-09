import { readFileSync } from "node:fs";
import { eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as schema from "@/db/schema";
import { GAP_LIMITS, getGapsForOwner, rateAnalysis } from "@/lib/gaps/store";
import { getPathForOwner, markStepDone, PATH_LIMITS } from "@/lib/path/store";
import { ingestResume, LIMITS } from "@/lib/resume/ingest";
import type { ParseClient } from "@/lib/resume/parse";
import { confirmProfile, getResumeForOwner } from "@/lib/resume/store";
import type { Profile } from "@/lib/schemas";
import { roleProfiles } from "@/content";
import { claimAnonymousResumes, createAccount, findAccount, touchLastSeen } from "./store";

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

describe.skipIf(!db)("account store (database)", () => {
  const run = `acct-${Date.now()}`;
  const userIds: string[] = [];
  const role = roleProfiles[0];
  const limits = { explain: GAP_LIMITS.explainedPerOwnerPerDay, word: PATH_LIMITS.wordedPerOwnerPerDay };
  beforeAll(() => {
    vi.stubEnv("PARSE_DAILY_BUDGET_USD", "1000000");
    // Template wording only: these tests are about who sees what, not the model.
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

  const identity = (n: string) => ({ subject: `${run}-${n}`, email: `${run}-${n}@Example.test`, emailVerified: true, name: "Test User" });

  async function signUp(n: string, sessionId: string | null = null) {
    const r = await createAccount(identity(n), { name: "Test User", sessionId }, db!);
    if (!r.ok) throw new Error(r.reason);
    userIds.push(r.account.id);
    return r.account;
  }

  async function upload(sessionId: string) {
    const r = await ingestResume({ bytes, as: "text", owner: { sessionId }, clientHash: `h-${sessionId}` }, { db: db!, client });
    if (!r.ok) throw new Error(r.code);
    return r.resumeId;
  }

  it("creates one user with a lower-case email, an age date and an account consent, and is safe to repeat", async () => {
    const a = await signUp("new");
    expect(a.email).toBe(`${run}-new@example.test`);
    const again = await createAccount(identity("new"), { name: null, sessionId: null }, db!);
    expect(again).toEqual({ ok: true, account: a });
    const [row] = await db!.select().from(schema.users).where(eq(schema.users.id, a.id));
    expect(row.ageConfirmedAt).not.toBeNull();
    const rows = await db!.select().from(schema.consents).where(eq(schema.consents.userId, a.id));
    expect(rows.map((c) => c.purpose)).toEqual(["account"]);
    expect(await findAccount(identity("new").subject, db!)).toEqual(a);
  });

  it("links an existing user with the same verified email in any case, and refuses one already linked", async () => {
    const [old] = await db!.insert(schema.users).values({ email: `${run}-LINK@example.TEST` }).returning({ id: schema.users.id });
    userIds.push(old.id);
    expect(await createAccount({ ...identity("link"), emailVerified: false }, { name: null, sessionId: null }, db!)).toEqual({
      ok: false,
      reason: "email_unverified",
    });
    const linked = await createAccount(identity("link"), { name: null, sessionId: null }, db!);
    expect(linked).toMatchObject({ ok: true, account: { id: old.id, email: `${run}-link@example.test` } });
    const other = await createAccount({ ...identity("link"), subject: `${run}-link-2` }, { name: null, sessionId: null }, db!);
    expect(other).toEqual({ ok: false, reason: "email_taken" });
  });

  it("moves this browser's anonymous resume, gaps and path to the new user, and the old cookie loses them", async () => {
    const session = `${run}-claim`;
    const resumeId = await upload(session);
    await confirmProfile(resumeId, { sessionId: session }, parsed, db!);
    const user = await signUp("claim", session);
    const owner = { userId: user.id };
    expect(await getResumeForOwner(resumeId, owner, db!)).toMatchObject({ resumeId });
    expect(await getResumeForOwner(resumeId, { sessionId: session }, db!)).toBeNull();
    const gaps = await getGapsForOwner(resumeId, owner, role, { db: db! });
    expect(gaps.ok).toBe(true);
    if (!gaps.ok) throw new Error(gaps.reason);
    const path = await getPathForOwner(resumeId, owner, role, 5, { db: db! });
    if (!path.ok) throw new Error(path.reason);
    const stepId = path.path.steps[0].id;
    const old = { sessionId: session };
    expect(await rateAnalysis(gaps.analysisId, old, 4, db!)).toBe(false);
    expect(await markStepDone(stepId, old, true, db!)).toBe(false);
    expect(await rateAnalysis(gaps.analysisId, owner, 4, db!)).toBe(true);
    expect(await markStepDone(stepId, owner, true, db!)).toBe(true);
    const [consent] = await db!
      .select({ userId: schema.consents.userId })
      .from(schema.consents)
      .innerJoin(schema.resumes, eq(schema.resumes.consentId, schema.consents.id))
      .where(eq(schema.resumes.id, resumeId));
    expect(consent.userId).toBe(user.id);
  });

  it("claims a later anonymous analysis when an existing user signs up again from another browser", async () => {
    const user = await signUp("again");
    const session = `${run}-again-2`;
    const resumeId = await upload(session);
    expect(await createAccount(identity("again"), { name: null, sessionId: session }, db!)).toMatchObject({ ok: true });
    expect(await getResumeForOwner(resumeId, { userId: user.id }, db!)).toMatchObject({ resumeId });
  });

  it("keeps counting a session's uploads after they are claimed, and gives a user their own limit", async () => {
    const session = `${run}-limit`;
    for (let i = 0; i < LIMITS.perOwnerPerDay; i++) await upload(session);
    const user = await signUp("limit", session);
    const again = await ingestResume({ bytes, as: "text", owner: { sessionId: session }, clientHash: `h-${session}-x` }, { db: db!, client });
    expect(again).toMatchObject({ ok: false, status: 429 });
    const asUser = await ingestResume({ bytes, as: "text", owner: { userId: user.id }, clientHash: `h-${session}-u` }, { db: db!, client });
    expect(asUser).toMatchObject({ ok: false, status: 429 });
    const fresh = await signUp("limit-fresh");
    const own = await ingestResume({ bytes, as: "text", owner: { userId: fresh.id }, clientHash: `h-${run}-fresh` }, { db: db!, client });
    if (!own.ok) throw new Error(own.code);
    const [row] = await db!.select().from(schema.resumes).where(eq(schema.resumes.id, own.resumeId));
    expect(row).toMatchObject({ userId: fresh.id, anonymousSessionId: null });
  });

  it("lets two tabs finish sign-up at once without a second user", async () => {
    const results = await Promise.all([1, 2, 3].map(() => createAccount(identity("race"), { name: null, sessionId: null }, db!)));
    const ids = new Set(results.map((r) => (r.ok ? r.account.id : r.reason)));
    expect(ids.size).toBe(1);
    userIds.push(...ids);
  });

  it("keeps one user's resume, gaps and path away from another user", async () => {
    const session = `${run}-mine`;
    const resumeId = await upload(session);
    await confirmProfile(resumeId, { sessionId: session }, parsed, db!);
    const rightful = await signUp("mine", session);
    expect(await getResumeForOwner(resumeId, { userId: rightful.id }, db!)).toMatchObject({ resumeId });
    const stranger = await signUp("stranger");
    const owner = { userId: stranger.id };
    expect(await getResumeForOwner(resumeId, owner, db!)).toBeNull();
    expect(await getGapsForOwner(resumeId, owner, role, { db: db! })).toEqual({ ok: false, reason: "not_found" });
    expect(await getPathForOwner(resumeId, owner, role, 5, { db: db! })).toEqual({ ok: false, reason: "not_found" });
  });

  it("claims only unexpired resumes, and a claimed resume no longer expires", async () => {
    const session = `${run}-age`;
    const fresh = await upload(session);
    const stale = await upload(session);
    await db!.update(schema.resumes).set({ createdAt: new Date(Date.now() - 25 * 3600_000) }).where(eq(schema.resumes.id, stale));
    const user = await signUp("age");
    expect(await claimAnonymousResumes(user.id, session, db!)).toBe(1);
    await db!.update(schema.resumes).set({ createdAt: new Date(Date.now() - 30 * 24 * 3600_000) }).where(eq(schema.resumes.id, fresh));
    expect(await getResumeForOwner(fresh, { userId: user.id }, db!)).toMatchObject({ resumeId: fresh });
    await db!.delete(schema.resumes).where(eq(schema.resumes.id, stale));
  });

  it("records a visit at most once a day", async () => {
    const user = await signUp("seen");
    const old = new Date(Date.now() - 2 * 24 * 3600_000);
    await db!.update(schema.users).set({ lastSeenAt: old }).where(eq(schema.users.id, user.id));
    await touchLastSeen(user.id, db!);
    const [first] = await db!.select({ at: schema.users.lastSeenAt }).from(schema.users).where(eq(schema.users.id, user.id));
    expect(first.at!.getTime()).toBeGreaterThan(old.getTime());
    await touchLastSeen(user.id, db!);
    const [second] = await db!.select({ at: schema.users.lastSeenAt }).from(schema.users).where(eq(schema.users.id, user.id));
    expect(second.at!.getTime()).toBe(first.at!.getTime());
  });
});
