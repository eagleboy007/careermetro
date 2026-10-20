import { eq, inArray, like } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { roleProfiles, skills } from "@/content";
import * as schema from "@/db/schema";
import { purgeDeletedAccounts, requestDeletion } from "@/lib/account/delete";
import { exportAccountData } from "@/lib/account/export";
import { MATCHER_VERSION } from "@/lib/gaps/match";
import type { GapAnalysis, Profile } from "@/lib/schemas";
import { setJobSearch } from "@/lib/job-search/store";
import { APPLICATION_ERROR_TEXT, applyPreview, applyToJob, criteriaStates, openCandidate, withdrawApplication } from "./applications-store";
import { requirementsFromRole, roleBySlug } from "./job-content";
import { jobForm, liveJobs, saveJob } from "./jobs-store";
import { finishCompanySignup, startCompanySignup, type CorporateDeps } from "./store";

vi.mock("server-only", () => ({}));

// Express apply (pending item 16; dev/express-apply-plan.md) against a real Postgres with migrations applied: the job's
// criteria, the preview, the note and what the company's drawer shows. Every person and resume here is made up.
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
  certifications: [{ name: "CompTIA Security+", earned: null, expires: null }],
};
// A gap the person has: it must never reach the company.
const GAP_TEXT = "No AWS on the resume yet";
const analysis: GapAnalysis = {
  roleSlug: roleProfiles[0].slug,
  gaps: [{ skillId: "aws", skillName: "AWS", status: "missing", resumeQuote: null, requirement: "r", explanation: GAP_TEXT }],
  metSkillIds: ["linux"],
  niceToHave: [],
  readiness: { headline: "h", explanation: "e", estimatedHours: 10 },
};
const NOTE = "I triage about forty SIEM alerts a week at the bank.\n\nHappy to walk through one.";

describe.skipIf(!db)("Express apply (database)", () => {
  const run = `express${Date.now()}`;
  const userIds: string[] = [];
  const clock = new Date("2026-10-13T10:00:00Z");
  const deps = (over: Partial<CorporateDeps> = {}): CorporateDeps => ({ db: db!, env, now: clock, delivery: "test", ...over });
  const at = (days = 0) => ({ db: db!, now: new Date(clock.getTime() + days * DAY) });
  const lines: string[] = [];
  const SLUG = "cyber-security-analyst";
  const role = roleBySlug(SLUG)!;
  const req = requirementsFromRole(role);
  const yes = { real: true, noFee: true, fair: true } as const;
  const verified = req.required.includes("siem") ? "siem" : req.required[0];
  const criteria = { verifiedSkills: [verified], certificates: ["comptia-security-plus", "sc-200"] };

  beforeAll(async () => {
    await db!
      .insert(schema.skills)
      .values(skills.map(({ id, name, category }) => ({ id, name, category })))
      .onConflictDoNothing();
    await db!.insert(schema.roleProfiles).values({ slug: SLUG, version: 1, data: role, published: false, updatedOn: role.updatedOn }).onConflictDoNothing();
  });
  beforeEach(() => {
    for (const level of ["log", "warn", "error"] as const) vi.spyOn(console, level).mockImplementation((line: unknown) => void lines.push(String(line)));
  });
  afterEach(() => vi.restoreAllMocks());
  afterAll(async () => {
    await db!.delete(schema.organizations).where(like(schema.organizations.emailDomain, `%${run}%`));
    if (userIds.length) await db!.delete(schema.users).where(inArray(schema.users.id, userIds));
    await sqlClient!.end();
    // Logs carry event names and reasons only: never a name, the note or a resume line.
    const all = lines.join("\n");
    expect(all).not.toContain("Priya");
    expect(all).not.toContain("forty SIEM alerts");
    expect(all).not.toContain("branches");
  });

  async function person(n: string, name = "Meera Iyer") {
    const [u] = await db!.insert(schema.users).values({ email: `${run}-${n}@example.test`, name }).returning({ id: schema.users.id });
    userIds.push(u.id);
    return u.id;
  }
  async function candidate(n: string) {
    const id = await person(n, "Priya Nair");
    const [resume] = await db!.insert(schema.resumes).values({ userId: id, mimeType: "text/plain", sizeBytes: 1, status: "parsed" }).returning();
    const [p] = await db!.insert(schema.profiles).values({ resumeId: resume.id, version: 1, data: profile, confirmedByUser: true }).returning();
    await db!.insert(schema.gapAnalyses).values({ profileId: p.id, result: analysis, matcherVersion: MATCHER_VERSION });
    await db!.insert(schema.userGoals).values({ userId: id, skillId: "aws", position: 1 });
    return id;
  }
  let n = 0;
  async function openJob(tag: string, c = criteria) {
    const admin = await person(`${tag}-admin`);
    const d = `${run}-${++n}.example-labs.test`;
    const details = { type: "company", legalName: "Example Labs Private Limited", name: "Example Labs", website: `https://${d}`, workEmail: `meera.iyer@${d}`, size: "51 to 200", city: "Pune" };
    const started = await startCompanySignup(admin, details, deps());
    if (!started.ok || !started.testCode) throw new Error("no code");
    const done = await finishCompanySignup(admin, { details, code: started.testCode }, deps());
    if (!done.ok) throw new Error(done.error);
    await db!.update(schema.organizations).set({ reviewStatus: "verified" }).where(eq(schema.organizations.id, done.orgId));
    const saved = await saveJob(admin, { roleSlug: SLUG, title: "SOC Analyst L1", workType: "full_time", city: "Pune", requirements: req, criteria: c, open: yes }, deps());
    if (!saved.ok) throw new Error(saved.error);
    return { admin, jobId: saved.jobId };
  }
  const prove = (userId: string, skillId: string, certId: string | null = null, expiresOn: string | null = null) =>
    db!.insert(schema.gapProofs).values({
      userId,
      skillId,
      type: certId ? "certification" : "skill_check",
      status: "accepted",
      evidence: certId ? { type: "certification", certId, issuer: "Example issuer", url: null } : { type: "skill_check", checkId: `${skillId}-1` },
      certId,
      expiresOn,
    });

  it("saves a job's criteria, shows them on the form and on Departures, and keeps them to required skills and our certificates", async () => {
    const { admin, jobId } = await openJob("save");
    const form = await jobForm(admin, jobId, deps());
    expect(form.ok && form.values?.criteria).toEqual(criteria);
    expect(form.ok && form.data.certificates.some((c) => c.id === "comptia-security-plus")).toBe(true);
    const live = (await liveJobs({ db: db! })).find((j) => j.id === jobId);
    expect(live?.criteria).toEqual({ verifiedSkills: [expect.any(String)], certificates: ["CompTIA Security+", expect.stringMatching(/SC-200/)] });
    const base = { jobId, roleSlug: SLUG, title: "SOC Analyst L1", workType: "full_time", city: "Pune", requirements: req };
    expect(await saveJob(admin, { ...base, criteria: { verifiedSkills: [], certificates: ["made-up-cert"] } }, deps())).toMatchObject({ ok: false, error: "unknown_certificate" });
    expect(await saveJob(admin, { ...base, criteria: { verifiedSkills: [req.nice[0]], certificates: [] } }, deps())).toMatchObject({
      ok: false,
      error: "invalid",
      message: "Ask for proof only of the job's required skills.",
    });
    // A job saved without criteria (an older form) asks for none.
    expect(await saveJob(admin, base, deps())).toMatchObject({ ok: true });
    const [row] = await db!.select({ criteria: schema.jobs.criteria }).from(schema.jobs).where(eq(schema.jobs.id, jobId));
    expect(row.criteria).toEqual({ verifiedSkills: [], certificates: [] });
  });

  it("previews exactly the packet the company's drawer shows, with criteria met only by current accepted proof", async () => {
    const { admin, jobId } = await openJob("preview");
    const me = await candidate("preview-cand");
    await prove(me, verified);
    // An expired certificate proof doesn't meet its criterion; a current one does.
    await prove(me, "network-security", "comptia-security-plus", "2026-01-01");
    await prove(me, "siem", "sc-200", "2028-01-01");
    const preview = await applyPreview(me, { jobId }, at());
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    const { packet } = preview;
    expect(packet).toMatchObject({ company: "Example Labs", jobTitle: "SOC Analyst L1" });
    expect(packet.criteria.lines.map((l) => [l.kind, l.met])).toEqual([
      ["skill", true],
      ["certificate", false],
      ["certificate", true],
    ]);
    // Previewing writes nothing: no consent, no application.
    expect(await db!.select().from(schema.consents).where(eq(schema.consents.userId, me))).toEqual([]);
    expect(await db!.select().from(schema.applications).where(eq(schema.applications.userId, me))).toEqual([]);

    // Unmet criteria warn, never block.
    const r = await applyToJob(me, { jobId, canJoin: "30", consent: true, note: `  ${NOTE}  ` }, at());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const opened = await openCandidate(admin, { applicationId: r.applicationId }, at());
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    const { candidate: c } = opened;
    expect(c.note).toBe(NOTE);
    expect({ profile: c.profile, match: c.match, criteria: c.criteria }).toEqual({ profile: packet.profile, match: packet.match, criteria: packet.criteria });
    // Never sent: gaps, path, goals, pay, phone, email, notice period or resume lines.
    const text = JSON.stringify(c);
    for (const never of [GAP_TEXT, HIGHLIGHT, "@example.test", "goal", "notice", "gaps", "path"]) expect(text).not.toContain(never);
    expect(text.replace(/"phone":null/g, "")).not.toContain("phone");

    // Proof added after applying shows to the company: the criteria are read live.
    await prove(me, "network-security", "comptia-security-plus", "2028-06-01");
    const again = await openCandidate(admin, { applicationId: r.applicationId }, at(1));
    expect(again.ok && again.candidate.criteria.met).toBe(3);
    // Once applied, there is nothing more to preview.
    expect(await applyPreview(me, { jobId }, at(1))).toMatchObject({ ok: false, error: "already" });
  });

  it("refuses a preview for a closed job, without a resume, or with a bad id", async () => {
    const { jobId } = await openJob("preview-refuse");
    const noResume = await person("preview-nores");
    expect(await applyPreview(noResume, { jobId }, at())).toMatchObject({ ok: false, error: "no_resume" });
    expect(await applyPreview(noResume, { jobId: "x" }, at())).toMatchObject({ ok: false, error: "invalid" });
    await db!.update(schema.jobs).set({ status: "paused" }).where(eq(schema.jobs.id, jobId));
    const me = await candidate("preview-refuse-cand");
    expect(await applyPreview(me, { jobId }, at())).toMatchObject({ ok: false, error: "not_open" });
  });

  it("refuses the preview and the send for a company the person blocked, and allows both after Unblock", async () => {
    const { jobId } = await openJob("preview-blocked");
    const me = await candidate("preview-blocked-cand");
    const [job] = await db!.select({ orgId: schema.jobs.orgId }).from(schema.jobs).where(eq(schema.jobs.id, jobId));
    await db!.insert(schema.companyBlocks).values({ userId: me, orgId: job.orgId, createdAt: clock });
    expect(await applyPreview(me, { jobId }, at())).toMatchObject({ ok: false, error: "blocked_company" });
    expect(await applyToJob(me, { jobId, canJoin: "30", consent: true, note: NOTE }, at())).toMatchObject({ ok: false, error: "blocked_company" });
    expect(await db!.select({ id: schema.applications.id }).from(schema.applications).where(eq(schema.applications.jobId, jobId))).toEqual([]);
    await db!.delete(schema.companyBlocks).where(eq(schema.companyBlocks.userId, me));
    expect(await applyPreview(me, { jobId }, at())).toMatchObject({ ok: true });
    expect(await applyToJob(me, { jobId, canJoin: "30", consent: true, note: NOTE }, at())).toMatchObject({ ok: true });
  });

  it("refuses the preview and the send while job search is off, and allows both once it is back on", async () => {
    const { jobId } = await openJob("search-off");
    const me = await candidate("search-off-cand");
    expect((await setJobSearch(me, false, { db: db!, now: clock })).ok).toBe(true);
    expect(await applyPreview(me, { jobId }, at())).toMatchObject({ ok: false, error: "search_off" });
    expect(await applyToJob(me, { jobId, canJoin: "30", consent: true, note: NOTE }, at())).toMatchObject({ ok: false, error: "search_off" });
    expect(APPLICATION_ERROR_TEXT.search_off).toBe("Turn on job search to apply.");
    expect(await db!.select({ id: schema.applications.id }).from(schema.applications).where(eq(schema.applications.jobId, jobId))).toEqual([]);
    expect((await setJobSearch(me, true, { db: db!, now: clock })).ok).toBe(true);
    expect(await applyPreview(me, { jobId }, at())).toMatchObject({ ok: true });
    expect(await applyToJob(me, { jobId, canJoin: "30", consent: true, note: NOTE }, at())).toMatchObject({ ok: true });
  });

  it("refuses a note with an email address or a phone number, and sends nothing", async () => {
    const { jobId } = await openJob("note");
    const me = await candidate("note-cand");
    for (const note of ["Mail me at priya.n@example.test", "Call 98765 43210 after 6"]) {
      const r = await applyToJob(me, { jobId, canJoin: "30", consent: true, note }, at());
      expect(r).toMatchObject({ ok: false, error: "invalid", message: expect.stringMatching(/Leave out email addresses and phone numbers/) });
    }
    expect(await applyToJob(me, { jobId, canJoin: "30", consent: true, note: "x".repeat(301) }, at())).toMatchObject({ ok: false, error: "invalid" });
    expect(await db!.select().from(schema.applications).where(eq(schema.applications.userId, me))).toEqual([]);
    // No note is stored as none.
    const ok = await applyToJob(me, { jobId, canJoin: "30", consent: true, note: "   " }, at());
    if (!ok.ok) throw new Error(ok.error);
    const [row] = await db!.select({ note: schema.applications.note }).from(schema.applications).where(eq(schema.applications.id, ok.applicationId));
    expect(row.note).toBeNull();
  });

  it("reads each posted job's criteria for the person on Departures, and nothing when signed out", async () => {
    const { jobId } = await openJob("states");
    const { jobId: none } = await openJob("states-none", { verifiedSkills: [], certificates: [] });
    const me = await candidate("states-cand");
    await prove(me, verified);
    const states = await criteriaStates(me, [jobId, none], at());
    expect(states[jobId]).toMatchObject({ met: 1, total: 3 });
    expect(states[none]).toEqual({ lines: [], met: 0, total: 0 });
    expect(await criteriaStates(null, [jobId], at())).toEqual({});
  });

  it("puts the note in Download your data, and the job's criteria in its maker's; withdrawing erases the note, deleting the account removes the application", async () => {
    const { admin, jobId } = await openJob("export");
    const me = await candidate("export-cand");
    const r = await applyToJob(me, { jobId, canJoin: "30", consent: true, note: NOTE }, at());
    if (!r.ok) throw new Error(r.error);
    const data = await exportAccountData(me, db!, clock);
    expect(data!.exportVersion).toBe(26);
    expect(data!.applications[0]).toMatchObject({ note: NOTE });
    const adminData = await exportAccountData(admin, db!, clock);
    expect(adminData!.jobsOwned.find((j) => j.title === "SOC Analyst L1")?.criteria).toEqual(criteria);
    // Withdrawing stops sharing: the note is erased, like a shared phone.
    expect(await withdrawApplication(me, { applicationId: r.applicationId }, at(1))).toEqual({ ok: true });
    const [after] = await db!.select({ note: schema.applications.note }).from(schema.applications).where(eq(schema.applications.id, r.applicationId));
    expect(after.note).toBeNull();
    expect((await exportAccountData(me, db!, clock))!.applications[0]).toMatchObject({ note: null });
    // Deleting the account for good removes the application and its note.
    expect(await requestDeletion(me, db!, clock)).toBe(true);
    await purgeDeletedAccounts(db!, new Date(clock.getTime() + 31 * DAY));
    expect(await db!.select().from(schema.applications).where(eq(schema.applications.id, r.applicationId))).toEqual([]);
  });
});
