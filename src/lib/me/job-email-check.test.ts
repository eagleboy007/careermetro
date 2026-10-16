import { eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "@/db/schema";
import { exportAccountData } from "@/lib/account/export";
import { MATCHER_VERSION } from "@/lib/gaps/match";
import type { GapAnalysis, Profile } from "@/lib/schemas";
import { finishJobCheck, jobChecksFor, jobChecksForReview, reviewJobCheck, startJobCheck } from "./job-email-check";
import { meFor } from "./store";

vi.mock("server-only", () => ({}));

// Runs against a real Postgres with migrations applied, like the other store tests.
const url = process.env.TEST_DATABASE_URL;
const sqlClient = url ? postgres(url, { max: 4, onnotice: () => {} }) : null;
const db = sqlClient ? drizzle(sqlClient, { schema }) : null;
const env = { NAME_HASH_KEY: "test-key" };

const analysis: GapAnalysis = {
  roleSlug: "cyber-security-analyst",
  gaps: [],
  metSkillIds: [],
  niceToHave: [],
  readiness: { headline: "h", explanation: "e", estimatedHours: 10 },
};
const profileAt = (employer: string, start = "2024-06", end: string | null = null): Profile => ({
  headline: null,
  totalYearsExperience: 3,
  roles: [
    { title: "SOC analyst", employer, start, end, highlights: [] },
    { title: "Support intern", employer: "Konkan Bank", start: "2022-01", end: "2022-06", highlights: [] },
  ],
  skills: [],
  education: [],
  certifications: [],
});

describe.skipIf(!db)("verified current job (database)", () => {
  const run = `jobchk${Date.now()}`;
  const userIds: string[] = [];
  const clock = new Date("2026-10-16T10:00:00Z");
  const deps = (over: Record<string, unknown> = {}) => ({ db: db!, env, now: clock, delivery: "test" as const, ...over });
  const lines: string[] = [];

  beforeEach(() => {
    for (const level of ["log", "warn", "error"] as const) vi.spyOn(console, level).mockImplementation((line: unknown) => void lines.push(String(line)));
  });
  afterEach(() => vi.restoreAllMocks());
  afterAll(async () => {
    if (userIds.length) await db!.delete(schema.users).where(inArray(schema.users.id, userIds));
    await sqlClient!.end();
    const all = lines.join("\n");
    for (const secret of ["meera.iyer", "garudasec", "Garuda", run]) expect(all).not.toContain(secret);
  });

  async function person(n: string, profile: Profile | null) {
    const [u] = await db!.insert(schema.users).values({ email: `${run}-${n}@example.test`, name: "Meera Iyer" }).returning({ id: schema.users.id });
    userIds.push(u.id);
    if (profile) await newVersion(u.id, profile);
    return u.id;
  }
  /** A new confirmed profile (and its analysis) for the person's resume, as after editing the resume. */
  async function newVersion(userId: string, profile: Profile) {
    let [resume] = await db!.select().from(schema.resumes).where(eq(schema.resumes.userId, userId));
    resume ??= (await db!.insert(schema.resumes).values({ userId, mimeType: "text/plain", sizeBytes: 1, status: "parsed" }).returning())[0];
    const versions = await db!.select().from(schema.profiles).where(eq(schema.profiles.resumeId, resume.id));
    const [p] = await db!.insert(schema.profiles).values({ resumeId: resume.id, version: versions.length + 1, data: profile, confirmedByUser: true }).returning();
    await db!.insert(schema.gapAnalyses).values({ profileId: p.id, result: analysis, matcherVersion: MATCHER_VERSION, createdAt: new Date(Date.now() + versions.length * 1000) });
  }
  async function verify(userId: string, workEmail: string) {
    const sent = await startJobCheck(userId, { workEmail }, deps());
    if (!sent.ok || !sent.testCode) throw new Error(sent.ok ? "no code" : sent.error);
    return finishJobCheck(userId, { workEmail, code: sent.testCode }, deps());
  }
  const labels = async (userId: string) => (await meFor(userId, clock, db!))!.experience.map((e) => e.check ?? null);

  it("verifies the current job with a code to a work email on the company's domain, and keeps only the domain", async () => {
    const me = await person("match", profileAt("Garuda Sec Pvt Ltd"));
    expect(await labels(me)).toEqual([{ state: "not_verified", month: null }, null]);
    expect(await verify(me, "meera.iyer@garudasec.com")).toEqual({ ok: true, status: "verified" });
    expect(await labels(me)).toEqual([{ state: "verified", month: "Oct 2026" }, null]);
    const [row] = await db!.select().from(schema.jobEmailChecks).where(eq(schema.jobEmailChecks.userId, me));
    expect(row).toMatchObject({ employer: "Garuda Sec Pvt Ltd", employerKey: "garuda sec", startMonth: "2024-06", domain: "garudasec.com", status: "verified" });
    expect(JSON.stringify(row)).not.toContain("meera.iyer");
    const codes = await db!.select().from(schema.workEmailCodes).where(eq(schema.workEmailCodes.userId, me));
    expect(codes.every((c) => c.email === null && c.purpose === "current_job")).toBe(true);
    const data = await exportAccountData(me, db!, clock);
    expect(data!.jobEmailChecks).toMatchObject([{ employer: "Garuda Sec Pvt Ltd", startMonth: "2024-06", domain: "garudasec.com", status: "verified" }]);
    expect(JSON.stringify(data)).not.toContain("meera.iyer@");
  });

  it("refuses free mail and wrong codes, and locks after five wrong tries", async () => {
    const me = await person("refuse", profileAt("Garuda Sec"));
    expect(await startJobCheck(me, { workEmail: "meera@gmail.com" }, deps())).toMatchObject({ ok: false, error: expect.stringContaining("Personal addresses") });
    const sent = await startJobCheck(me, { workEmail: "meera@garudasec.com" }, deps());
    if (!sent.ok) throw new Error(sent.error);
    for (let i = 0; i < 4; i++) expect(await finishJobCheck(me, { workEmail: "meera@garudasec.com", code: "000000" }, deps())).toMatchObject({ ok: false, error: expect.stringContaining("isn't right") });
    expect(await finishJobCheck(me, { workEmail: "meera@garudasec.com", code: "000000" }, deps())).toMatchObject({ ok: false, error: expect.stringContaining("Too many") });
    expect(await finishJobCheck(me, { workEmail: "meera@garudasec.com", code: sent.testCode! }, deps())).toMatchObject({ ok: false });
    expect((await jobChecksFor([me], db!)).get(me)).toBeUndefined();
  });

  it("counts code sends: 3 an hour per person", async () => {
    const me = await person("limit", profileAt("Garuda Sec"));
    for (let i = 0; i < 3; i++) expect((await startJobCheck(me, { workEmail: `m${i}@garudasec.com` }, deps())).ok).toBe(true);
    expect(await startJobCheck(me, { workEmail: "m4@garudasec.com" }, deps())).toMatchObject({ ok: false, error: expect.stringContaining("a lot of codes") });
  });

  it("asks nothing of self-declared work or someone without a resume, and says checks open soon where no code can be sent", async () => {
    const free = await person("free", profileAt("Freelance"));
    expect(await startJobCheck(free, { workEmail: "meera@garudasec.com" }, deps())).toMatchObject({ ok: false, error: expect.stringContaining("Freelance") });
    expect((await labels(free))[0]).toEqual({ state: "self_declared", month: null });
    const none = await person("none", null);
    expect((await startJobCheck(none, { workEmail: "meera@garudasec.com" }, deps())).ok).toBe(false);
    const me = await person("off", profileAt("Garuda Sec"));
    expect(await startJobCheck(me, { workEmail: "meera@garudasec.com" }, deps({ delivery: "off" }))).toMatchObject({ ok: false, error: "Work-email checks open soon." });
    expect(await startJobCheck(me, { workEmail: "meera@garudasec.com" }, deps({ env: {} }))).toMatchObject({ ok: false, error: "Work-email checks open soon." });
  });

  it("sends another domain to an admin, who verifies or refuses it", async () => {
    const me = await person("review", profileAt("Garuda Sec"));
    expect(await verify(me, "meera@gs-group.in")).toEqual({ ok: true, status: "review" });
    expect((await labels(me))[0]).toEqual({ state: "review", month: null });
    const queued = (await jobChecksForReview(db!)).find((c) => c.domain === "gs-group.in" && c.employer === "Garuda Sec");
    expect(queued).toBeDefined();
    expect(Object.keys(queued!).sort()).toEqual(["checkedAt", "domain", "employer", "id"]);
    const admin = await person("admin", null);
    expect(await reviewJobCheck(admin, { id: queued!.id, decision: "refuse" }, { db: db!, now: clock })).toMatchObject({ ok: true });
    expect((await labels(me))[0]).toEqual({ state: "not_verified", month: null });
    expect(await reviewJobCheck(admin, { id: queued!.id, decision: "verify" }, { db: db!, now: clock })).toMatchObject({ ok: false });
    expect(await reviewJobCheck(admin, { id: "not-an-id", decision: "verify" }, { db: db!, now: clock })).toMatchObject({ ok: false });
    // Trying again puts it back on the list, and this time the admin verifies it.
    expect(await verify(me, "meera@gs-group.in")).toEqual({ ok: true, status: "review" });
    const again = (await jobChecksForReview(db!)).find((c) => c.domain === "gs-group.in" && c.employer === "Garuda Sec")!;
    expect(await reviewJobCheck(admin, { id: again.id, decision: "verify" }, { db: db!, now: clock })).toMatchObject({ ok: true });
    expect((await labels(me))[0]).toEqual({ state: "verified", month: "Oct 2026" });
    // One audit line per decision, ids only.
    const audit = await db!.select().from(schema.auditLogs).where(eq(schema.auditLogs.actor, `admin:${admin}`));
    expect(audit.map((a) => [a.action, a.target]).sort()).toEqual([
      ["job_email_check_refused", `job_email_check:${queued!.id}`],
      ["job_email_check_verified", `job_email_check:${again.id}`],
    ]);
    await db!.delete(schema.auditLogs).where(eq(schema.auditLogs.actor, `admin:${admin}`));
  });

  it("clears the badge when the company or start date changes, and keeps it as verified while there after an end date", async () => {
    const me = await person("change", profileAt("Garuda Sec"));
    await verify(me, "meera@garudasec.com");
    await newVersion(me, profileAt("Garuda Sec", "2024-06", "2026-09"));
    expect((await labels(me))[0]).toEqual({ state: "verified_while_there", month: "Oct 2026" });
    await newVersion(me, profileAt("Garuda Sec", "2025-01"));
    expect((await labels(me))[0]).toEqual({ state: "not_verified", month: null });
    await newVersion(me, profileAt("Konkan Bank Ltd"));
    expect((await labels(me))[0]).toEqual({ state: "not_verified", month: null });
  });
});
