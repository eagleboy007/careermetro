import { and, eq, inArray, like } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { roleProfiles, skills } from "@/content";
import * as schema from "@/db/schema";
import { EXPORT_VERSION, exportAccountData } from "@/lib/account/export";
import { MATCHER_VERSION } from "@/lib/gaps/match";
import type { GapAnalysis, Profile } from "@/lib/schemas";
import { LIMITS, takeShared } from "@/lib/shared-limit";
import { applyStates, applyToJob, jobBoard, moveApplication, myApplications, openCandidate, withdrawApplication } from "./applications-store";
import { requirementsFromRole, roleBySlug } from "./job-content";
import { saveJob } from "./jobs-store";
import { activeMembership, corporateHome, finishCompanySignup, finishJoin, inviteMember, removeMember, startCompanySignup, startJoin, type CorporateDeps } from "./store";

vi.mock("server-only", () => ({}));

// Applications and the board (dev/corporate-plan.md build step 4) against a real Postgres with migrations applied.
// Every person and resume here is made up.
const url = process.env.TEST_DATABASE_URL;
const sqlClient = url ? postgres(url, { max: 4, onnotice: () => {} }) : null;
const db = sqlClient ? drizzle(sqlClient, { schema }) : null;
const env = { NAME_HASH_KEY: "test-key" };
const DAY = 86_400_000;

const HIGHLIGHT = "Ran Linux servers and Splunk dashboards for 30 branches.";
const profile: Profile = {
  headline: null,
  totalYearsExperience: 3,
  roles: [{ title: "IT support analyst", employer: "Konkan Co-operative Bank", start: "2023-06", end: null, highlights: [HIGHLIGHT] }],
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

describe.skipIf(!db)("applications and the board (database)", () => {
  const run = `apps${Date.now()}`;
  const userIds: string[] = [];
  const clock = new Date("2026-10-13T10:00:00Z");
  const deps = (over: Partial<CorporateDeps> = {}): CorporateDeps => ({ db: db!, env, now: clock, delivery: "test", ...over });
  const at = (days = 0) => ({ db: db!, now: new Date(clock.getTime() + days * DAY) });
  const lines: string[] = [];
  let addedRoleRow: string | null = null;
  const SLUG = "cyber-security-analyst";
  const role = roleBySlug(SLUG)!;
  const req = requirementsFromRole(role);
  const yes = { real: true, noFee: true, fair: true } as const;
  const NOTE = "We need hands-on SIEM for this role. Apply again once it is proved.";

  beforeAll(async () => {
    await db!
      .insert(schema.skills)
      .values(skills.map(({ id, name, category }) => ({ id, name, category })))
      .onConflictDoNothing();
    const [row] = await db!.select({ id: schema.roleProfiles.id }).from(schema.roleProfiles).where(eq(schema.roleProfiles.slug, SLUG)).limit(1);
    if (!row) {
      const [added] = await db!.insert(schema.roleProfiles).values({ slug: SLUG, version: 1, data: role, published: false, updatedOn: role.updatedOn }).returning({ id: schema.roleProfiles.id });
      addedRoleRow = added.id;
    }
  });
  beforeEach(() => {
    for (const level of ["log", "warn", "error"] as const) vi.spyOn(console, level).mockImplementation((line: unknown) => void lines.push(String(line)));
  });
  afterEach(() => vi.restoreAllMocks());
  afterAll(async () => {
    await db!.delete(schema.organizations).where(like(schema.organizations.emailDomain, `%${run}%`));
    if (userIds.length) await db!.delete(schema.users).where(inArray(schema.users.id, userIds));
    if (addedRoleRow) await db!.delete(schema.roleProfiles).where(eq(schema.roleProfiles.id, addedRoleRow));
    await sqlClient!.end();
    // Logs carry event names and reasons only: never a name, a note or a resume line.
    const all = lines.join("\n");
    expect(all).not.toContain("Priya");
    expect(all).not.toContain("SIEM for this role");
    expect(all).not.toContain("branches");
  });

  async function person(n: string, name = "Meera Iyer") {
    const [u] = await db!.insert(schema.users).values({ email: `${run}-${n}@example.test`, name }).returning({ id: schema.users.id });
    userIds.push(u.id);
    return u.id;
  }
  /** A person with a read resume, a current analysis and one goal. */
  async function candidate(n: string, name = "Priya Nair") {
    const id = await person(n, name);
    const [resume] = await db!.insert(schema.resumes).values({ userId: id, mimeType: "text/plain", sizeBytes: 1, status: "parsed" }).returning();
    const [p] = await db!.insert(schema.profiles).values({ resumeId: resume.id, version: 1, data: profile, confirmedByUser: true }).returning();
    await db!.insert(schema.gapAnalyses).values({ profileId: p.id, result: analysis, matcherVersion: MATCHER_VERSION });
    await db!.insert(schema.userGoals).values({ userId: id, skillId: "aws", position: 1 });
    return id;
  }
  let n = 0;
  const domain = () => `${run}-${++n}.example-labs.test`;
  const details = (d: string) => ({ type: "company", legalName: "Example Labs Private Limited", name: "Example Labs", website: `https://${d}`, workEmail: `meera.iyer@${d}`, size: "51 to 200", city: "Pune" });
  async function company(admin: string) {
    const d = domain();
    const started = await startCompanySignup(admin, details(d), deps());
    if (!started.ok || !started.testCode) throw new Error("no code");
    const done = await finishCompanySignup(admin, { details: details(d), code: started.testCode }, deps());
    if (!done.ok) throw new Error(done.error);
    await db!.update(schema.organizations).set({ reviewStatus: "verified" }).where(eq(schema.organizations.id, done.orgId));
    return { orgId: done.orgId, domain: d };
  }
  async function join(adminId: string, userId: string, d: string, r: "admin" | "hiring" | "interviewer", local: string) {
    expect(await inviteMember(adminId, { workEmail: `${local}@${d}`, role: r }, deps())).toEqual({ ok: true });
    const started = await startJoin(userId, { workEmail: `${local}@${d}` }, deps());
    if (!started.ok || !started.testCode) throw new Error("no join code");
    expect(await finishJoin(userId, { workEmail: `${local}@${d}`, code: started.testCode }, deps())).toMatchObject({ ok: true });
    return (await activeMembership(userId, db!))!.memberId;
  }
  /** A verified company with an open job; returns its admin and the job. */
  async function openJob(tag: string, team: { hiring?: string[]; interviewers?: string[] } = {}) {
    const admin = await person(`${tag}-admin`);
    const c = await company(admin);
    const saved = await saveJob(admin, { roleSlug: SLUG, title: "SOC Analyst L1", workType: "full_time", city: "Pune", requirements: req, open: yes, ...team }, deps());
    if (!saved.ok) throw new Error(saved.error);
    return { admin, ...c, jobId: saved.jobId };
  }
  const apply = (userId: string, jobId: string, over: Record<string, unknown> = {}, days = 0) =>
    applyToJob(userId, { jobId, canJoin: "30", consent: true, ...over }, at(days));
  const events = async (applicationId: string) =>
    (await db!.select({ kind: schema.applicationEvents.kind, stage: schema.applicationEvents.stage, note: schema.applicationEvents.note }).from(schema.applicationEvents).where(eq(schema.applicationEvents.applicationId, applicationId)).orderBy(schema.applicationEvents.createdAt));
  const goals = async (userId: string) => db!.select({ skillId: schema.userGoals.skillId, status: schema.userGoals.status }).from(schema.userGoals).where(eq(schema.userGoals.userId, userId));

  it("applies with a consent naming the purpose, the resume sent and a first event; goals stay as they were", async () => {
    const { jobId } = await openJob("apply");
    const me = await candidate("apply-cand");
    const before = await goals(me);
    const r = await apply(me, jobId);
    expect(r).toMatchObject({ ok: true });
    if (!r.ok) return;
    const [row] = await db!.select().from(schema.applications).where(eq(schema.applications.id, r.applicationId));
    expect(row).toMatchObject({ userId: me, jobId, stage: "applied", canJoin: "30", phoneShared: null, withdrawnAt: null, closedAt: null });
    expect(row.resumeId).not.toBeNull();
    const [consent] = await db!.select().from(schema.consents).where(eq(schema.consents.id, row.consentId));
    expect(consent).toMatchObject({ userId: me, purpose: "job_application", withdrawnAt: null });
    expect(await events(r.applicationId)).toEqual([{ kind: "applied", stage: "applied", note: null }]);
    expect(await goals(me)).toEqual(before);
    expect((await applyStates(me, [jobId], { db: db! }))[jobId]).toEqual({ kind: "applied", stage: "applied", withdrawn: false });
    // Once per job.
    expect(await apply(me, jobId)).toMatchObject({ ok: false, error: "already" });
  });

  it("refuses without the consent tick or a resume, and for paused, pending or suspended companies' jobs", async () => {
    const { jobId, orgId } = await openJob("refuse");
    const me = await candidate("refuse-cand");
    expect(await apply(me, jobId, { consent: false })).toMatchObject({ ok: false, error: "invalid" });
    const noResume = await person("refuse-nores");
    expect(await apply(noResume, jobId)).toMatchObject({ ok: false, error: "no_resume" });
    expect((await applyStates(noResume, [jobId], { db: db! }))[jobId]).toEqual({ kind: "no_resume" });
    expect((await applyStates(null, [jobId], { db: db! }))[jobId]).toEqual({ kind: "signed_out" });
    for (const status of ["pending", "suspended"] as const) {
      await db!.update(schema.organizations).set({ reviewStatus: status }).where(eq(schema.organizations.id, orgId));
      expect(await apply(me, jobId)).toMatchObject({ ok: false, error: "not_open" });
    }
    await db!.update(schema.organizations).set({ reviewStatus: "verified" }).where(eq(schema.organizations.id, orgId));
    await db!.update(schema.jobs).set({ status: "paused" }).where(eq(schema.jobs.id, jobId));
    expect(await apply(me, jobId)).toMatchObject({ ok: false, error: "not_open" });
    expect(await db!.select().from(schema.applications).where(eq(schema.applications.jobId, jobId))).toEqual([]);
  });

  it("limits applying per person a day", async () => {
    const { jobId } = await openJob("limit");
    const me = await candidate("limit-cand");
    for (let i = 0; i < LIMITS.applicationsPerUserDay.max; i++) await takeShared(LIMITS.applicationsPerUserDay, me, { db: db!, now: clock.getTime() });
    expect(await apply(me, jobId)).toMatchObject({ ok: false, error: "limit" });
  });

  it("shows the job team a board with the public profile and Match to this job, never email, phone, resume lines or goals", async () => {
    const { admin, jobId } = await openJob("board");
    const me = await candidate("board-cand");
    await db!.insert(schema.gapProofs).values({ userId: me, skillId: "siem", type: "skill_check", status: "accepted", evidence: { type: "skill_check", checkId: "siem-1" } });
    const r = await apply(me, jobId);
    if (!r.ok) throw new Error(r.error);
    const b = await jobBoard(admin, jobId, at());
    expect(b.ok).toBe(true);
    if (!b.ok) return;
    expect(b.board).toMatchObject({ canMove: true, assignedOnly: false, withdrawn: 0, job: { title: "SOC Analyst L1", aiRound: false, company: "Example Labs" } });
    const [card] = b.board.cards;
    expect(card).toMatchObject({ applicationId: r.applicationId, name: "Priya Nair", headline: "Working at Konkan Co-operative Bank", stage: "applied", canJoin: "30" });
    const line = (label: RegExp) => card.match.lines.find((l) => label.test(l.label))?.state;
    expect(line(/^SIEM/)).toBe("proved");
    expect(line(/^Linux/)).toBe("on_resume");
    expect(line(/^AWS/)).toBe("not_on_resume");
    const opened = await openCandidate(admin, { applicationId: r.applicationId }, at());
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    expect(opened.candidate.profile.experience).toEqual([{ title: "IT support analyst", employer: "Konkan Co-operative Bank", dates: expect.any(String) }]);
    const text = JSON.stringify([b, opened]);
    for (const hidden of [HIGHLIGHT, `${run}-board-cand`, "@example.test", "goal", "notice", "phone"]) expect(text).not.toContain(hidden);
    // Each opening leaves one audit line: who and which application, nothing of the person.
    const audit = await db!.select().from(schema.auditLogs).where(eq(schema.auditLogs.target, `application:${r.applicationId}`));
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ action: "candidate_viewed", actor: expect.stringMatching(/^member:/) });
    // Corporate's Jobs list counts it.
    const home = await corporateHome(admin, { db: db!, now: clock });
    expect(home!.jobs.items.find((j) => j.id === jobId)?.applications).toBe(1);
  });

  it("moves through the lanes with an event each time; Not this time needs a note and shows on Arrivals; the AI lane stays shut", async () => {
    const { admin, jobId } = await openJob("move");
    const me = await candidate("move-cand");
    const r = await apply(me, jobId);
    if (!r.ok) throw new Error(r.error);
    const id = r.applicationId;
    expect(await moveApplication(admin, { applicationId: id, to: "shortlisted" }, at(1))).toEqual({ ok: true });
    expect(await moveApplication(admin, { applicationId: id, to: "shortlisted" }, at(1))).toMatchObject({ ok: false, error: "same_stage" });
    expect(await moveApplication(admin, { applicationId: id, to: "ai" }, at(1))).toMatchObject({ ok: false, error: "ai_off" });
    expect(await moveApplication(admin, { applicationId: id, to: "not_this_time" }, at(2))).toMatchObject({ ok: false, error: "invalid" });
    expect(await moveApplication(admin, { applicationId: id, to: "not_this_time", note: NOTE }, at(2))).toEqual({ ok: true });
    const [row] = await db!.select().from(schema.applications).where(eq(schema.applications.id, id));
    expect(row.stage).toBe("not_this_time");
    expect(row.closedAt?.toISOString()).toBe(new Date(clock.getTime() + 2 * DAY).toISOString());
    expect(await events(id)).toEqual([
      { kind: "applied", stage: "applied", note: null },
      { kind: "moved", stage: "shortlisted", note: null },
      { kind: "moved", stage: "not_this_time", note: NOTE },
    ]);
    const mine = await myApplications(me, { db: db! });
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ title: "SOC Analyst L1", company: "Example Labs", stage: "not_this_time", withdrawn: false });
    expect(mine[0].events.at(-1)).toEqual({ kind: "moved", stage: "not_this_time", on: "2026-10-15", note: NOTE });
    expect(JSON.stringify(mine)).not.toContain("Meera");
    // Opening it again clears the close date.
    expect(await moveApplication(admin, { applicationId: id, to: "applied" }, at(3))).toEqual({ ok: true });
    expect((await db!.select().from(schema.applications).where(eq(schema.applications.id, id)))[0].closedAt).toBeNull();
    // Moving never touches goals.
    expect(await goals(me)).toEqual([{ skillId: "aws", status: "active" }]);
  });

  it("lets Hiring HR on the job move candidates, keeps Hiring HR off other jobs, and Interviewers see no one and move no one", async () => {
    const admin = await person("acc-admin");
    const { domain: d } = await company(admin);
    const hr = await person("acc-hr", "Rahul Menon");
    const otherHr = await person("acc-hr2", "Farhan Shaikh");
    const iv = await person("acc-iv", "Sana Qureshi");
    const hrMember = await join(admin, hr, d, "hiring", "rahul");
    await join(admin, otherHr, d, "hiring", "farhan");
    const ivMember = await join(admin, iv, d, "interviewer", "sana");
    const saved = await saveJob(admin, { roleSlug: SLUG, title: "SOC Analyst L1", workType: "full_time", city: "Pune", requirements: req, open: yes, hiring: [hrMember], interviewers: [ivMember] }, deps());
    if (!saved.ok) throw new Error(saved.error);
    const me = await candidate("acc-cand");
    const r = await apply(me, saved.jobId);
    if (!r.ok) throw new Error(r.error);
    const id = r.applicationId;

    expect(await moveApplication(hr, { applicationId: id, to: "shortlisted" }, at())).toEqual({ ok: true });
    expect(await jobBoard(otherHr, saved.jobId, at())).toMatchObject({ ok: false, error: "not_allowed" });
    expect(await moveApplication(otherHr, { applicationId: id, to: "team" }, at())).toMatchObject({ ok: false, error: "not_allowed" });
    expect(await openCandidate(otherHr, { applicationId: id }, at())).toMatchObject({ ok: false, error: "not_allowed" });

    const ivBoard = await jobBoard(iv, saved.jobId, at());
    expect(ivBoard).toMatchObject({ ok: true, board: { canMove: false, assignedOnly: true, cards: [], withdrawn: 0 } });
    expect(await moveApplication(iv, { applicationId: id, to: "team" }, at())).toMatchObject({ ok: false });
    expect(await openCandidate(iv, { applicationId: id }, at())).toMatchObject({ ok: false, error: "not_found" });
    const ivHome = await corporateHome(iv, { db: db!, now: clock });
    expect(ivHome!.jobs.items.find((j) => j.id === saved.jobId)?.applications).toBeNull();

    // Removing the role ends access on the next request.
    expect(await removeMember(admin, { memberId: hrMember }, deps())).toEqual({ ok: true });
    expect(await jobBoard(hr, saved.jobId, at())).toMatchObject({ ok: false, error: "not_member" });
    expect(await moveApplication(hr, { applicationId: id, to: "team" }, at())).toMatchObject({ ok: false, error: "not_member" });
    expect((await db!.select().from(schema.applications).where(eq(schema.applications.id, id)))[0].stage).toBe("shortlisted");
  });

  it("an employee applying to their own company's job leaves its team and never sees their own application there", async () => {
    const admin = await person("own-admin");
    const { domain: d } = await company(admin);
    const hr = await candidate("own-hr", "Rahul Menon");
    const hrMember = await join(admin, hr, d, "hiring", "rahul");
    const saved = await saveJob(admin, { roleSlug: SLUG, title: "SOC Analyst L1", workType: "full_time", city: "Pune", requirements: req, open: yes, hiring: [hrMember] }, deps());
    if (!saved.ok) throw new Error(saved.error);
    const r = await apply(hr, saved.jobId);
    if (!r.ok) throw new Error(r.error);
    expect(await db!.select().from(schema.jobTeam).where(and(eq(schema.jobTeam.jobId, saved.jobId), eq(schema.jobTeam.userId, hr)))).toEqual([]);
    expect(await jobBoard(hr, saved.jobId, at())).toMatchObject({ ok: false, error: "not_allowed" });
    // An admin applying sees the board without their own card.
    const admin2 = await candidate("own2-admin", "Meera Iyer");
    await company(admin2);
    const job2 = await saveJob(admin2, { roleSlug: SLUG, title: "SOC Analyst L1", workType: "full_time", city: "Pune", requirements: req, open: yes }, deps());
    if (!job2.ok) throw new Error(job2.error);
    const r2 = await apply(admin2, job2.jobId);
    if (!r2.ok) throw new Error(r2.error);
    expect(await jobBoard(admin2, job2.jobId, at())).toMatchObject({ ok: true, board: { cards: [] } });
    expect(await openCandidate(admin2, { applicationId: r2.applicationId }, at())).toMatchObject({ ok: false, error: "not_found" });
    expect(await moveApplication(admin2, { applicationId: r2.applicationId, to: "offer" }, at())).toMatchObject({ ok: false, error: "not_found" });
  });

  it("withdrawing closes the application, withdraws its consent, and the company sees only a count", async () => {
    const { admin, jobId } = await openJob("withdraw");
    const me = await candidate("withdraw-cand");
    const r = await apply(me, jobId);
    if (!r.ok) throw new Error(r.error);
    expect(await withdrawApplication(me, { applicationId: r.applicationId }, at(1))).toEqual({ ok: true });
    const [row] = await db!.select().from(schema.applications).where(eq(schema.applications.id, r.applicationId));
    expect(row.withdrawnAt).not.toBeNull();
    expect(row.closedAt).not.toBeNull();
    const [consent] = await db!.select().from(schema.consents).where(eq(schema.consents.id, row.consentId));
    expect(consent.withdrawnAt).not.toBeNull();
    const b = await jobBoard(admin, jobId, at(1));
    expect(b).toMatchObject({ ok: true, board: { cards: [], withdrawn: 1 } });
    // The company learns nothing about a withdrawn application beyond the count: it reads as not there.
    expect(await openCandidate(admin, { applicationId: r.applicationId }, at(1))).toMatchObject({ ok: false, error: "not_found" });
    expect(await moveApplication(admin, { applicationId: r.applicationId, to: "shortlisted" }, at(1))).toMatchObject({ ok: false, error: "not_found" });
    // Someone else can't withdraw it.
    const other = await person("withdraw-other");
    expect(await withdrawApplication(other, { applicationId: r.applicationId }, at(1))).toMatchObject({ ok: false, error: "not_found" });
  });

  it("lets the candidate withdraw after Not this time, and the company can't open it again", async () => {
    const { admin, jobId } = await openJob("withdraw-closed");
    const me = await candidate("withdraw-closed-cand");
    const r = await apply(me, jobId);
    if (!r.ok) throw new Error(r.error);
    expect(await moveApplication(admin, { applicationId: r.applicationId, to: "not_this_time", note: NOTE }, at(1))).toEqual({ ok: true });
    expect(await withdrawApplication(me, { applicationId: r.applicationId }, at(2))).toEqual({ ok: true });
    const [row] = await db!.select().from(schema.applications).where(eq(schema.applications.id, r.applicationId));
    expect(row.withdrawnAt).not.toBeNull();
    // The close date stays the company's Not this time.
    expect(row.closedAt?.toISOString()).toBe(new Date(clock.getTime() + DAY).toISOString());
    const [consent] = await db!.select().from(schema.consents).where(eq(schema.consents.id, row.consentId));
    expect(consent.withdrawnAt).not.toBeNull();
    expect(await moveApplication(admin, { applicationId: r.applicationId, to: "applied" }, at(3))).toMatchObject({ ok: false, error: "not_found" });
    expect(await jobBoard(admin, jobId, at(3))).toMatchObject({ ok: true, board: { cards: [], withdrawn: 1 } });
    const mine = await myApplications(me, { db: db! });
    expect(mine[0]).toMatchObject({ stage: "not_this_time", withdrawn: true });
    expect(mine[0].events.map((e) => e.kind)).toEqual(["applied", "moved", "withdrawn"]);
  });

  it("on a closed job, allows only Not this time", async () => {
    const { admin, jobId } = await openJob("closed-job");
    const me = await candidate("closed-job-cand");
    const r = await apply(me, jobId);
    if (!r.ok) throw new Error(r.error);
    await db!.update(schema.jobs).set({ status: "closed", closedAt: clock }).where(eq(schema.jobs.id, jobId));
    expect(await moveApplication(admin, { applicationId: r.applicationId, to: "shortlisted" }, at())).toMatchObject({ ok: false, error: "job_closed" });
    expect(await moveApplication(admin, { applicationId: r.applicationId, to: "not_this_time", note: NOTE }, at())).toEqual({ ok: true });
    expect(await moveApplication(admin, { applicationId: r.applicationId, to: "applied" }, at())).toMatchObject({ ok: false, error: "job_closed" });
  });

  it("refuses a Not this time event without a note in the database too", async () => {
    const { jobId } = await openJob("db-note");
    const me = await candidate("db-note-cand");
    const r = await apply(me, jobId);
    if (!r.ok) throw new Error(r.error);
    await expect(db!.insert(schema.applicationEvents).values({ applicationId: r.applicationId, kind: "moved", stage: "not_this_time", note: null })).rejects.toThrow();
    await expect(db!.insert(schema.applicationEvents).values({ applicationId: r.applicationId, kind: "moved", stage: "not_this_time", note: "short" })).rejects.toThrow();
  });

  it("ends the company's view 180 days after Not this time", async () => {
    const { admin, jobId } = await openJob("access");
    const me = await candidate("access-cand");
    const r = await apply(me, jobId);
    if (!r.ok) throw new Error(r.error);
    expect(await moveApplication(admin, { applicationId: r.applicationId, to: "not_this_time", note: NOTE }, at())).toEqual({ ok: true });
    const soon = await jobBoard(admin, jobId, at(179));
    expect(soon.ok && soon.board.cards.length).toBe(1);
    const later = await jobBoard(admin, jobId, at(181));
    expect(later.ok && later.board.cards.length).toBe(0);
    expect(await openCandidate(admin, { applicationId: r.applicationId }, at(181))).toMatchObject({ ok: false, error: "not_found" });
  });

  it("puts the person's applications and every step in Download your data", async () => {
    const { admin, jobId } = await openJob("export");
    const me = await candidate("export-cand");
    const r = await apply(me, jobId);
    if (!r.ok) throw new Error(r.error);
    await moveApplication(admin, { applicationId: r.applicationId, to: "not_this_time", note: NOTE }, at(1));
    const data = await exportAccountData(me, db!, clock);
    expect(EXPORT_VERSION).toBe(8);
    expect(data!.exportVersion).toBe(8);
    expect(data!.applications).toHaveLength(1);
    expect(data!.applications[0]).toMatchObject({ company: "Example Labs", job: "SOC Analyst L1", stage: "not_this_time", canJoin: "Within 30 days" });
    expect(data!.applications[0].events.map((e) => [e.kind, e.stage, e.note])).toEqual([
      ["applied", "applied", null],
      ["moved", "not_this_time", NOTE],
    ]);
    // The company's side of the download holds nothing of the candidate.
    const adminData = await exportAccountData(admin, db!, clock);
    expect(adminData!.applications).toEqual([]);
  });
});
