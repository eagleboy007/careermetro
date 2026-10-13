import { and, eq, inArray, like } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { roleProfiles, skills } from "@/content";
import * as schema from "@/db/schema";
import { MATCHER_VERSION } from "@/lib/gaps/match";
import { listThreads } from "@/lib/inbox/store";
import type { GapAnalysis, Profile } from "@/lib/schemas";
import { AUDIT_PAGE_SIZE } from "@/lib/schemas/constants";
import { applyToJob, jobBoard, moveApplication, openCandidate } from "./applications-store";
import { companyAudit } from "./audit";
import { companyChat, companyMessages } from "./chats-store";
import { clearPastOfferedTimes, endCompanyAccess, eraseClosedPhones } from "./cleanup";
import { askForTimes, cancelInterview, companyInterviews, offerTimes, respondToInterview, scheduleInterview, submitFeedback } from "./interviews-store";
import { requirementsFromRole, roleBySlug } from "./job-content";
import { saveJob, setJobStatus } from "./jobs-store";
import { companyOverview, corporateUnread } from "./overview";
import { activeMembership, finishCompanySignup, finishJoin, inviteMember, removeMember, startCompanySignup, startJoin, type CorporateDeps } from "./store";

vi.mock("server-only", () => ({}));

// Overview, audit and the daily clean-up (dev/corporate-plan.md build step 7) against a real Postgres with migrations
// applied. Every person, company, phone number and line of feedback here is made up.
const url = process.env.TEST_DATABASE_URL;
const sqlClient = url ? postgres(url, { max: 4, onnotice: () => {} }) : null;
const db = sqlClient ? drizzle(sqlClient, { schema }) : null;
const env = { NAME_HASH_KEY: "test-key" };
const DAY = 86_400_000;

const profile: Profile = {
  headline: null,
  totalYearsExperience: 3,
  roles: [{ title: "IT support analyst", employer: "Konkan Co-operative Bank", start: "2023-06", end: null, highlights: ["Ran Linux servers for 30 branches."] }],
  skills: [{ name: "Python", lastUsed: "2025", evidence: [] }],
  education: [{ qualification: "B.Sc. IT", institution: "Pune University", year: "2023" }],
  certifications: [],
};
const analysis: GapAnalysis = {
  roleSlug: roleProfiles[0].slug,
  gaps: [{ skillId: "aws", skillName: "AWS", status: "missing", resumeQuote: null, requirement: "r", explanation: "e" }],
  metSkillIds: ["linux"],
  niceToHave: [],
  readiness: { headline: "h", explanation: "e", estimatedHours: 10 },
};
const PHONE = "98765 43210";
const FEEDBACK = "Walked through two phishing alerts end to end and wrote clear incident notes.";

describe.skipIf(!db)("overview, audit and clean-up (database)", () => {
  const run = `ovw${Date.now()}`;
  const userIds: string[] = [];
  // Tuesday 13 October 2026, 15:30 India time. Its India week runs Monday 12 to Sunday 18 October.
  const clock = new Date("2026-10-13T10:00:00Z");
  const deps = (over: Partial<CorporateDeps> = {}): CorporateDeps => ({ db: db!, env, now: clock, delivery: "test", ...over });
  const at = (days = 0) => ({ db: db!, env, now: new Date(clock.getTime() + days * DAY) });
  const lines: string[] = [];
  const SLUG = "cyber-security-analyst";
  const role = roleBySlug(SLUG)!;
  const req = requirementsFromRole(role);
  const yes = { real: true, noFee: true, fair: true } as const;

  beforeAll(async () => {
    await db!
      .insert(schema.skills)
      .values(skills.map(({ id, name, category }) => ({ id, name, category })))
      .onConflictDoNothing();
    // Shared with the other corporate test files: added once if missing and never deleted (CI's database is unseeded).
    await db!.insert(schema.roleProfiles).values({ slug: SLUG, version: 1, data: role, published: false, updatedOn: role.updatedOn }).onConflictDoNothing();
  });
  beforeEach(() => {
    for (const level of ["log", "warn", "error"] as const) vi.spyOn(console, level).mockImplementation((line: unknown) => void lines.push(String(line)));
  });
  afterEach(() => vi.restoreAllMocks());
  afterAll(async () => {
    const orgs = await db!.select({ id: schema.organizations.id }).from(schema.organizations).where(like(schema.organizations.emailDomain, `%${run}%`));
    if (orgs.length) await db!.delete(schema.auditLogs).where(inArray(schema.auditLogs.orgId, orgs.map((o) => o.id)));
    await db!.delete(schema.organizations).where(like(schema.organizations.emailDomain, `%${run}%`));
    if (userIds.length) await db!.delete(schema.users).where(inArray(schema.users.id, userIds));
    await sqlClient!.end();
    // Logs carry event names, counts and reasons only: never a phone, feedback, a name or an email.
    const all = lines.join("\n");
    for (const secret of ["98765", "phishing alerts", "Priya", "Sana", "Meera", "Rahul", "@example", run]) expect(all).not.toContain(secret);
  });

  async function person(n: string, name = "Meera Iyer") {
    const [u] = await db!.insert(schema.users).values({ email: `${run}-${n}@example.test`, name }).returning({ id: schema.users.id });
    userIds.push(u.id);
    return u.id;
  }
  async function candidate(n: string, name = "Priya Nair") {
    const id = await person(n, name);
    const [resume] = await db!.insert(schema.resumes).values({ userId: id, mimeType: "text/plain", sizeBytes: 1, status: "parsed" }).returning();
    const [p] = await db!.insert(schema.profiles).values({ resumeId: resume.id, version: 1, data: profile, confirmedByUser: true }).returning();
    await db!.insert(schema.gapAnalyses).values({ profileId: p.id, result: analysis, matcherVersion: MATCHER_VERSION });
    return id;
  }
  let n = 0;
  const details = (d: string) => ({ type: "company", legalName: "Example Labs Private Limited", name: "Example Labs", website: `https://${d}`, workEmail: `meera.iyer@${d}`, size: "51 to 200", city: "Pune" });
  async function join(adminId: string, userId: string, d: string, r: "admin" | "hiring" | "interviewer", local: string) {
    expect(await inviteMember(adminId, { workEmail: `${local}@${d}`, role: r }, deps())).toEqual({ ok: true });
    const started = await startJoin(userId, { workEmail: `${local}@${d}` }, deps());
    if (!started.ok || !started.testCode) throw new Error("no join code");
    expect(await finishJoin(userId, { workEmail: `${local}@${d}`, code: started.testCode }, deps())).toMatchObject({ ok: true });
    return (await activeMembership(userId, db!))!.memberId;
  }
  /** A verified company: an admin, Hiring HR on the job, Hiring HR not on it, an Interviewer on it, an open job and one shortlisted application. */
  async function setup(tag: string) {
    const d = `${run}-${++n}.example-labs.test`;
    const admin = await person(`${tag}-admin`);
    const started = await startCompanySignup(admin, details(d), deps());
    if (!started.ok || !started.testCode) throw new Error("no code");
    const done = await finishCompanySignup(admin, { details: details(d), code: started.testCode }, deps());
    if (!done.ok) throw new Error(done.error);
    await db!.update(schema.organizations).set({ reviewStatus: "verified" }).where(eq(schema.organizations.id, done.orgId));
    const hr = await person(`${tag}-hr`, "Rahul Menon");
    const otherHr = await person(`${tag}-hr2`, "Farhan Shaikh");
    const iv = await person(`${tag}-iv`, "Sana Qureshi");
    const hrMember = await join(admin, hr, d, "hiring", "rahul");
    const otherMember = await join(admin, otherHr, d, "hiring", "farhan");
    const ivMember = await join(admin, iv, d, "interviewer", "sana");
    const adminMember = (await activeMembership(admin, db!))!.memberId;
    const saved = await saveJob(admin, { roleSlug: SLUG, title: "SOC Analyst L1", workType: "full_time", city: "Pune", requirements: req, open: yes, hiring: [hrMember], interviewers: [ivMember] }, deps());
    if (!saved.ok) throw new Error(saved.error);
    const me = await candidate(`${tag}-cand`);
    const applied = await applyToJob(me, { jobId: saved.jobId, canJoin: "30", consent: true }, at());
    if (!applied.ok) throw new Error(applied.error);
    await moveApplication(hr, { applicationId: applied.applicationId, to: "shortlisted", note: "" }, at());
    return { d, orgId: done.orgId, admin, adminMember, hr, hrMember, otherHr, otherMember, iv, ivMember, me, jobId: saved.jobId, applicationId: applied.applicationId };
  }
  type Company = Awaited<ReturnType<typeof setup>>;
  /** Asks for times as Hiring HR and has the candidate offer `keys`. */
  async function offered(s: Company, keys: string[], when = at()) {
    const asked = await askForTimes(s.hr, { applicationId: s.applicationId }, when);
    if (!asked.ok) throw new Error(asked.error);
    // A minute after the ask, so the answer is newer than the asker's read mark.
    const r = await offerTimes(s.me, { messageId: asked.messageId, slots: keys }, { ...when, now: new Date(when.now.getTime() + 60_000) });
    if (!r.ok) throw new Error(r.error);
    const rows = await db!.select().from(schema.candidateSlots).where(eq(schema.candidateSlots.askMessageId, asked.messageId));
    return { messageId: asked.messageId, slot: (key: string) => rows.find((x) => x.startsAt.getTime() === new Date(`${key}:00+05:30`).getTime())!.id };
  }
  async function book(s: Company, slotId: string) {
    const booked = await scheduleInterview(s.hr, { applicationId: s.applicationId, slotId, minutes: 45, interviewers: [s.ivMember] }, at());
    if (!booked.ok) throw new Error(booked.error);
    return booked.interviewId;
  }
  const overview = async (userId: string, when = at()) => {
    const o = await companyOverview(userId, when);
    if (!o) throw new Error("no overview");
    return o;
  };
  const audit = async (userId: string, raw: unknown = {}) => {
    const r = await companyAudit(userId, raw, { db: db! });
    if (!r.ok) throw new Error(r.error);
    return r.view;
  };

  /* Overview -------------------------------------------------------------------------------------------------------- */

  it("counts open jobs, lanes, new applications, this week's interviews and unread chats, as each member may see them", async () => {
    const s = await setup("ov");
    const second = await candidate("ov-cand2", "Kavya Reddy");
    expect(await applyToJob(second, { jobId: s.jobId, canJoin: "now", consent: true }, at())).toMatchObject({ ok: true });

    const admin = await overview(s.admin);
    expect(admin).toMatchObject({ role: "admin", assignedOnly: false, openJobs: 1, newApplications: 2, interviewsToday: 0, interviewsThisWeek: 0, unreadChats: 0 });
    expect(admin.lanes).toEqual({ applied: 1, shortlisted: 1, ai: 0, team: 0, offer: 0, not_this_time: 0 });
    expect(admin.jobs).toEqual([{ id: s.jobId, title: "SOC Analyst L1", city: "Pune", status: "open", lanes: admin.lanes, total: 2 }]);
    // Hiring HR on the job sees the same; Hiring HR off it sees no job and no one.
    expect((await overview(s.hr)).lanes).toEqual(admin.lanes);
    expect(await overview(s.otherHr)).toMatchObject({ openJobs: 0, newApplications: 0, jobs: [], unreadChats: 0, lanes: { applied: 0, shortlisted: 0 } });
    // An interviewer counts no one until they are on an interview.
    expect(await overview(s.iv)).toMatchObject({ assignedOnly: true, openJobs: 1, newApplications: 0, lanes: { applied: 0, shortlisted: 0 } });

    // The candidate answers "Ask for times": a chat line Hiring HR hasn't read, and the admin never opened.
    const { slot } = await offered(s, ["2026-10-14T11:00", "2026-10-15T10:00"], at(1 / 1440));
    expect((await overview(s.hr)).unreadChats).toBe(1);
    expect(await corporateUnread(s.hr, at())).toBe(1);
    expect(await corporateUnread(s.admin, at())).toBe(1);
    expect(await corporateUnread(s.otherHr, at())).toBe(0);
    // The same count Messages shows.
    const msgs = await companyMessages(s.hr, at());
    expect(msgs.ok && msgs.view.items.filter((i) => i.unread)).toHaveLength(1);
    await companyChat(s.hr, s.applicationId, { ...at(1 / 24), markRead: true });
    expect(await corporateUnread(s.hr, at(1 / 24))).toBe(0);
    expect(await corporateUnread(s.admin, at(1 / 24))).toBe(1);
    // No company role: nothing to count.
    expect(await corporateUnread(s.me, at())).toBe(0);
    expect(await companyOverview(s.me, at())).toBeNull();

    // Booked on Wednesday: this week; today on Wednesday itself; the interviewer now counts that one candidate.
    await book(s, slot("2026-10-14T11:00"));
    expect(await overview(s.admin)).toMatchObject({ interviewsToday: 0, interviewsThisWeek: 1 });
    expect(await overview(s.admin, { db: db!, env, now: new Date("2026-10-14T02:00:00Z") })).toMatchObject({ interviewsToday: 1, interviewsThisWeek: 1 });
    expect(await overview(s.admin, at(7))).toMatchObject({ interviewsThisWeek: 0 });
    expect(await overview(s.iv)).toMatchObject({ interviewsThisWeek: 1, lanes: { applied: 0, shortlisted: 1 }, jobs: [{ total: 1 }] });
    // The same interviews Corporate Interviews lists.
    const ivs = await companyInterviews(s.admin, at());
    expect(ivs.ok && ivs.view.items).toHaveLength(1);

    // Not this time: still counted in its lane for 180 days, then gone. A paused job still shows; a closed one doesn't.
    await moveApplication(s.hr, { applicationId: s.applicationId, to: "not_this_time", note: "We picked someone with more cloud log work." }, at());
    expect((await overview(s.admin)).lanes).toMatchObject({ shortlisted: 0, not_this_time: 1 });
    // Not this time cancelled the interview still ahead, and the audit says so, from the member who closed it.
    const cancelled = await db!.select().from(schema.auditLogs).where(and(eq(schema.auditLogs.orgId, s.orgId), eq(schema.auditLogs.action, "interview_cancelled")));
    expect(cancelled.map((l) => l.actor)).toEqual([`member:${s.hrMember}`]);
    expect(await overview(s.admin)).toMatchObject({ interviewsThisWeek: 0 });
    expect((await overview(s.admin, at(181))).lanes).toMatchObject({ applied: 1, not_this_time: 0 });
    expect(await setJobStatus(s.admin, { jobId: s.jobId, to: "paused" }, deps())).toEqual({ ok: true });
    expect(await overview(s.admin)).toMatchObject({ openJobs: 0, jobs: [{ status: "paused" }] });
    expect(await setJobStatus(s.admin, { jobId: s.jobId, to: "closed" }, deps())).toEqual({ ok: true });
    expect(await overview(s.admin)).toMatchObject({ openJobs: 0, jobs: [] });

    // A removed role ends the Overview and the count at once.
    expect(await removeMember(s.admin, { memberId: s.hrMember }, deps())).toEqual({ ok: true });
    expect(await companyOverview(s.hr, at())).toBeNull();
    expect(await corporateUnread(s.hr, at())).toBe(0);
  });

  /* Audit ----------------------------------------------------------------------------------------------------------- */

  it("writes a line for each team, job, candidate and interview action, and shows Recruiter admins who did what without contact details", async () => {
    const s = await setup("au");
    const { slot } = await offered(s, ["2026-10-14T11:00", "2026-10-15T10:00"]);
    const first = await book(s, slot("2026-10-14T11:00"));
    expect(await cancelInterview(s.hr, { interviewId: first }, at())).toEqual({ ok: true });
    const second = await book(s, slot("2026-10-15T10:00"));
    expect(await respondToInterview(s.me, { interviewId: second, answer: "accept", sharePhone: true, phone: PHONE }, at())).toEqual({ ok: true });
    expect(await submitFeedback(s.iv, { interviewId: second, recommendation: "yes", text: FEEDBACK }, at(3))).toEqual({ ok: true });
    expect(await openCandidate(s.admin, { applicationId: s.applicationId }, at())).toMatchObject({ ok: true });

    // Stored: ids and fixed action names only.
    const stored = await db!.select().from(schema.auditLogs).where(eq(schema.auditLogs.orgId, s.orgId));
    expect(stored.map((l) => l.action).sort()).toEqual(
      [
        "candidate_viewed",
        "company_created",
        "feedback_saved",
        "interview_accepted",
        "interview_booked",
        "interview_booked",
        "interview_cancelled",
        "job_opened",
        "member_joined",
        "member_joined",
        "member_joined",
        "moved_shortlisted",
        "role_invited",
        "role_invited",
        "role_invited",
        "times_asked",
      ].sort(),
    );
    for (const l of stored) {
      expect(l.actor).toMatch(/^(member:[0-9a-f-]{36}|candidate)$/);
      expect(l.target).toMatch(/^(company|member|invite|job|application):[0-9a-f-]{36}$/);
    }
    const raw = JSON.stringify(stored);
    for (const secret of ["98765", "Priya", "phishing", "@", "example-labs"]) expect(raw).not.toContain(secret);

    // The admin's view: names and roles of the members who acted, the candidate only as "the candidate".
    const view = await audit(s.admin);
    expect(view.company).toBe("Example Labs");
    const booked = view.lines.filter((l) => l.action === "Booked an interview");
    expect(booked).toHaveLength(2);
    expect(booked[0]).toMatchObject({ who: { kind: "member", name: "Rahul Menon", role: "hiring" }, on: { kind: "application", ref: s.applicationId.slice(0, 8), job: "SOC Analyst L1" } });
    expect(view.lines.find((l) => l.action === "Cancelled an interview")).toMatchObject({ who: { kind: "member", name: "Rahul Menon" }, at: "13 Oct 2026, 15:30" });
    expect(view.lines.find((l) => l.action === "Accepted an interview")).toMatchObject({ who: { kind: "candidate" } });
    expect(view.lines.find((l) => l.action === "Saved interview feedback")).toMatchObject({ who: { kind: "member", name: "Sana Qureshi", role: "interviewer" } });
    expect(view.lines.find((l) => l.action === "Opened a job")).toMatchObject({ on: { kind: "job", title: "SOC Analyst L1" } });
    expect(view.lines.find((l) => l.action === "Gave a role by work email")).toMatchObject({ on: { kind: "invite", role: expect.any(String), domain: s.d } });
    // Never the candidate's name, email or phone; never feedback or a message.
    const shown = JSON.stringify(view);
    for (const secret of ["Priya", "98765", "phishing", `${run}-au-cand`, "offered"]) expect(shown).not.toContain(secret);

    // Only Recruiter admins, read live.
    expect(await companyAudit(s.hr, {}, { db: db! })).toEqual({ ok: false, error: "not_admin" });
    expect(await companyAudit(s.iv, {}, { db: db! })).toEqual({ ok: false, error: "not_admin" });
    expect(await companyAudit(s.me, {}, { db: db! })).toEqual({ ok: false, error: "not_member" });
    // Removing a role is a line too, naming who lost it.
    expect(await removeMember(s.admin, { memberId: s.otherMember }, deps({ now: at(5).now }))).toEqual({ ok: true });
    expect((await audit(s.admin)).lines[0]).toMatchObject({ action: "Removed a role", who: { kind: "member", role: "admin" }, on: { kind: "member", name: "Farhan Shaikh", role: "hiring" } });

    // Another company never sees these lines, and these admins never see its.
    const other = await setup("au2");
    expect((await audit(other.admin)).lines.every((l) => l.on.kind !== "application" || l.on.ref !== s.applicationId.slice(0, 8))).toBe(true);
    expect((await audit(s.admin)).lines.some((l) => l.on.kind === "job" && l.on.ref === other.jobId.slice(0, 8))).toBe(false);
  });

  it("pages the audit without skipping or repeating a line, and leaves out the admin's own application", async () => {
    const s = await setup("pg");
    // A second admin applies to their own company's job; the first admin opens it many times.
    const admin2 = await candidate("pg-admin2", "Arjun Mehta");
    await join(s.admin, admin2, s.d, "admin", "arjun");
    const own = await applyToJob(admin2, { jobId: s.jobId, canJoin: "now", consent: true }, at());
    if (!own.ok) throw new Error(own.error);
    for (let i = 0; i < AUDIT_PAGE_SIZE + 5; i++) expect(await openCandidate(s.admin, { applicationId: own.applicationId }, at(i / 1440))).toMatchObject({ ok: true });

    const seen: string[] = [];
    let before: string | undefined;
    for (let pages = 0; pages < 5; pages++) {
      const view = await audit(s.admin, before ? { before } : {});
      seen.push(...view.lines.map((l) => l.id));
      if (!view.next) break;
      before = view.next;
    }
    const total = (await db!.select({ id: schema.auditLogs.id }).from(schema.auditLogs).where(eq(schema.auditLogs.orgId, s.orgId))).length;
    expect(new Set(seen).size).toBe(seen.length);
    expect(seen).toHaveLength(total);
    // The second admin sees every line but those about their own application.
    const theirs = await audit(admin2);
    expect(theirs.lines.some((l) => l.action === "Opened a candidate")).toBe(false);
    expect(theirs.lines.length).toBeLessThan(AUDIT_PAGE_SIZE);
    // A cursor that isn't one is ignored: the newest page.
    expect((await audit(s.admin, { before: "yesterday' or 1=1" })).lines[0]!.id).toBe(seen[0]);
  });

  /* The daily clean-up ---------------------------------------------------------------------------------------------- */

  it("ends company access 180 days after closing, once, without showing anything that reads hid already", async () => {
    const s = await setup("end");
    await offered(s, ["2026-10-14T11:00"]);
    await moveApplication(s.hr, { applicationId: s.applicationId, to: "not_this_time", note: "We picked someone with more cloud log work." }, at());
    const [conv] = await db!.select({ id: schema.conversations.id }).from(schema.conversations).where(eq(schema.conversations.applicationId, s.applicationId));
    const marks = () => db!.select({ userId: schema.conversationMembers.userId, role: schema.conversationMembers.role }).from(schema.conversationMembers).where(eq(schema.conversationMembers.conversationId, conv.id));
    expect((await marks()).some((m) => m.role === "company_team")).toBe(true);

    // Day 179: still the company's to see; the job leaves it alone.
    const day179 = await endCompanyAccess(db!, at(179).now, { orgId: s.orgId });
    const mine = async () => (await db!.select().from(schema.applications).where(eq(schema.applications.id, s.applicationId)))[0]!;
    expect((await mine()).companyAccessEndsAt).toBeNull();
    expect(day179.accessEnded).toBe(0);
    const board179 = await jobBoard(s.hr, s.jobId, at(179));
    expect(board179.ok && board179.board.cards).toHaveLength(1);

    // Day 181: reads hide it already; the job records when access ended and drops the company's read marks.
    const before = await jobBoard(s.hr, s.jobId, at(181));
    expect(before.ok && before.board.cards).toHaveLength(0);
    const ended = await endCompanyAccess(db!, at(181).now, { orgId: s.orgId });
    expect(ended.accessEnded).toBe(1);
    const row = await mine();
    expect(row.companyAccessEndsAt!.getTime()).toBe(row.closedAt!.getTime() + 180 * DAY);
    expect(await marks()).toEqual([{ userId: s.me, role: "member" }]);
    // Nothing more on a second run, and nothing comes back.
    await endCompanyAccess(db!, at(181).now, { orgId: s.orgId });
    expect((await mine()).companyAccessEndsAt).toEqual(row.companyAccessEndsAt);
    const after = await jobBoard(s.hr, s.jobId, at(181));
    expect(after.ok && after.board.cards).toHaveLength(0);
    expect(await companyChat(s.hr, s.applicationId, at(181))).toMatchObject({ ok: false });
    // The candidate keeps their chat and Arrivals.
    expect((await listThreads(s.me, at(181))).length).toBe(1);
  });

  it("erases a phone shared for an interview once its application has closed, and leaves open ones", async () => {
    const s = await setup("ph");
    const { slot } = await offered(s, ["2026-10-14T11:00"]);
    const id = await book(s, slot("2026-10-14T11:00"));
    expect(await respondToInterview(s.me, { interviewId: id, answer: "accept", sharePhone: true, phone: PHONE }, at())).toEqual({ ok: true });
    const app = async () => (await db!.select().from(schema.applications).where(eq(schema.applications.id, s.applicationId)))[0]!;
    // Open: kept.
    await eraseClosedPhones(db!, { orgId: s.orgId });
    expect((await app()).phoneShared).not.toBeNull();
    // Closed (as rows closed before Not this time erased phones itself): erased, and the interview no longer says shared.
    await db!.update(schema.applications).set({ closedAt: clock }).where(eq(schema.applications.id, s.applicationId));
    expect(await eraseClosedPhones(db!, { orgId: s.orgId })).toBe(1);
    expect((await app()).phoneShared).toBeNull();
    expect((await db!.select().from(schema.interviews).where(eq(schema.interviews.id, id)))[0]!.phoneShared).toBe(false);
    await eraseClosedPhones(db!, { orgId: s.orgId });
    expect((await app()).phoneShared).toBeNull();
  });

  it("deletes offered times a week after they passed unbooked, keeps booked ones, and the chat still reads as answered", async () => {
    const s = await setup("ot");
    const first = await offered(s, ["2026-10-14T11:00", "2026-10-15T10:00"]);
    await book(s, first.slot("2026-10-14T11:00"));
    const second = await offered(s, ["2026-10-16T15:00"], at(1 / 1440));
    const slots = () => db!.select({ id: schema.candidateSlots.id }).from(schema.candidateSlots).where(eq(schema.candidateSlots.applicationId, s.applicationId));
    expect(await slots()).toHaveLength(3);
    // Not yet a week past.
    await clearPastOfferedTimes(db!, at(5).now, { orgId: s.orgId });
    expect(await slots()).toHaveLength(3);
    // Nine days on: the two unbooked times go; the booked one stays with its interview.
    expect(await clearPastOfferedTimes(db!, at(12).now, { orgId: s.orgId })).toBe(2);
    expect((await slots()).map((x) => x.id)).toEqual([first.slot("2026-10-14T11:00")]);
    const [ask] = await db!.select({ payload: schema.messages.payload }).from(schema.messages).where(eq(schema.messages.id, second.messageId));
    expect(ask!.payload).toMatchObject({ answered: true });
    expect(await clearPastOfferedTimes(db!, at(12).now, { orgId: s.orgId })).toBe(0);

    // The company's cards: both ended; the candidate's: the second says its times have passed, not "can't be answered".
    const chat = await companyChat(s.hr, s.applicationId, at(12));
    if (!chat.ok) throw new Error(chat.error);
    const cards = chat.chat.messages.filter((m) => m.times);
    expect(cards.map((c) => c.times)).toEqual([
      { offered: ["Wed 14 Oct, 11:00"], ended: "passed" },
      { offered: null, ended: "passed" },
    ]);
    const [thread] = await listThreads(s.me, at(12));
    const asks = thread.messages.filter((m) => m.type === "times").map((m) => m.ask!);
    expect(asks[1]).toMatchObject({ offered: null, passed: true, open: false });
  });

  it("shows the company an ask nobody answered as ended once its days have passed", async () => {
    const s = await setup("un");
    expect(await askForTimes(s.hr, { applicationId: s.applicationId }, at())).toMatchObject({ ok: true });
    const card = async (days: number) => {
      const chat = await companyChat(s.hr, s.applicationId, at(days));
      if (!chat.ok) throw new Error(chat.error);
      return chat.chat.messages.find((m) => m.times)!.times;
    };
    expect(await card(1)).toEqual({ offered: null });
    expect(await card(10)).toEqual({ offered: null, ended: "unanswered" });
    // And the team can ask again.
    expect(await askForTimes(s.hr, { applicationId: s.applicationId }, at(10))).toMatchObject({ ok: true });
  });

  it("works through a backlog in bounded batches", async () => {
    const s = await setup("bt");
    // 1,100 past offered times nobody booked (more than two batches), made directly.
    const start = new Date("2026-01-05T04:30:00Z").getTime();
    const rows = Array.from({ length: 1100 }, (_, i) => ({ applicationId: s.applicationId, startsAt: new Date(start + i * 3_600_000), createdAt: clock }));
    for (let i = 0; i < rows.length; i += 500) await db!.insert(schema.candidateSlots).values(rows.slice(i, i + 500));
    const left = async () => (await db!.select({ id: schema.candidateSlots.id }).from(schema.candidateSlots).where(and(eq(schema.candidateSlots.applicationId, s.applicationId)))).length;
    expect(await clearPastOfferedTimes(db!, clock, { orgId: s.orgId })).toBe(1100);
    expect(await left()).toBe(0);
  });
});
