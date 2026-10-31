import { readFileSync } from "node:fs";
import { eq, inArray, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "@/db/schema";
import { roleProfiles, skills } from "@/content";
import { exportAccountData } from "@/lib/account/export";
import { deleteExpiredAnonymousResumes } from "@/lib/resume/ingest";
import { buildGapAnalysis } from "@/lib/gaps/analysis";
import { matchProfile, MATCHER_VERSION } from "@/lib/gaps/match";
import type { Owner } from "@/lib/owner";
import type { JobCheckRequest, PostingSkills, Profile } from "@/lib/schemas";
import { addProof, removeChoiceGoal, setProofStatus, syncGoals } from "@/lib/goals/store";
import { todayStateFor } from "@/lib/today/state";
import { mapLineFor } from "@/lib/map/store";
import { rideGoalsFor } from "@/lib/ride/store";
import { mapLine, MAX_CHOICE_GOALS } from "@/lib/schemas";
import { addJobCheckGoal, createJobCheck, deleteJobCheck, goalSkillsOf, JOB_CHECK_LIMITS, jobChecksForPage, jobTextHash, listJobChecks, listStandInChecks, ownJobCheck, standInForPage } from "./store";
import type { ParseJdClient } from "./parse";
import { SAMPLE_MIME } from "@/lib/resume/sample-mime";
import { LIMITS } from "@/lib/shared-limit";

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
    content: [{ type: "text", text: JSON.stringify({ company: null, title: null, city: null, skills: skillsOut }) }],
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
  async function seed({ account = false, confirmed = true, sample = false } = {}) {
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
      .values({ userId, anonymousSessionId: owner.sessionId ?? null, mimeType: sample ? SAMPLE_MIME : "text/plain", sizeBytes: 10, status: "parsed" })
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
    expect(call).toMatchObject({ purpose: "parse-jd", promptVersion: "parse-jd/v2", ok: true, status: "done", inputRefs: { resumeId: me.resumeId, roleSlug: "data-analyst" } });
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

  it(`allows ${LIMITS.sampleJobChecksPerIp.max} new checks of the sample resume a day per address, across sessions (T113)`, async () => {
    const address = `${run}-address`;
    const { client, create } = jdClient();
    // Each try from a fresh anonymous session, as a script would: the per-owner count never fills.
    for (let i = 0; i < LIMITS.sampleJobChecksPerIp.max; i++) {
      const anon = await seed({ sample: true });
      expect(await createJobCheck(request(anon.resumeId), anon.owner, { db: db!, client, clientHash: address })).toMatchObject({ ok: true, reused: false });
    }
    const late = await seed({ sample: true });
    expect(await createJobCheck(request(late.resumeId), late.owner, { db: db!, client, clientHash: address })).toEqual({ ok: false, reason: "sample_limit" });
    expect(create).toHaveBeenCalledTimes(LIMITS.sampleJobChecksPerIp.max);
    expect(await checksOf(late.resumeId)).toHaveLength(0);
    // Another address still can, and a person's own resume never counts against the address.
    expect((await createJobCheck(request(late.resumeId), late.owner, { db: db!, client, clientHash: `${address}-other` })).ok).toBe(true);
    const own = await seed();
    expect((await createJobCheck(request(own.resumeId), own.owner, { db: db!, client, clientHash: address })).ok).toBe(true);
  });

  it("refuses the sample once the owner's own resume has gaps, before any reservation or model call (T117)", async () => {
    const me = await seed({ account: true });
    const [sample] = await db!
      .insert(schema.resumes)
      .values({ userId: me.userId, anonymousSessionId: null, mimeType: SAMPLE_MIME, sizeBytes: 10, status: "parsed" })
      .returning();
    resumeIds.push(sample.id);
    await db!.insert(schema.profiles).values({ resumeId: sample.id, version: 1, data: profile, confirmedByUser: true });
    const { client, create } = jdClient();
    const address = `${run}-t117`;
    expect(await createJobCheck(request(sample.id), me.owner, { db: db!, client, clientHash: address })).toEqual({ ok: false, reason: "not_found" });
    expect(create).not.toHaveBeenCalled();
    expect(await checksOf(sample.id)).toHaveLength(0);
    // No reservation was made for it.
    expect(await db!.select().from(schema.aiCalls).where(sql`${schema.aiCalls.inputRefs}->>'resumeId' = ${sample.id}`)).toHaveLength(0);
    // The owner's own resume still checks, and so does a sample whose owner has no gaps of their own yet.
    expect((await createJobCheck(request(me.resumeId), me.owner, { db: db!, client, clientHash: address })).ok).toBe(true);
    const anon = await seed({ sample: true });
    expect((await createJobCheck(request(anon.resumeId), anon.owner, { db: db!, client, clientHash: address })).ok).toBe(true);
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

  describe("Add as my goal (part 2)", () => {
    /** An account with a saved check of the fixture posting. */
    async function withCheck() {
      const me = await seed({ account: true });
      const made = await createJobCheck(request(me.resumeId), me.owner, { db: db!, client: jdClient().client });
      if (!made.ok) throw new Error(made.reason);
      const own = await ownJobCheck(made.id, me.owner, { db: db! });
      return { ...me, userId: me.userId!, checkId: made.id, view: own!.view };
    }
    const goalsOfUser = (userId: string) => db!.select().from(schema.userGoals).where(eq(schema.userGoals.userId, userId)).orderBy(schema.userGoals.position);
    const analysesOf = (resumeId: string) =>
      db!.select().from(schema.gapAnalyses).where(sql`${schema.gapAnalyses.profileId} in (select id from profiles where resume_id = ${resumeId})`);

    it("sorts the check as the Gaps page does, for its owner only", async () => {
      const me = await withCheck();
      const [page] = await jobChecksForPage(me.resumeId, me.owner, role.slug, me.analysis, { db: db! });
      expect(me.view).toEqual(page);
      expect(me.view.onlyThisJob.map((s) => s.skillId)).toContain("data-orchestration");
      const other = await seed({ account: true });
      expect(await ownJobCheck(me.checkId, other.owner, { db: db! })).toBeNull();
      expect(await ownJobCheck("not-a-uuid", me.owner, { db: db! })).toBeNull();
    });

    it("adds an Only for this job skill as a Your choice goal after the last goal, and changes no analysis", async () => {
      const me = await withCheck();
      const before = await analysesOf(me.resumeId);
      const result = await addJobCheckGoal(me.checkId, "data-orchestration", me.userId, { db: db! });
      expect(result).toMatchObject({ ok: true });
      const goals = await goalsOfUser(me.userId);
      expect(goals.map((g) => [g.skillId, g.source, g.status, g.position, g.jobCheckId, g.gapAnalysisId])).toEqual([
        ["statistics", "gap", "active", 1, null, expect.any(String)],
        ["data-orchestration", "user", "active", 2, me.checkId, null],
      ]);
      expect(await analysesOf(me.resumeId)).toEqual(before);
      const mine = goals.find((g) => g.source === "user")!;
      expect(await goalSkillsOf(me.userId, db!)).toEqual({ skills: ["statistics", "data-orchestration"], chosen: { "data-orchestration": mine.id } });
      // The download names the goal's job check and company.
      const exported = await exportAccountData(me.userId, db!);
      expect(exported?.goals).toContainEqual(expect.objectContaining({ skill: "data-orchestration", source: "user", jobCheckId: me.checkId, jobCompany: fixture.company }));
      expect(exported?.goals).toContainEqual(expect.objectContaining({ skill: "statistics", jobCheckId: null, jobCompany: null }));
      expect(exported?.jobChecks).toContainEqual(expect.objectContaining({ id: me.checkId }));
    });

    it("refuses a skill that isn't Only for this job, someone else's check, a duplicate and the 21st choice", async () => {
      const me = await withCheck();
      // Covered (on the resume) and a goal of the role this job also asks for: neither is Only for this job.
      expect(await addJobCheckGoal(me.checkId, "sql", me.userId, { db: db! })).toEqual({ ok: false, reason: "not_this_job" });
      expect(await addJobCheckGoal(me.checkId, "statistics", me.userId, { db: db! })).toEqual({ ok: false, reason: "not_this_job" });
      expect(await addJobCheckGoal(me.checkId, "kubernetes", me.userId, { db: db! })).toEqual({ ok: false, reason: "not_this_job" });
      const other = await seed({ account: true });
      expect(await addJobCheckGoal(me.checkId, "data-orchestration", other.userId!, { db: db! })).toEqual({ ok: false, reason: "not_found" });
      expect(await goalsOfUser(other.userId!)).toHaveLength(1);

      expect((await addJobCheckGoal(me.checkId, "data-orchestration", me.userId, { db: db! })).ok).toBe(true);
      expect(await addJobCheckGoal(me.checkId, "data-orchestration", me.userId, { db: db! })).toEqual({ ok: false, reason: "already" });

      const fresh = await withCheck();
      const fillers = skills.map((s) => s.id).filter((id) => id !== "statistics" && !fresh.view.onlyThisJob.some((o) => o.skillId === id)).slice(0, MAX_CHOICE_GOALS);
      const filled = await db!
        .insert(schema.userGoals)
        .values(fillers.map((skillId, i) => ({ userId: fresh.userId, skillId, source: "user" as const, position: 10 + i })))
        .returning({ id: schema.userGoals.id });
      expect(await addJobCheckGoal(fresh.checkId, "data-orchestration", fresh.userId, { db: db! })).toEqual({ ok: false, reason: "limit" });
      expect(await goalsOfUser(fresh.userId)).toHaveLength(MAX_CHOICE_GOALS + 1);
      // A removed (skipped) Your choice goal no longer counts toward the 20.
      expect(await removeChoiceGoal(fresh.userId, filled[0].id, db!)).toBe(true);
      expect(await addJobCheckGoal(fresh.checkId, "data-orchestration", fresh.userId, { db: db! })).toMatchObject({ ok: true });
    });

    it("Remove from my goals skips only the person's own Your choice goal, and adding it again brings it back", async () => {
      const me = await withCheck();
      const added = await addJobCheckGoal(me.checkId, "data-orchestration", me.userId, { db: db! });
      if (!added.ok) throw new Error(added.reason);
      const gapGoal = (await goalsOfUser(me.userId)).find((g) => g.source === "gap")!;
      const other = await seed({ account: true });
      // Never a gap goal, never someone else's goal, never a made-up id.
      expect(await removeChoiceGoal(me.userId, gapGoal.id, db!)).toBe(false);
      expect(await removeChoiceGoal(other.userId!, added.goalId, db!)).toBe(false);
      expect(await removeChoiceGoal(me.userId, "nope", db!)).toBe(false);
      expect((await goalsOfUser(me.userId)).map((g) => g.status)).toEqual(["active", "active"]);

      expect(await removeChoiceGoal(me.userId, added.goalId, db!)).toBe(true);
      expect(await removeChoiceGoal(me.userId, added.goalId, db!)).toBe(false);
      expect((await goalsOfUser(me.userId)).find((g) => g.id === added.goalId)).toMatchObject({ status: "skipped", source: "user", skippedAt: expect.any(Date) });
      expect(await goalSkillsOf(me.userId, db!)).toEqual({ skills: ["statistics"], chosen: {} });
      expect((await rideGoalsFor(me.userId, db!))!.chosen).toEqual([]);
      expect((await mapLineFor(me.userId, db!))!.choiceGoals).toEqual([]);

      // Added again: the same goal, active, at the end.
      const again = await addJobCheckGoal(me.checkId, "data-orchestration", me.userId, { db: db! });
      expect(again).toEqual({ ok: true, goalId: added.goalId });
      const back = (await goalsOfUser(me.userId)).find((g) => g.id === added.goalId)!;
      expect(back).toMatchObject({ status: "active", skippedAt: null, jobCheckId: me.checkId });
      expect(back.position).toBe(Math.max(...(await goalsOfUser(me.userId)).map((g) => g.position)));
    });

    it("an open Your choice goal never holds back the train: every gap proved still arrives and stays returning", async () => {
      const me = await withCheck();
      await addJobCheckGoal(me.checkId, "data-orchestration", me.userId, { db: db! });
      const now = new Date();
      for (const gap of me.analysis.gaps) {
        const id = await addProof(me.userId, gap.skillId, { type: "skill_check", checkId: `walk-${gap.skillId}` }, db!);
        await setProofStatus(id!, me.userId, "accepted", "app", db!);
      }
      const state = await todayStateFor(me.userId, now, db!);
      expect(state.state).toBe("returning");
      if (state.state !== "returning") return;
      expect(state.ride.pitstop).toBe(state.ride.pitstopCount + 1);
      expect(state.ride.pitstopCount).toBe(me.analysis.gaps.length * 2);
      expect(state.goals.goals).toEqual([]);
      expect(state.goals.choiceGoals).toEqual([expect.objectContaining({ name: skills.find((s) => s.id === "data-orchestration")!.name, status: "missing", choice: { company: fixture.company } })]);
    });

    it("keeps Your choice goals through syncing, shows them apart from the line on the ride and the map, and lets proof fill them", async () => {
      const me = await withCheck();
      await addJobCheckGoal(me.checkId, "data-orchestration", me.userId, { db: db! });
      const analysis = (await analysesOf(me.resumeId))[0];
      await syncGoals(me.userId, { id: analysis.id, result: me.analysis }, db!);
      const synced = await goalsOfUser(me.userId);
      const mine = synced.find((g) => g.skillId === "data-orchestration")!;
      expect(mine).toMatchObject({ source: "user", status: "active", position: 2, jobCheckId: me.checkId });
      // Every gap of the analysis is a goal; the Your choice goal isn't one of them.
      expect(synced.filter((g) => g.source === "gap").map((g) => g.skillId).sort()).toEqual(me.analysis.gaps.map((g) => g.skillId).sort());
      expect(await analysesOf(me.resumeId)).toEqual([analysis]);

      // The ride and the line hold the gap goals only; the Your choice goal is apart from them.
      const ride = await rideGoalsFor(me.userId, db!);
      const gapCount = me.analysis.gaps.length;
      expect(ride!.goals).toHaveLength(gapCount);
      expect(ride!.goals.every((g) => !g.choice)).toBe(true);
      expect(ride!.chosen).toEqual([expect.objectContaining({ skillId: "data-orchestration", status: "missing", proved: false, choice: { company: fixture.company } })]);
      expect(ride!.result).toEqual(me.analysis);

      const line = await mapLineFor(me.userId, db!);
      expect(mapLine.safeParse(line).success).toBe(true);
      expect(line!.goals).toHaveLength(gapCount);
      expect(line!.choiceGoals).toEqual([
        expect.objectContaining({ skillId: "data-orchestration", name: skills.find((s) => s.id === "data-orchestration")!.name, status: "missing", goalId: mine.id, choice: { company: fixture.company } }),
      ]);
      expect(line!.otherLines.every((o) => o.skillId !== "data-orchestration")).toBe(true);

      // Proof fills it exactly like a gap goal.
      const proofId = await addProof(me.userId, "data-orchestration", { type: "skill_check", checkId: "airflow-basics" }, db!);
      expect(await setProofStatus(proofId!, me.userId, "accepted", "app", db!)).toBe(true);
      expect((await goalsOfUser(me.userId)).find((g) => g.skillId === "data-orchestration")).toMatchObject({ status: "met", source: "user" });
      expect((await mapLineFor(me.userId, db!))!.choiceGoals![0]).toMatchObject({ skillId: "data-orchestration", proved: true });
      expect((await rideGoalsFor(me.userId, db!))!.chosen[0]).toMatchObject({ proved: true });
      expect(await analysesOf(me.resumeId)).toEqual([analysis]);
    });

    it("removing the check keeps the goal and drops the tag; only the owner can remove it", async () => {
      const me = await withCheck();
      await addJobCheckGoal(me.checkId, "data-orchestration", me.userId, { db: db! });
      const other = await seed({ account: true });
      expect(await deleteJobCheck(me.checkId, other.owner, db!)).toBe(false);
      expect(await deleteJobCheck("nope", me.owner, db!)).toBe(false);
      expect(await deleteJobCheck(me.checkId, me.owner, db!)).toBe(true);
      expect(await checksOf(me.resumeId)).toHaveLength(0);
      expect((await goalsOfUser(me.userId)).find((g) => g.skillId === "data-orchestration")).toMatchObject({ source: "user", status: "active", jobCheckId: null });
      const ride = await rideGoalsFor(me.userId, db!);
      expect(ride!.chosen).toEqual([expect.objectContaining({ skillId: "data-orchestration", choice: { company: null } })]);
      // An anonymous owner removes their own check too.
      const anon = await seed();
      const made = await createJobCheck(request(anon.resumeId), anon.owner, { db: db!, client: jdClient().client });
      expect(made.ok && (await deleteJobCheck(made.id, anon.owner, db!))).toBe(true);
    });
  });

  describe("standing in for a role we don't have", () => {
    const standIn = JSON.parse(readFileSync("fixtures/job-postings/example-freight-fleet-planning-analyst.json", "utf8")) as typeof fixture;
    const standInRequest = (resumeId: string): JobCheckRequest => ({ resumeId, roleSlug: null, company: standIn.company, title: standIn.title, text: standIn.text });

    it("saves with no role, shows the posting's skills as gaps, and makes no goal, analysis, path or ride", async () => {
      const me = await seed({ account: true });
      const snapshot = async () => ({
        goals: await db!.select().from(schema.userGoals).where(eq(schema.userGoals.userId, me.userId!)),
        analyses: await db!.select().from(schema.gapAnalyses).where(sql`${schema.gapAnalyses.profileId} in (select id from profiles where resume_id = ${me.resumeId})`),
        ride: await db!.select().from(schema.rideDays).where(eq(schema.rideDays.userId, me.userId!)),
        paths: await db!.select().from(schema.paths).where(sql`${schema.paths.gapAnalysisId} in (select g.id from gap_analyses g join profiles p on p.id = g.profile_id where p.resume_id = ${me.resumeId})`),
      });
      const before = await snapshot();
      const result = await createJobCheck(standInRequest(me.resumeId), me.owner, { db: db!, client: jdClient(standIn.skills).client });
      expect(result).toMatchObject({ ok: true, reused: false });
      expect(await snapshot()).toEqual(before);

      const [row] = await checksOf(me.resumeId);
      expect(row).toMatchObject({ roleSlug: null, title: "Fleet Planning Analyst", unknownSkills: ["Fleet scheduling", "Toll reconciliation"] });
      const [call] = await db!.select().from(schema.aiCalls).where(eq(schema.aiCalls.id, row.aiCallId!));
      expect(call.inputRefs).toEqual({ resumeId: me.resumeId });

      const view = await standInForPage(me.resumeId, row.id, me.owner, { db: db! });
      expect(view).not.toBeNull();
      expect(view!.gaps.map((g) => g.skillId)).toEqual(["excel", "data-cleaning", "statistics", "power-bi"]);
      expect(view!.met.map((m) => m.skillId)).toEqual(["sql"]);
      expect(view!.readiness.headline).toBe("You cover 1 of the 5 skills this job asks for.");

      // A stand-in check isn't one of the role's job checks, and a role's check isn't a stand-in.
      expect(await listJobChecks(me.resumeId, me.owner, role.slug, db!)).toEqual([]);
      expect(await listStandInChecks(me.resumeId, me.owner, db!)).toEqual([{ id: row.id, company: standIn.company, title: standIn.title, createdAt: row.createdAt }]);

      // It makes no goals: "Add as my goal" and the job plan belong to checks against a library role.
      expect(await ownJobCheck(row.id, me.owner, { db: db! })).toBeNull();
      expect(await addJobCheckGoal(row.id, "statistics", me.userId!, { db: db! })).toEqual({ ok: false, reason: "not_found" });
      expect(await snapshot()).toEqual(before);
    });

    it("reuses the same posting as a stand-in, and checks it apart against a library role", async () => {
      const me = await seed();
      const { client, create } = jdClient(standIn.skills);
      const first = await createJobCheck(standInRequest(me.resumeId), me.owner, { db: db!, client });
      expect(await createJobCheck(standInRequest(me.resumeId), me.owner, { db: db!, client })).toEqual({ ok: true, id: first.ok && first.id, reused: true });
      expect(await createJobCheck({ ...standInRequest(me.resumeId), roleSlug: role.slug }, me.owner, { db: db!, client })).toMatchObject({ ok: true, reused: false });
      expect(create).toHaveBeenCalledTimes(2);
      expect(await listStandInChecks(me.resumeId, me.owner, db!)).toHaveLength(1);
    });

    it("is only for its owner, its resume, and checks that stand in", async () => {
      const me = await seed();
      const other = await seed();
      const { client } = jdClient(standIn.skills);
      const own = await createJobCheck(standInRequest(me.resumeId), me.owner, { db: db!, client });
      const forRole = await createJobCheck(request(me.resumeId), me.owner, { db: db!, client: jdClient().client });
      if (!own.ok || !forRole.ok) throw new Error("not saved");
      expect(await standInForPage(me.resumeId, own.id, other.owner, { db: db! })).toBeNull();
      expect(await standInForPage(other.resumeId, own.id, other.owner, { db: db! })).toBeNull();
      expect(await standInForPage(me.resumeId, forRole.id, me.owner, { db: db! })).toBeNull();
      expect(await standInForPage(me.resumeId, "not-a-uuid", me.owner, { db: db! })).toBeNull();
      expect(await listStandInChecks(me.resumeId, other.owner, db!)).toEqual([]);
    });

    it("goes with an anonymous resume after 24 hours", async () => {
      const me = await seed();
      const saved = await createJobCheck(standInRequest(me.resumeId), me.owner, { db: db!, client: jdClient(standIn.skills).client });
      if (!saved.ok) throw new Error("not saved");
      await db!.update(schema.resumes).set({ createdAt: new Date(Date.now() - 25 * 3600_000) }).where(eq(schema.resumes.id, me.resumeId));
      // Hidden at once, before the daily cleanup deletes it with its resume.
      expect(await standInForPage(me.resumeId, saved.id, me.owner, { db: db! })).toBeNull();
      expect(await listStandInChecks(me.resumeId, me.owner, db!)).toEqual([]);
      await deleteExpiredAnonymousResumes(db!);
      expect(await checksOf(me.resumeId)).toHaveLength(0);
    });
  });
});
