import { and, eq, inArray, like } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "@/db/schema";
import { EXPORT_VERSION, exportAccountData } from "@/lib/account/export";
import { requirementsFromRole, roleBySlug } from "./job-content";
import { companyJobs, exportJobs, jobForm, liveJobs, reportJob, saveJob, setJobStatus } from "./jobs-store";
import { activeMembership, corporateHome, finishCompanySignup, finishJoin, inviteMember, removeMember, startCompanySignup, startJoin, type CorporateDeps } from "./store";

vi.mock("server-only", () => ({}));

// Corporate jobs (dev/corporate-plan.md, build step 3) against a real Postgres with migrations applied.
const url = process.env.TEST_DATABASE_URL;
const sqlClient = url ? postgres(url, { max: 4, onnotice: () => {} }) : null;
const db = sqlClient ? drizzle(sqlClient, { schema }) : null;
const env = { NAME_HASH_KEY: "test-key" };
const DAY = 86_400_000;

describe.skipIf(!db)("corporate jobs store (database)", () => {
  const run = `jobs${Date.now()}`;
  const userIds: string[] = [];
  const clock = new Date("2026-10-13T10:00:00Z");
  const deps = (over: Partial<CorporateDeps> = {}): CorporateDeps => ({ db: db!, env, now: clock, delivery: "test", ...over });
  const lines: string[] = [];
  /** A role_profiles row this test added because the database wasn't seeded; removed at the end. */
  let addedRoleRow: string | null = null;
  const SLUG = "cyber-security-analyst";
  const role = roleBySlug(SLUG)!;
  const req = requirementsFromRole(role);
  const yes = { real: true, noFee: true, fair: true } as const;

  beforeAll(async () => {
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
    if (userIds.length) {
      await db!.delete(schema.reports).where(inArray(schema.reports.reporterId, userIds));
      await db!.delete(schema.users).where(inArray(schema.users.id, userIds));
    }
    if (addedRoleRow) await db!.delete(schema.roleProfiles).where(eq(schema.roleProfiles.id, addedRoleRow));
    await sqlClient!.end();
  });

  async function person(n: string, name = "Meera Iyer") {
    const [u] = await db!.insert(schema.users).values({ email: `${run}-${n}@example.test`, name }).returning({ id: schema.users.id });
    userIds.push(u.id);
    return u.id;
  }
  let n = 0;
  const domain = () => `${run}-${++n}.example-labs.test`;
  const details = (d: string) => ({ type: "company", legalName: "Example Labs Private Limited", name: "Example Labs", website: `https://${d}`, workEmail: `meera.iyer@${d}`, size: "51 to 200", city: "Pune" });

  /** A company with `admin` as first admin, verified unless told otherwise. */
  async function company(admin: string, status: "pending" | "verified" | "suspended" = "verified") {
    const d = domain();
    const started = await startCompanySignup(admin, details(d), deps());
    if (!started.ok || !started.testCode) throw new Error("no code");
    const done = await finishCompanySignup(admin, { details: details(d), code: started.testCode }, deps());
    if (!done.ok) throw new Error(done.error);
    await db!.update(schema.organizations).set({ reviewStatus: status }).where(eq(schema.organizations.id, done.orgId));
    return { orgId: done.orgId, domain: d };
  }
  async function join(adminId: string, userId: string, d: string, role: "admin" | "hiring" | "interviewer", local: string) {
    expect(await inviteMember(adminId, { workEmail: `${local}@${d}`, role }, deps())).toEqual({ ok: true });
    const started = await startJoin(userId, { workEmail: `${local}@${d}` }, deps());
    if (!started.ok || !started.testCode) throw new Error("no join code");
    expect(await finishJoin(userId, { workEmail: `${local}@${d}`, code: started.testCode }, deps())).toMatchObject({ ok: true });
    return (await activeMembership(userId, db!))!.memberId;
  }
  const job = (over: Record<string, unknown> = {}) => ({ roleSlug: SLUG, title: "SOC Analyst L1", workType: "full_time", city: "Pune", requirements: req, ...over });
  const jobRow = async (id: string) => (await db!.select().from(schema.jobs).where(eq(schema.jobs.id, id)))[0];
  const team = async (id: string) => db!.select({ userId: schema.jobTeam.userId, role: schema.jobTeam.role }).from(schema.jobTeam).where(eq(schema.jobTeam.jobId, id));
  const audits = async (id: string) => (await db!.select({ action: schema.auditLogs.action }).from(schema.auditLogs).where(eq(schema.auditLogs.target, `job:${id}`))).map((a) => a.action).sort();

  it("saves a draft from a role profile, with its owner on the team and the AI round off", async () => {
    const admin = await person("draft-admin");
    await company(admin);
    const saved = await saveJob(admin, job(), deps());
    expect(saved).toMatchObject({ ok: true, status: "draft" });
    if (!saved.ok) return;
    const row = await jobRow(saved.jobId);
    expect(row).toMatchObject({ ownerId: admin, status: "draft", aiRound: false, title: "SOC Analyst L1", workType: "full_time", track: null, closedAt: null });
    expect(row.requirements).toEqual(req);
    expect(await team(saved.jobId)).toEqual([{ userId: admin, role: "owner" }]);
    // A draft is never seen by candidates.
    expect((await liveJobs({ db: db! })).some((j) => j.id === saved.jobId)).toBe(false);
  });

  it("refuses skills outside our taxonomy and unknown role profiles", async () => {
    const admin = await person("taxonomy");
    await company(admin);
    expect(await saveJob(admin, job({ requirements: { ...req, nice: ["made-up-skill"] } }), deps())).toMatchObject({ ok: false, error: "unknown_skill" });
    expect(await saveJob(admin, job({ roleSlug: "astronaut" }), deps())).toMatchObject({ ok: false, error: "unknown_role" });
  });

  it("opens a job with the three ticks, writes an audit line, and shows it on Departures with no member or email", async () => {
    const admin = await person("open-admin");
    const { domain: d } = await company(admin);
    const saved = await saveJob(admin, job({ open: yes }), deps());
    expect(saved).toMatchObject({ ok: true, status: "open" });
    if (!saved.ok) return;
    expect(await audits(saved.jobId)).toEqual(["job_opened"]);
    const live = (await liveJobs({ db: db! })).find((j) => j.id === saved.jobId);
    expect(live).toMatchObject({ title: "SOC Analyst L1", company: "Example Labs", city: "Pune", workType: "full_time" });
    expect(live!.required.length).toBe(req.required.length);
    const text = JSON.stringify(live);
    expect(text).not.toContain(d);
    expect(text).not.toContain("Meera");
    expect(text).not.toContain(admin);
  });

  it("won't open a job without a required skill", async () => {
    const admin = await person("noreq");
    await company(admin);
    expect(await saveJob(admin, job({ requirements: { ...req, required: [] }, open: yes }), deps())).toMatchObject({ ok: false, error: "needs_required" });
  });

  it("won't open jobs for a company waiting for verification or suspended, and says why", async () => {
    const a = await person("pending");
    await company(a, "pending");
    const r = await saveJob(a, job({ open: yes }), deps());
    expect(r).toMatchObject({ ok: false, error: "pending" });
    // The draft itself can still be saved.
    expect(await saveJob(a, job(), deps())).toMatchObject({ ok: true, status: "draft" });
    const home = await corporateHome(a, { db: db!, now: clock });
    expect(home!.jobs.blocked).toBe("pending");

    const s = await person("suspended");
    await company(s, "suspended");
    expect(await saveJob(s, job({ open: yes }), deps())).toMatchObject({ ok: false, error: "suspended" });
  });

  it("won't open a job after 14 days with one admin, but keeps jobs already open", async () => {
    const admin = await person("late");
    await company(admin);
    const early = await saveJob(admin, job({ open: yes }), deps());
    if (!early.ok) throw new Error("not opened");
    const later = deps({ now: new Date(clock.getTime() + 15 * DAY) });
    expect(await saveJob(admin, job({ open: yes }), later)).toMatchObject({ ok: false, error: "second_admin" });
    expect((await liveJobs({ db: db! })).some((j) => j.id === early.jobId)).toBe(true);
  });

  it("hides a suspended company's open jobs and refuses to open them again", async () => {
    const admin = await person("susp-open");
    const { orgId } = await company(admin);
    const saved = await saveJob(admin, job({ open: yes }), deps());
    if (!saved.ok) throw new Error("not opened");
    await db!.update(schema.organizations).set({ reviewStatus: "suspended" }).where(eq(schema.organizations.id, orgId));
    expect((await liveJobs({ db: db! })).some((j) => j.id === saved.jobId)).toBe(false);
    const home = await corporateHome(admin, { db: db!, now: clock });
    expect(home!.jobs.items[0]).toMatchObject({ status: "open", live: false });
    expect(await setJobStatus(admin, { jobId: saved.jobId, to: "paused" }, deps())).toEqual({ ok: true });
    expect(await setJobStatus(admin, { jobId: saved.jobId, to: "open" }, deps())).toMatchObject({ ok: false, error: "suspended" });
  });

  it("pauses, opens again and closes a job, with an audit line each, and never moves a closed job", async () => {
    const admin = await person("moves");
    await company(admin);
    const saved = await saveJob(admin, job({ open: yes }), deps());
    if (!saved.ok) throw new Error("not opened");
    const id = saved.jobId;
    expect(await setJobStatus(admin, { jobId: id, to: "paused" }, deps())).toEqual({ ok: true });
    expect((await liveJobs({ db: db! })).some((j) => j.id === id)).toBe(false);
    expect(await setJobStatus(admin, { jobId: id, to: "open" }, deps())).toEqual({ ok: true });
    expect(await setJobStatus(admin, { jobId: id, to: "closed" }, deps())).toEqual({ ok: true });
    expect((await jobRow(id)).closedAt).toEqual(clock);
    expect(await setJobStatus(admin, { jobId: id, to: "open" }, deps())).toMatchObject({ ok: false, error: "bad_move" });
    expect(await saveJob(admin, job({ jobId: id, title: "Changed" }), deps())).toMatchObject({ ok: false, error: "bad_move" });
    expect(await audits(id)).toEqual(["job_closed", "job_opened", "job_opened", "job_paused"]);
    // Nothing personal in the logs: event names and reasons only.
    expect(lines.join("\n")).not.toMatch(/SOC Analyst|Pune|@/);
  });

  it("opens a draft only from the form, with the ticks", async () => {
    const admin = await person("draft-open");
    await company(admin);
    const saved = await saveJob(admin, job(), deps());
    if (!saved.ok) throw new Error("not saved");
    expect(await setJobStatus(admin, { jobId: saved.jobId, to: "open" }, deps())).toMatchObject({ ok: false, error: "open_from_form" });
    expect(await saveJob(admin, job({ jobId: saved.jobId, open: yes }), deps())).toMatchObject({ ok: true, status: "open" });
  });

  it("puts chosen colleagues on the team, refuses people outside the company, and keeps Interviewers out of Hiring HR", async () => {
    const admin = await person("team-admin");
    const hr = await person("team-hr", "Rahul Menon");
    const iv = await person("team-iv", "Sana Qureshi");
    const outsider = await person("team-out");
    const { domain: d } = await company(admin);
    const hrMember = await join(admin, hr, d, "hiring", "rahul");
    const ivMember = await join(admin, iv, d, "interviewer", "sana");
    await company(outsider);
    const outsiderMember = (await activeMembership(outsider, db!))!.memberId;

    const saved = await saveJob(admin, job({ hiring: [hrMember], interviewers: [ivMember] }), deps());
    if (!saved.ok) throw new Error("not saved");
    expect((await team(saved.jobId)).sort((a, b) => a.role.localeCompare(b.role))).toEqual([
      { userId: hr, role: "hiring" },
      { userId: iv, role: "interviewer" },
      { userId: admin, role: "owner" },
    ]);
    expect(await saveJob(admin, job({ interviewers: [outsiderMember] }), deps())).toMatchObject({ ok: false, error: "not_colleague" });
    expect(await saveJob(admin, job({ hiring: [ivMember] }), deps())).toMatchObject({ ok: false, error: "not_colleague" });

    // The form lists colleagues by name and role, and the job's team as member ids.
    const form = await jobForm(admin, saved.jobId, { db: db!, now: clock });
    if (!form.ok) throw new Error(form.error);
    expect(form.data.colleagues.map((c) => c.name).sort()).toEqual(["Rahul Menon", "Sana Qureshi"]);
    expect(form.values).toMatchObject({ hiring: [hrMember], interviewers: [ivMember], roleSlug: SLUG, status: "draft" });
    expect(JSON.stringify(form)).not.toContain("@");
  });

  it("keeps Interviewers from creating or editing jobs, and Hiring HR to jobs they are on", async () => {
    const admin = await person("acc-admin");
    const hr = await person("acc-hr", "Rahul Menon");
    const hr2 = await person("acc-hr2", "Farhan Shaikh");
    const iv = await person("acc-iv", "Sana Qureshi");
    const { domain: d } = await company(admin);
    const hrMember = await join(admin, hr, d, "hiring", "rahul");
    await join(admin, hr2, d, "hiring", "farhan");
    const ivMember = await join(admin, iv, d, "interviewer", "sana");

    expect(await saveJob(iv, job(), deps())).toMatchObject({ ok: false, error: "not_allowed" });
    expect(await jobForm(iv, null, { db: db!, now: clock })).toMatchObject({ ok: false, error: "not_allowed" });

    const saved = await saveJob(admin, job({ hiring: [hrMember], interviewers: [ivMember] }), deps());
    if (!saved.ok) throw new Error("not saved");
    // Hiring HR on the job can change it; another Hiring HR can't, nor can the job's interviewer.
    // The form sends the whole team each time; the person editing keeps their own place.
    expect(await saveJob(hr, job({ jobId: saved.jobId, title: "SOC Analyst (L1)", interviewers: [ivMember] }), deps())).toMatchObject({ ok: true });
    expect((await team(saved.jobId)).map((t) => t.role).sort()).toEqual(["hiring", "interviewer", "owner"]);
    expect(await saveJob(hr2, job({ jobId: saved.jobId, title: "Nope" }), deps())).toMatchObject({ ok: false, error: "not_allowed" });
    expect(await setJobStatus(hr2, { jobId: saved.jobId, to: "closed" }, deps())).toMatchObject({ ok: false, error: "not_allowed" });
    expect(await setJobStatus(iv, { jobId: saved.jobId, to: "closed" }, deps())).toMatchObject({ ok: false, error: "not_allowed" });

    // Hiring HR's own job: they are its owner.
    const own = await saveJob(hr2, job(), deps());
    expect(own).toMatchObject({ ok: true });

    // Lists: admins see every job; others only jobs they are on.
    const me = (u: string) => corporateHome(u, { db: db!, now: clock });
    expect((await me(admin))!.jobs.items.length).toBe(2);
    expect((await me(hr2))!.jobs.items.map((j) => j.title)).toEqual(["SOC Analyst L1"]);
    expect((await me(iv))!.jobs).toMatchObject({ canPost: false });
    expect((await me(iv))!.jobs.items.map((j) => ({ title: j.title, canEdit: j.canEdit, myRole: j.myRole }))).toEqual([{ title: "SOC Analyst (L1)", canEdit: false, myRole: "interviewer" }]);

    // Removing the role ends it on the next request.
    const hrRow = await db!.select({ id: schema.orgMembers.id }).from(schema.orgMembers).where(and(eq(schema.orgMembers.userId, hr)));
    expect(await removeMember(admin, { memberId: hrRow[0].id }, deps())).toEqual({ ok: true });
    expect(await saveJob(hr, job({ jobId: saved.jobId, title: "After removal" }), deps())).toMatchObject({ ok: false, error: "not_member" });
    // They leave the job's team too, so being added again later brings back no rights on it.
    expect((await team(saved.jobId)).map((t) => t.role).sort()).toEqual(["interviewer", "owner"]);
  });

  it("keeps a required skill on an open job and notes each edit to it", async () => {
    const admin = await person("edit-open");
    await company(admin);
    const saved = await saveJob(admin, job({ open: yes }), deps());
    if (!saved.ok) throw new Error("not saved");
    expect(await saveJob(admin, job({ jobId: saved.jobId, requirements: { ...req, required: [] } }), deps())).toMatchObject({ ok: false, error: "needs_required" });
    expect((await jobRow(saved.jobId)).requirements).toEqual(req);
    expect(await saveJob(admin, job({ jobId: saved.jobId, title: "SOC Analyst (L1)" }), deps())).toMatchObject({ ok: true, status: "open" });
    expect(await audits(saved.jobId)).toEqual(["job_edited", "job_opened"]);
    // A draft's edits are nobody else's business yet.
    const draft = await saveJob(admin, job(), deps());
    if (!draft.ok) throw new Error("not saved");
    expect(await saveJob(admin, job({ jobId: draft.jobId, title: "Draft two" }), deps())).toMatchObject({ ok: true });
    expect(await audits(draft.jobId)).toEqual([]);
  });

  it("can't touch another company's job", async () => {
    const a = await person("co-a");
    const b = await person("co-b");
    await company(a);
    await company(b);
    const saved = await saveJob(a, job(), deps());
    if (!saved.ok) throw new Error("not saved");
    expect(await saveJob(b, job({ jobId: saved.jobId }), deps())).toMatchObject({ ok: false, error: "not_found" });
    expect(await setJobStatus(b, { jobId: saved.jobId, to: "closed" }, deps())).toMatchObject({ ok: false, error: "not_found" });
    expect(await jobForm(b, saved.jobId, { db: db!, now: clock })).toMatchObject({ ok: false, error: "not_found" });
  });

  it("limits new jobs to 20 a day per company", async () => {
    const admin = await person("limit");
    await company(admin);
    for (let i = 0; i < 20; i++) expect(await saveJob(admin, job(), deps())).toMatchObject({ ok: true });
    expect(await saveJob(admin, job(), deps())).toMatchObject({ ok: false, error: "limit" });
  });

  it("counts jobs by status for the Jobs list", async () => {
    const admin = await person("counts");
    const { orgId } = await company(admin);
    const a = await saveJob(admin, job({ open: yes }), deps());
    await saveJob(admin, job(), deps());
    if (!a.ok) throw new Error("x");
    await setJobStatus(admin, { jobId: a.jobId, to: "paused" }, deps());
    const me = (await activeMembership(admin, db!))!;
    const view = await companyJobs(admin, me, { orgId, reviewStatus: "verified", adminCount: 1, secondAdminDueAt: new Date(clock.getTime() + 14 * DAY) }, db!, clock);
    expect(view.counts).toEqual({ draft: 1, open: 0, paused: 1, closed: 0 });
    expect(view.canPost).toBe(true);
    expect(view.blocked).toBeNull();
  });

  it("files a report on a live job into the reports queue, once per person", async () => {
    const admin = await person("rep-admin");
    const reporter = await person("rep-user", "Priya Nair");
    await company(admin);
    const saved = await saveJob(admin, job({ open: yes }), deps());
    if (!saved.ok) throw new Error("x");
    expect(await reportJob(reporter, { jobId: saved.jobId, reason: "money_or_otp", note: "Asked for a deposit" }, deps())).toEqual({ ok: true });
    expect(await reportJob(reporter, { jobId: saved.jobId, reason: "money_or_otp" }, deps())).toEqual({ ok: true });
    const rows = await db!.select().from(schema.reports).where(and(eq(schema.reports.reporterId, reporter), eq(schema.reports.targetId, saved.jobId)));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ target: "job", reason: "money_or_otp", status: "open" });
    expect(lines.join("\n")).not.toContain("deposit");
    // A paused job isn't shown, so it can't be reported from Departures.
    await setJobStatus(admin, { jobId: saved.jobId, to: "paused" }, deps());
    expect(await reportJob(reporter, { jobId: saved.jobId, reason: "other" }, deps())).toMatchObject({ ok: false, error: "not_found" });
  });

  it("puts jobs the person owns in Download your data, and keeps the job when the owner's account goes", async () => {
    const admin = await person("export");
    await company(admin);
    const saved = await saveJob(admin, job({ open: yes }), deps());
    if (!saved.ok) throw new Error("x");
    const owned = await exportJobs(admin, db!);
    expect(owned).toEqual([expect.objectContaining({ company: "Example Labs", title: "SOC Analyst L1", role: SLUG, status: "open", workType: "Full time" })]);
    const data = await exportAccountData(admin, db!, clock);
    expect(data!.exportVersion).toBe(EXPORT_VERSION);
    expect(data!.jobsOwned).toHaveLength(1);
    await db!.delete(schema.users).where(eq(schema.users.id, admin));
    expect(await jobRow(saved.jobId)).toMatchObject({ ownerId: null });
  });
});
