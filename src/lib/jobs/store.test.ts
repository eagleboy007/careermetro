import { readFileSync } from "node:fs";
import { eq, inArray, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "@/db/schema";
import { roleProfiles, skills } from "@/content";
import { exportAccountData } from "@/lib/account/export";
import { buildGapAnalysis } from "@/lib/gaps/analysis";
import { matchProfile, MATCHER_VERSION } from "@/lib/gaps/match";
import type { Owner } from "@/lib/owner";
import type { JobCheckRequest, PostingSkills, Profile } from "@/lib/schemas";
import { createJobCheck, JOB_CHECK_LIMITS, jobChecksForPage, jobTextHash, listJobChecks } from "./store";
import type { ParseJdClient } from "./parse";

vi.mock("server-only", () => ({}));

// "Check against a job" against a real Postgres with migrations applied, like src/lib/goals/certificate.test.ts.
const url = process.env.TEST_DATABASE_URL;
const sqlClient = url ? postgres(url, { max: 4, onnotice: () => {} }) : null;
const db = sqlClient ? drizzle(sqlClient, { schema }) : null;

const fixture = JSON.parse(readFileSync("fixtures/job-postings/example-analytics-data-analyst.json", "utf8")) as {
  company: string;
  title: string;
  text: string;
  skills: PostingSkills["skills"];
};
const role = roleProfiles.find((r) => r.slug === "data-analyst")!;
const profile: Profile = {
  headline: "Data Analyst",
  totalYearsExperience: 3,
  roles: [{ title: "Data Analyst", employer: "Example Retail Pvt Ltd", start: "2022-06", end: null, highlights: ["Wrote SQL queries for weekly sales reports across 40 stores"] }],
  skills: [{ name: "SQL", lastUsed: null, evidence: ["Wrote SQL queries for weekly sales reports across 40 stores"] }],
  education: [],
  certifications: [],
};

function jdClient(skillsOut: PostingSkills["skills"] = fixture.skills) {
  const create = vi.fn().mockImplementation(async () => ({
    model: "claude-opus-5-5",
    stop_reason: "end_turn",
    usage: { input_tokens: 2000, output_tokens: 400 },
    content: [{ type: "text", text: JSON.stringify({ skills: skillsOut }) }],
  }));
  return { client: { beta: { messages: { create } } } as unknown as ParseJdClient, create };
}

describe.skipIf(!db)("job checks (database)", () => {
  const run = `jobs-${Date.now()}`;
  const resumeIds: string[] = [];
  const userIds: string[] = [];
  let n = 0;

  beforeAll(async () => {
    await db!
      .insert(schema.skills)
      .values(skills.map(({ id, name, category }) => ({ id, name, category })))
      .onConflictDoNothing();
  });
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.stubEnv("JOB_CHECK_DAILY_BUDGET_USD", "1000000");
  });
  afterAll(async () => {
    if (resumeIds.length) await db!.delete(schema.resumes).where(inArray(schema.resumes.id, resumeIds));
    if (userIds.length) await db!.delete(schema.users).where(inArray(schema.users.id, userIds));
    await sqlClient!.end();
  });

  /** A confirmed resume for an anonymous session, or for a new account with an open goal and a stored analysis. */
  async function seed({ account = false, confirmed = true } = {}) {
    let owner: Owner;
    let userId: string | null = null;
    if (account) {
      const [u] = await db!.insert(schema.users).values({ email: `${run}-${n++}@example.test` }).returning({ id: schema.users.id });
      userIds.push(u.id);
      userId = u.id;
      owner = { userId: u.id };
    } else owner = { sessionId: `${run}-${n++}` };
    const [resume] = await db!
      .insert(schema.resumes)
      .values({ userId, anonymousSessionId: owner.sessionId ?? null, mimeType: "text/plain", sizeBytes: 10, status: "parsed" })
      .returning();
    resumeIds.push(resume.id);
    const [p] = await db!.insert(schema.profiles).values({ resumeId: resume.id, version: 1, data: profile, confirmedByUser: confirmed }).returning();
    const analysis = buildGapAnalysis(matchProfile(profile, role), null);
    const [a] = await db!.insert(schema.gapAnalyses).values({ profileId: p.id, result: analysis, matcherVersion: MATCHER_VERSION }).returning();
    if (userId) await db!.insert(schema.userGoals).values({ userId, skillId: "statistics", position: 1, gapAnalysisId: a.id });
    return { owner, userId, resumeId: resume.id, analysis };
  }

  const request = (resumeId: string, over: Partial<JobCheckRequest> = {}): JobCheckRequest => ({
    resumeId,
    roleSlug: role.slug,
    company: fixture.company,
    title: fixture.title,
    text: fixture.text,
    ...over,
  });
  const checksOf = (resumeId: string) => db!.select().from(schema.jobChecks).where(eq(schema.jobChecks.resumeId, resumeId));

  it("saves the posting's skills, never its text, and changes no goal, analysis or ride", async () => {
    const me = await seed({ account: true });
    const snapshot = async () => ({
      goals: await db!.select().from(schema.userGoals).where(eq(schema.userGoals.userId, me.userId!)),
      analyses: await db!.select().from(schema.gapAnalyses).where(sql`${schema.gapAnalyses.profileId} in (select id from profiles where resume_id = ${me.resumeId})`),
      ride: await db!.select().from(schema.rideDays).where(eq(schema.rideDays.userId, me.userId!)),
      paths: await db!.select().from(schema.paths).where(sql`${schema.paths.gapAnalysisId} in (select g.id from gap_analyses g join profiles p on p.id = g.profile_id where p.resume_id = ${me.resumeId})`),
    });
    const before = await snapshot();
    const { client } = jdClient();
    const result = await createJobCheck(request(me.resumeId), me.owner, { db: db!, client });
    expect(result).toMatchObject({ ok: true, reused: false });
    expect(await snapshot()).toEqual(before);

    const [row] = await checksOf(me.resumeId);
    expect(row).toMatchObject({
      roleSlug: "data-analyst",
      company: "Example Analytics Pvt Ltd",
      title: "Data Analyst",
      requiredSkillIds: ["sql", "excel", "python", "statistics", "power-bi", "data-orchestration"],
      niceSkillIds: ["tableau", "git"],
      unknownSkills: ["Alteryx", "SAS"],
      textHash: jobTextHash(fixture.text),
    });
    expect(JSON.stringify(row)).not.toContain("category managers");
    const [call] = await db!.select().from(schema.aiCalls).where(eq(schema.aiCalls.id, row.aiCallId!));
    expect(call).toMatchObject({ purpose: "parse-jd", promptVersion: "parse-jd/v1", ok: true, status: "done", inputRefs: { resumeId: me.resumeId, roleSlug: "data-analyst" } });
    expect(JSON.stringify(call)).not.toContain("category managers");

    // The page sorts it into groups against the stored analysis.
    const [view] = await jobChecksForPage(me.resumeId, me.owner, role.slug, me.analysis, { db: db! });
    expect(view.covered.map((s) => s.skillId)).toEqual(["sql"]);
    expect(view.alsoGoals.map((s) => s.skillId)).toContain("statistics");
    expect(view.onlyThisJob.map((s) => s.skillId)).toContain("data-orchestration");
    expect(view.unknown).toEqual(["Alteryx", "SAS"]);
  });

  it("reads the same text once: a second send, even with other spacing, reuses the check", async () => {
    const me = await seed();
    const { client, create } = jdClient();
    const first = await createJobCheck(request(me.resumeId), me.owner, { db: db!, client });
    const again = await createJobCheck(request(me.resumeId, { text: `  ${fixture.text.replace(/\n/g, "\n\n")}  `, company: "Renamed" }), me.owner, { db: db!, client });
    expect(first.ok && again).toEqual({ ok: true, id: first.ok && first.id, reused: true });
    expect(create).toHaveBeenCalledTimes(1);
    expect(await checksOf(me.resumeId)).toHaveLength(1);
  });

  it(`allows ${JOB_CHECK_LIMITS.perOwnerPerDay} new checks a day, then saves nothing`, async () => {
    const me = await seed();
    const { client, create } = jdClient();
    for (let i = 0; i < JOB_CHECK_LIMITS.perOwnerPerDay; i++) {
      expect((await createJobCheck(request(me.resumeId, { text: `${fixture.text}\nRef ${i}` }), me.owner, { db: db!, client })).ok).toBe(true);
    }
    expect(await createJobCheck(request(me.resumeId, { text: `${fixture.text}\nRef late` }), me.owner, { db: db!, client })).toEqual({ ok: false, reason: "limit" });
    expect(create).toHaveBeenCalledTimes(JOB_CHECK_LIMITS.perOwnerPerDay);
    expect(await checksOf(me.resumeId)).toHaveLength(JOB_CHECK_LIMITS.perOwnerPerDay);
    // A posting already checked still opens: it costs nothing.
    expect(await createJobCheck(request(me.resumeId, { text: `${fixture.text}\nRef 0` }), me.owner, { db: db!, client })).toMatchObject({ ok: true, reused: true });
  });

  it("pauses when the day's budget is spent, and saves nothing", async () => {
    vi.stubEnv("JOB_CHECK_DAILY_BUDGET_USD", "0");
    const me = await seed();
    const { client, create } = jdClient();
    expect(await createJobCheck(request(me.resumeId), me.owner, { db: db!, client })).toEqual({ ok: false, reason: "budget" });
    expect(create).not.toHaveBeenCalled();
    expect(await checksOf(me.resumeId)).toHaveLength(0);
  });

  it("saves nothing when the posting names no skill we can check", async () => {
    const me = await seed();
    const { client } = jdClient([{ name: "Kubernetes", quote: "Deploy services on Kubernetes", level: "required" }]);
    expect(await createJobCheck(request(me.resumeId), me.owner, { db: db!, client })).toEqual({ ok: false, reason: "no_skills" });
    expect(await checksOf(me.resumeId)).toHaveLength(0);
  });

  it("is only for the owner's own confirmed resume", async () => {
    const me = await seed();
    const other = await seed();
    const { client, create } = jdClient();
    expect(await createJobCheck(request(me.resumeId), other.owner, { db: db!, client })).toEqual({ ok: false, reason: "not_found" });
    const draft = await seed({ confirmed: false });
    expect(await createJobCheck(request(draft.resumeId), draft.owner, { db: db!, client })).toEqual({ ok: false, reason: "not_confirmed" });
    expect(create).not.toHaveBeenCalled();

    await createJobCheck(request(me.resumeId), me.owner, { db: db!, client });
    expect(await listJobChecks(me.resumeId, other.owner, role.slug, db!)).toEqual([]);
    expect(await listJobChecks(me.resumeId, me.owner, role.slug, db!)).toHaveLength(1);
    expect(await listJobChecks(me.resumeId, me.owner, "business-analyst", db!)).toEqual([]);
  });

  it("goes with its resume, and with the account in its data download", async () => {
    const me = await seed({ account: true });
    const { client } = jdClient();
    await createJobCheck(request(me.resumeId), me.owner, { db: db!, client });
    const exported = await exportAccountData(me.userId!, db!);
    expect(exported?.jobChecks).toEqual([
      expect.objectContaining({ company: "Example Analytics Pvt Ltd", title: "Data Analyst", role: "data-analyst", requiredSkills: expect.arrayContaining(["sql"]), unknownSkills: ["Alteryx", "SAS"] }),
    ]);
    expect(JSON.stringify(exported)).not.toContain("category managers");

    await db!.delete(schema.resumes).where(eq(schema.resumes.id, me.resumeId));
    expect(await checksOf(me.resumeId)).toHaveLength(0);
  });

  it("counts an account's current accepted proof as covered", async () => {
    const me = await seed({ account: true });
    await createJobCheck(request(me.resumeId), me.owner, { db: db!, client: jdClient().client });
    await db!.insert(schema.gapProofs).values({
      userId: me.userId!,
      skillId: "data-orchestration",
      type: "skill_check",
      status: "accepted",
      evidence: { type: "skill_check", checkId: "airflow-basics" },
    });
    const [view] = await jobChecksForPage(me.resumeId, me.owner, role.slug, me.analysis, { db: db! });
    expect(view.covered).toContainEqual({ skillId: "data-orchestration", skillName: expect.any(String), by: "proof" });
    expect(view.onlyThisJob.map((s) => s.skillId)).not.toContain("data-orchestration");
  });
});
