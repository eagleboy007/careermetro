import { readFileSync } from "node:fs";
import { eq, inArray, like } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "@/db/schema";
import { roleProfiles, skills } from "@/content";
import { EXPORT_VERSION, exportAccountData } from "@/lib/account/export";
import { setStage } from "@/lib/departures/store";
import { buildGapAnalysis } from "@/lib/gaps/analysis";
import { matchProfile, MATCHER_VERSION } from "@/lib/gaps/match";
import type { ParseJdClient } from "@/lib/jobs/parse";
import { myJobExport, nextInterviewView, type PostingSkills, type Profile } from "@/lib/schemas";
import { USER_AGENT as FEED_USER_AGENT } from "@/lib/departures/feed-rules.mjs";
import { boardApiUrl, htmlText, postingOf, readBoardPosting, USER_AGENT } from "./board-read";
import { addJob, clearUnsavedJobText, deleteJob, exportMyJobs, jobDescription, jobLabel, jobPrep, myJobs, nextInterview, saveJob, setJobStatus, updateJob } from "./store";

vi.mock("server-only", () => ({}));

describe("reading one posting from a company job board", () => {
  it("sends the feed's User-Agent", () => {
    expect(USER_AGENT).toBe(FEED_USER_AGENT);
  });

  it("asks each board's public API for the one posting", () => {
    expect(boardApiUrl({ ats: "greenhouse", token: "acme", id: "123" })).toBe("https://boards-api.greenhouse.io/v1/boards/acme/jobs/123");
    expect(boardApiUrl({ ats: "lever", token: "acme", id: "0b8f8a52-6a1e-4b7f-9d6a-2f1d3c4b5a69" })).toBe("https://api.lever.co/v0/postings/acme/0b8f8a52-6a1e-4b7f-9d6a-2f1d3c4b5a69");
    expect(boardApiUrl({ ats: "ashby", token: "orbit", id: "x" })).toBe("https://api.ashbyhq.com/posting-api/job-board/orbit");
    expect(boardApiUrl({ ats: "smartrecruiters", token: "NECSWS", id: "744" })).toBe("https://api.smartrecruiters.com/v1/companies/NECSWS/postings/744");
  });

  it("keeps the title, company, place and text, and drops scripts and tags", () => {
    expect(htmlText("&lt;p&gt;Write &lt;b&gt;SQL&lt;/b&gt;&lt;/p&gt;&lt;script&gt;alert(1)&lt;/script&gt;&lt;li&gt;Excel&lt;/li&gt;")).toBe("Write SQL\nExcel");
    const gh = postingOf({ ats: "greenhouse", token: "acme", id: "1" }, { title: "Data Analyst", company_name: "Acme", location: { name: "Pune, India" }, content: "&lt;p&gt;SQL&lt;/p&gt;" });
    expect(gh).toEqual({ title: "Data Analyst", company: "Acme", city: "Pune", text: "Data Analyst\n\nSQL" });
    const sr = postingOf(
      { ats: "smartrecruiters", token: "Acme", id: "1" },
      { name: "SOC Analyst", company: { name: "Acme" }, location: { city: "Mumbai" }, creator: { name: "A Recruiter" }, jobAd: { sections: { jobDescription: { title: "Duties", text: "<p>SIEM</p>" } } } },
    );
    expect(sr).toEqual({ title: "SOC Analyst", company: "Acme", city: "Mumbai", text: "SOC Analyst\n\nDuties\nSIEM" });
    expect(JSON.stringify(sr)).not.toContain("Recruiter");
    const ashby = { jobs: [{ id: "6C1D2E3F-4A5B-4C6D-8E7F-9A0B1C2D3E4F", title: "SRE", location: "Remote", isRemote: true, descriptionPlain: "Kubernetes" }] };
    expect(postingOf({ ats: "ashby", token: "o", id: "6c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f" }, ashby)).toMatchObject({ title: "SRE", city: "Remote", text: "SRE\n\nKubernetes" });
    expect(postingOf({ ats: "ashby", token: "o", id: "00000000-0000-4000-8000-000000000000" }, ashby)).toBeNull();
    expect(postingOf({ ats: "lever", token: "o", id: "1" }, { nope: true })).toBeNull();
  });

  it("follows no redirect, and fails with a short code only", async () => {
    const link = { ats: "lever", token: "acme", id: "0b8f8a52-6a1e-4b7f-9d6a-2f1d3c4b5a69" } as const;
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ text: "Data Analyst", descriptionPlain: "SQL" }), { status: 200 }));
    expect(await readBoardPosting(link, { fetchImpl: fetchImpl as unknown as typeof fetch })).toMatchObject({ ok: true, posting: { title: "Data Analyst" } });
    expect(fetchImpl).toHaveBeenCalledWith(boardApiUrl(link), expect.objectContaining({ redirect: "error", headers: expect.objectContaining({ "user-agent": USER_AGENT }) }));
    const missing = vi.fn(async () => new Response("gone", { status: 404 }));
    expect(await readBoardPosting(link, { fetchImpl: missing as unknown as typeof fetch })).toEqual({ ok: false, error: "not_found" });
    const broken = vi.fn(async () => {
      throw new Error("secret text from the board");
    });
    expect(await readBoardPosting(link, { fetchImpl: broken as unknown as typeof fetch })).toEqual({ ok: false, error: "unreadable" });
    const huge = vi.fn(async () => new Response("x".repeat(1024 * 1024 + 1), { status: 200 }));
    expect(await readBoardPosting(link, { fetchImpl: huge as unknown as typeof fetch })).toEqual({ ok: false, error: "unreadable" });
  });
});

// My jobs against a real Postgres with migrations applied. Every person and company here is made up.
const url = process.env.TEST_DATABASE_URL;
const sqlClient = url ? postgres(url, { max: 4, onnotice: () => {} }) : null;
const db = sqlClient ? drizzle(sqlClient, { schema }) : null;

const fixture = JSON.parse(readFileSync("fixtures/job-postings/example-analytics-data-analyst.json", "utf8")) as {
  company: string;
  title: string;
  city: string;
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

function jdClient(labels: { company: string | null; title: string | null; city: string | null } = { company: fixture.company, title: fixture.title, city: fixture.city }) {
  const create = vi.fn().mockImplementation(async () => ({
    model: "claude-opus-5-5",
    stop_reason: "end_turn",
    usage: { input_tokens: 2000, output_tokens: 400 },
    content: [{ type: "text", text: JSON.stringify({ ...labels, skills: fixture.skills }) }],
  }));
  return { client: { beta: { messages: { create } } } as unknown as ParseJdClient, create };
}

describe.skipIf(!db)("my jobs (database)", () => {
  const run = `myjobs${Date.now()}`;
  const userIds: string[] = [];
  const lines: string[] = [];
  let n = 0;
  const now = new Date("2026-10-28T06:30:00Z");

  beforeAll(async () => {
    await db!
      .insert(schema.skills)
      .values(skills.map(({ id, name, category }) => ({ id, name, category })))
      .onConflictDoNothing();
  });
  beforeEach(() => {
    vi.stubEnv("JOB_CHECK_DAILY_BUDGET_USD", "1000000");
    for (const level of ["log", "warn", "error"] as const) vi.spyOn(console, level).mockImplementation((line: unknown) => void lines.push(String(line)));
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });
  afterAll(async () => {
    if (userIds.length) await db!.delete(schema.resumes).where(inArray(schema.resumes.userId, userIds));
    if (userIds.length) await db!.delete(schema.users).where(inArray(schema.users.id, userIds));
    await db!.delete(schema.jobPosts).where(like(schema.jobPosts.boardToken, `${run}%`));
    await sqlClient!.end();
    // Nothing a person wrote or pasted ever reaches a log line.
    const all = lines.join("\n");
    for (const words of ["category managers", "careers.example.com", "Round 1 is a SQL test"]) expect(all).not.toContain(words);
  });

  /** A person with a confirmed resume and its stored analysis for the Data Analyst role. */
  async function person(p: Profile = profile) {
    const [u] = await db!.insert(schema.users).values({ email: `${run}-${n++}@example.test` }).returning({ id: schema.users.id });
    userIds.push(u.id);
    const resumeId = await resumeFor(u.id, p);
    return { userId: u.id, resumeId };
  }
  async function resumeFor(userId: string, p: Profile) {
    const [resume] = await db!.insert(schema.resumes).values({ userId, mimeType: "text/plain", sizeBytes: 10, status: "parsed" }).returning();
    const [prof] = await db!.insert(schema.profiles).values({ resumeId: resume.id, version: 1, data: p, confirmedByUser: true }).returning();
    await db!.insert(schema.gapAnalyses).values({ profileId: prof.id, result: buildGapAnalysis(matchProfile(p, role), null), matcherVersion: MATCHER_VERSION });
    return resume.id;
  }
  const post = async (over: Partial<typeof schema.jobPosts.$inferInsert> = {}) => {
    const [p] = await db!
      .insert(schema.jobPosts)
      .values({ ats: "lever", boardToken: run, externalId: `${run}-${n++}`, url: "https://jobs.lever.co/example/1", title: "Junior data analyst", company: "Example Labs", city: "Pune", requiredSkillIds: ["sql"], ...over })
      .returning({ id: schema.jobPosts.id });
    return p.id;
  };
  const rowOf = async (userId: string) => db!.select().from(schema.jobSaves).where(eq(schema.jobSaves.userId, userId));
  const add = (me: { userId: string; resumeId: string }, body: Record<string, unknown> = {}, client = jdClient().client) =>
    addJob(me.userId, { resumeId: me.resumeId, text: fixture.text, url: "https://careers.example.com/data-analyst", ...body }, { db: db!, client, now });

  it("checks a pasted job and keeps its link and description, but it joins My jobs only once saved", async () => {
    const me = await person();
    const added = await add(me);
    expect(added).toMatchObject({ ok: true, kind: "check", job: { company: fixture.company, title: fixture.title, city: "Pune", source: "you", url: "https://careers.example.com/data-analyst" } });
    if (!added.ok || added.kind !== "check") throw new Error("not added");
    expect(added.job.fit).toMatchObject({ have: 1 });
    const [check] = await db!.select().from(schema.jobChecks).where(eq(schema.jobChecks.id, added.job.checkId));
    expect(check).toMatchObject({ source: "pasted", url: "https://careers.example.com/data-analyst", city: "Pune", roleSlug: "data-analyst" });
    expect(check.description).toContain("category managers");
    expect(await rowOf(me.userId)).toEqual([]);
    expect(await myJobs(me.userId, { db: db! })).toEqual([]);

    expect(await saveJob(me.userId, { checkId: added.job.checkId, company: "Example Analytics", title: "Data analyst (retail)", city: "" }, { db: db!, now })).toEqual({ ok: true });
    const [view] = await myJobs(me.userId, { db: db!, now });
    expect(view).toMatchObject({ key: `check:${added.job.checkId}`, company: "Example Analytics", title: "Data analyst (retail)", city: null, status: "saved", source: "you", hasDescription: true });
    expect(view.fit?.only.length).toBeGreaterThan(0);
    expect(await jobDescription(me.userId, added.job.checkId, db!)).toContain("category managers");
  });

  it("names the company and title for the person to fix when the description prints neither", async () => {
    const me = await person();
    const added = await add(me, {}, jdClient({ company: "Not In The Text Ltd", title: null, city: null }).client);
    expect(added).toMatchObject({ ok: true, job: { company: "Company not named", title: "Job you added", city: null } });
  });

  it("saves a board link the feed already has as that feed job, with no second copy and no model call", async () => {
    const me = await person();
    const externalId = "0b8f8a52-6a1e-4b7f-9d6a-2f1d3c4b5a69";
    const p = await post({ ats: "lever", boardToken: `${run}Board`, externalId });
    const { client, create } = jdClient();
    const added = await addJob(me.userId, { resumeId: me.resumeId, url: `https://jobs.lever.co/${run}board/${externalId}` }, { db: db!, client, now });
    expect(added).toEqual({ ok: true, kind: "post", postId: p });
    expect(create).not.toHaveBeenCalled();
    expect(await rowOf(me.userId)).toMatchObject([{ jobPostId: p, jobCheckId: null }]);
    expect(await db!.select().from(schema.jobChecks).where(eq(schema.jobChecks.resumeId, me.resumeId))).toEqual([]);
  });

  it("reads a board link the feed doesn't have from the board, keeping its text, and refuses when it can't", async () => {
    const me = await person();
    const link = "https://job-boards.greenhouse.io/exampleboard/jobs/42";
    const readBoard = vi.fn(async () => ({ ok: true as const, posting: { title: "Data Analyst", company: "Board Co", city: "Mumbai", text: fixture.text } }));
    const added = await addJob(me.userId, { resumeId: me.resumeId, url: link }, { db: db!, client: jdClient().client, now, readBoard });
    expect(readBoard).toHaveBeenCalledWith({ ats: "greenhouse", token: "exampleboard", id: "42" });
    expect(added).toMatchObject({ ok: true, kind: "check", job: { company: "Board Co", title: "Data Analyst", city: "Mumbai", source: "board", url: link } });
    const gone = vi.fn(async () => ({ ok: false as const, error: "not_found" as const }));
    expect(await addJob(me.userId, { resumeId: me.resumeId, url: "https://job-boards.greenhouse.io/exampleboard/jobs/43" }, { db: db!, now, readBoard: gone })).toEqual({ ok: false, reason: "board_not_found" });
  });

  it("refuses a resume that isn't the current analysis's, and any other link alone", async () => {
    const me = await person();
    const other = await person();
    expect(await addJob(me.userId, { resumeId: other.resumeId, text: fixture.text }, { db: db!, client: jdClient().client })).toEqual({ ok: false, reason: "no_analysis" });
    expect(await addJob(me.userId, { resumeId: me.resumeId, url: "https://careers.example.com/x" }, { db: db! })).toEqual({ ok: false, reason: "invalid" });
  });

  it("sets and clears the right dates as the status moves, and only on the person's own jobs", async () => {
    const me = await person();
    const someone = await person();
    const added = await add(me);
    if (!added.ok || added.kind !== "check") throw new Error("not added");
    const ref = { kind: "check", checkId: added.job.checkId } as const;
    await saveJob(me.userId, { checkId: ref.checkId, company: "Example Analytics", title: "Data analyst" }, { db: db!, now });
    expect(await setJobStatus(someone.userId, { ref, status: "applied" }, { db: db!, now })).toEqual({ ok: false, error: "not_found" });
    expect(await setJobStatus(me.userId, { ref, status: "heard" }, { db: db!, now })).toEqual({ ok: true });
    let [row] = await rowOf(me.userId);
    expect(row).toMatchObject({ stage: 2, closedAt: null });
    expect(row.appliedAt).toEqual(now);
    const later = new Date(now.getTime() + 86_400_000);
    await setJobStatus(me.userId, { ref, status: "no" }, { db: db!, now: later });
    [row] = await rowOf(me.userId);
    expect(row).toMatchObject({ stage: 5, appliedAt: now, closedAt: later });
    await setJobStatus(me.userId, { ref, status: "withdrawn" }, { db: db!, now: new Date(later.getTime() + 1000) });
    [row] = await rowOf(me.userId);
    expect(row).toMatchObject({ stage: 6, closedAt: later });
    await setJobStatus(me.userId, { ref, status: "saved" }, { db: db!, now: later });
    [row] = await rowOf(me.userId);
    expect(row).toMatchObject({ stage: null, appliedAt: null, closedAt: null });
    expect(row.savedAt).not.toBeNull();
    expect(await setJobStatus(me.userId, { ref, status: "ghosted" }, { db: db!, now })).toEqual({ ok: false, error: "invalid" });
  });

  it("edits an added job's labels, dates and note, but a feed job keeps the posting's", async () => {
    const me = await person();
    const added = await add(me);
    if (!added.ok || added.kind !== "check") throw new Error("not added");
    const ref = { kind: "check", checkId: added.job.checkId } as const;
    await saveJob(me.userId, { checkId: ref.checkId, company: "Example Analytics", title: "Data analyst" }, { db: db!, now });
    const edit = { ref, company: "Example Analytics Pvt Ltd", title: "Data analyst", url: "", city: "Pune", status: "no", appliedOn: "2026-10-21", closedOn: "2026-10-24", note: "Round 1 is a SQL test." };
    expect(await updateJob(me.userId, edit, { db: db!, now })).toEqual({ ok: true });
    const [view] = await myJobs(me.userId, { db: db!, now });
    expect(view).toMatchObject({ company: "Example Analytics Pvt Ltd", url: null, city: "Pune", status: "no", note: "Round 1 is a SQL test." });
    expect(view.appliedAt).toBe("2026-10-21T06:30:00.000Z");
    expect(view.closedAt).toBe("2026-10-24T06:30:00.000Z");
    expect(await updateJob(me.userId, { ...edit, note: "x".repeat(2001) }, { db: db!, now })).toEqual({ ok: false, error: "invalid" });

    const p = await post();
    await setStage(me.userId, { postId: p, stage: 1 }, { db: db!, now });
    expect(await updateJob(me.userId, { ref: { kind: "post", postId: p }, status: "interview", note: "Call with the team lead." }, { db: db!, now })).toEqual({ ok: true });
    const feed = (await myJobs(me.userId, { db: db!, now })).find((j) => j.key === `post:${p}`);
    expect(feed).toMatchObject({ company: "Example Labs", title: "Junior data analyst", status: "interview", note: "Call with the team lead.", source: "board" });
  });

  it("shows a 300-character title whole in My jobs and clipped on Prepare, the mock round and Today (T140)", async () => {
    const me = await person();
    const title = `Senior data analyst ${"for the payments platform ".repeat(11)}`.trim();
    expect(title.length).toBeGreaterThan(300);
    // Feed posts are held to 160 by job_posts_title_length; a job the person added has no such limit in the table.
    const added = await add(me);
    if (!added.ok || added.kind !== "check") throw new Error("not added");
    const ref = { kind: "check", checkId: added.job.checkId } as const;
    await saveJob(me.userId, { checkId: ref.checkId, company: "Example Analytics", title: "Data analyst" }, { db: db!, now });
    await db!.update(schema.jobChecks).set({ title }).where(eq(schema.jobChecks.id, ref.checkId));
    const day = new Date(now.getTime() + 2 * 86_400_000 + 5.5 * 3600_000).toISOString().slice(0, 10);
    expect(await updateJob(me.userId, { ref, status: "interview", interviewAt: `${day}T10:30` }, { db: db!, now })).toEqual({ ok: true });
    const prep = await jobPrep(me.userId, ref, { db: db!, now });
    const soon = await nextInterview(me.userId, { db: db!, now });
    const [row] = await rowOf(me.userId);
    const label = await jobLabel(me.userId, row.id, db!);
    for (const named of [prep, soon, label]) {
      expect(named?.title.length).toBeLessThanOrEqual(160);
      expect(named?.title).toMatch(/^Senior data analyst for the payments platform .*…$/);
    }
    expect(nextInterviewView.safeParse(soon).success).toBe(true);
    const [mine] = await myJobs(me.userId, { db: db!, now });
    expect(mine.title).toBe(title);
  });

  it("keeps an interview date that moves an earlier status to Interview, and Today counts down to the soonest (handoff 12m)", async () => {
    const me = await person();
    const someone = await person();
    const added = await add(me);
    if (!added.ok || added.kind !== "check") throw new Error("not added");
    const ref = { kind: "check", checkId: added.job.checkId } as const;
    await saveJob(me.userId, { checkId: ref.checkId, company: "Example Analytics", title: "Data analyst" }, { db: db!, now });
    expect(await nextInterview(me.userId, { db: db!, now })).toBeNull();
    // 10:30 IST, two days after `now`.
    const day = new Date(now.getTime() + 2 * 86_400_000 + 5.5 * 3600_000).toISOString().slice(0, 10);
    expect(await updateJob(me.userId, { ref, status: "saved", interviewAt: `${day}T10:30` }, { db: db!, now })).toEqual({ ok: true });
    let [view] = await myJobs(me.userId, { db: db!, now });
    expect(view).toMatchObject({ status: "interview", interviewAt: `${day}T05:00:00.000Z` });
    expect(view.appliedAt).toBe(now.toISOString());
    expect(await nextInterview(me.userId, { db: db!, now })).toEqual({ ref, company: "Example Analytics", title: "Data analyst", interviewAt: `${day}T05:00:00.000Z` });
    expect(await nextInterview(someone.userId, { db: db!, now })).toBeNull();
    // Offer keeps it on Today; past its start by more than two hours, or closed, it leaves.
    await setJobStatus(me.userId, { ref, status: "offer" }, { db: db!, now });
    expect(await nextInterview(me.userId, { db: db!, now })).not.toBeNull();
    expect(await nextInterview(me.userId, { db: db!, now: new Date(Date.parse(`${day}T05:00:00.000Z`) + 3 * 3600_000) })).toBeNull();
    expect(await updateJob(me.userId, { ref, status: "no", interviewAt: `${day}T10:30` }, { db: db!, now })).toEqual({ ok: true });
    [view] = await myJobs(me.userId, { db: db!, now });
    expect(view).toMatchObject({ status: "no", interviewAt: `${day}T05:00:00.000Z` });
    expect(await nextInterview(me.userId, { db: db!, now })).toBeNull();
    // An empty field clears it; the export carries it from version 34.
    await updateJob(me.userId, { ref, status: "interview", interviewAt: `${day}T10:30` }, { db: db!, now });
    expect((await exportMyJobs(me.userId, db!))[0].interview_at).toBe(`${day}T05:00:00.000Z`);
    await updateJob(me.userId, { ref, status: "interview", interviewAt: "" }, { db: db!, now });
    [view] = await myJobs(me.userId, { db: db!, now });
    expect(view).toMatchObject({ status: "interview", interviewAt: null });
    expect(await updateJob(me.userId, { ref, status: "interview", interviewAt: "30 Oct, 10:30" }, { db: db!, now })).toEqual({ ok: false, error: "invalid" });
  });

  it("deletes an added job with its description, and takes a feed job off the list while the post stays", async () => {
    const me = await person();
    const added = await add(me);
    if (!added.ok || added.kind !== "check") throw new Error("not added");
    await saveJob(me.userId, { checkId: added.job.checkId, company: "Example Analytics", title: "Data analyst" }, { db: db!, now });
    const p = await post();
    await setStage(me.userId, { postId: p, stage: 1 }, { db: db!, now });
    const someone = await person();
    expect(await deleteJob(someone.userId, { ref: { kind: "check", checkId: added.job.checkId } }, { db: db!, now })).toEqual({ ok: false, error: "not_found" });
    expect(await deleteJob(me.userId, { ref: { kind: "check", checkId: added.job.checkId } }, { db: db!, now })).toEqual({ ok: true });
    expect(await db!.select().from(schema.jobChecks).where(eq(schema.jobChecks.id, added.job.checkId))).toEqual([]);
    expect(await deleteJob(me.userId, { ref: { kind: "post", postId: p } }, { db: db!, now })).toEqual({ ok: true });
    expect(await rowOf(me.userId)).toEqual([]);
    expect(await db!.select({ id: schema.jobPosts.id }).from(schema.jobPosts).where(eq(schema.jobPosts.id, p))).toHaveLength(1);
  });

  it("holds at most the cap of jobs a person", async () => {
    const me = await person();
    await setStage(me.userId, { postId: await post(), stage: 1 }, { db: db!, now });
    const added = await add(me);
    if (!added.ok || added.kind !== "check") throw new Error("not added");
    expect(await saveJob(me.userId, { checkId: added.job.checkId, company: "A", title: "B" }, { db: db!, now, max: 1 })).toEqual({ ok: false, error: "full" });
  });

  it("keeps a saved job and reads its fit again when the person uploads a new resume", async () => {
    const me = await person();
    const added = await add(me);
    if (!added.ok || added.kind !== "check") throw new Error("not added");
    await saveJob(me.userId, { checkId: added.job.checkId, company: "Example Analytics", title: "Data analyst" }, { db: db!, now });
    const before = (await myJobs(me.userId, { db: db!, now }))[0].fit!;
    const more: Profile = { ...profile, skills: [...profile.skills, { name: "Excel", lastUsed: null, evidence: ["Built weekly Excel reports for 40 stores"] }] };
    await new Promise((r) => setTimeout(r, 5));
    await resumeFor(me.userId, more);
    const [after] = await myJobs(me.userId, { db: db!, now });
    expect(after.key).toBe(`check:${added.job.checkId}`);
    expect(after.fit!.have).toBe(before.have + 1);
  });

  it("clears the text of a job checked but never saved after 24 hours, and keeps a saved one's", async () => {
    const me = await person();
    const unsaved = await add(me);
    const saved = await add(me, { text: `${fixture.text}\nApply by 30 November.` });
    if (!unsaved.ok || unsaved.kind !== "check" || !saved.ok || saved.kind !== "check") throw new Error("not added");
    await saveJob(me.userId, { checkId: saved.job.checkId, company: "A", title: "B" }, { db: db!, now });
    const ids = [unsaved.job.checkId, saved.job.checkId];
    expect(await clearUnsavedJobText(db!, new Date(), ids)).toEqual({ unsavedJobTextCleared: 0 });
    expect(await clearUnsavedJobText(db!, new Date(Date.now() + 25 * 3600_000), ids)).toEqual({ unsavedJobTextCleared: 1 });
    const rows = await db!.select({ id: schema.jobChecks.id, description: schema.jobChecks.description, url: schema.jobChecks.url }).from(schema.jobChecks).where(inArray(schema.jobChecks.id, ids));
    expect(rows.find((r) => r.id === unsaved.job.checkId)).toMatchObject({ description: null, url: null });
    expect(rows.find((r) => r.id === saved.job.checkId)?.description).toContain("category managers");
  });

  it("is in Download your data (from version 33, the interview from 34) with the note and description, and goes with the account", async () => {
    const me = await person();
    const added = await add(me);
    if (!added.ok || added.kind !== "check") throw new Error("not added");
    await saveJob(me.userId, { checkId: added.job.checkId, company: "Example Analytics", title: "Data analyst" }, { db: db!, now });
    await updateJob(me.userId, { ref: { kind: "check", checkId: added.job.checkId }, status: "applied", note: "Round 1 is a SQL test." }, { db: db!, now });
    const rows = await exportMyJobs(me.userId, db!);
    expect(rows).toMatchObject([{ source: "you_added", company: "Example Analytics", status: "Applied", note: "Round 1 is a SQL test.", url: "https://careers.example.com/data-analyst" }]);
    expect(rows[0].description).toContain("category managers");
    for (const r of rows) expect(myJobExport.safeParse(r).success).toBe(true);
    const data = await exportAccountData(me.userId, db!);
    expect(EXPORT_VERSION).toBe(34);
    expect(data!.myJobs).toEqual(rows);
    await db!.delete(schema.resumes).where(eq(schema.resumes.userId, me.userId));
    await db!.delete(schema.users).where(eq(schema.users.id, me.userId));
    expect(await rowOf(me.userId)).toEqual([]);
    expect(await db!.select().from(schema.jobChecks).where(eq(schema.jobChecks.id, added.job.checkId))).toEqual([]);
  });
});
