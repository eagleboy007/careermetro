import { and, eq, inArray, like } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { skills } from "@/content";
import * as schema from "@/db/schema";
import { purgeDeletedAccounts, requestDeletion } from "@/lib/account/delete";
import { EXPORT_VERSION, exportAccountData } from "@/lib/account/export";
import { saveAccountSettings } from "@/lib/account/settings-store";
import { MATCHER_VERSION } from "@/lib/gaps/match";
import { acceptRequest, blockInChat, deleteRequest, listThreads, sendMessage } from "@/lib/inbox/store";
import { HIDDEN_MESSAGE_TEXT } from "@/lib/inbox/types";
import { DEFAULT_SETTINGS, settingsInput, type GapAnalysis, type Profile } from "@/lib/schemas";
import { FIND_CONSENT_PURPOSE } from "@/lib/schemas/constants";
import { LIMITS, takeShared } from "@/lib/shared-limit";
import { applyToJob } from "./applications-store";
import { companyMessages } from "./chats-store";
import {
  blockCompany,
  clearOldProfileViews,
  companyFoundChat,
  discoveryFor,
  findPeoplePage,
  openFoundPerson,
  searchPeople,
  sendFoundMessage,
  sendFoundRequest,
  sentRequests,
  unblockCompany,
} from "./find-store";
import { saveJob } from "./jobs-store";
import { corporateUnread } from "./overview";
import { activeMembership, finishCompanySignup, finishJoin, inviteMember, removeMember, startCompanySignup, startJoin, type CorporateDeps } from "./store";

vi.mock("server-only", () => ({}));

// Let companies find me (pending item 19) against a real Postgres with migrations applied. Every person, company and
// message here is made up.
const url = process.env.TEST_DATABASE_URL;
const sqlClient = url ? postgres(url, { max: 4, onnotice: () => {} }) : null;
const db = sqlClient ? drizzle(sqlClient, { schema }) : null;
const env = { NAME_HASH_KEY: "test-key" };
const DAY = 86_400_000;

const RESUME_LINE = "Looked after the help desk for 30 branch offices.";
const profileWith = (skillNames: string[], start = "2023-06", employer = "Konkan Co-operative Bank"): Profile => ({
  headline: null,
  totalYearsExperience: 3,
  roles: [{ title: "IT support analyst", employer, start, end: null, highlights: [RESUME_LINE] }],
  skills: skillNames.map((name) => ({ name, lastUsed: "2025", evidence: [] })),
  education: [{ qualification: "B.Sc. IT", institution: "Pune University", year: "2023" }],
  certifications: [],
});
const analysis: GapAnalysis = {
  roleSlug: "cyber-security-analyst",
  gaps: [{ skillId: "aws", skillName: "AWS", status: "missing", resumeQuote: null, requirement: "r", explanation: "e" }],
  metSkillIds: ["linux"],
  niceToHave: [],
  readiness: { headline: "h", explanation: "e", estimatedHours: 10 },
};
const HELLO = "Hello, your Linux work matches our SOC Analyst opening. Would you like to hear more?";
const REPLY = "Yes, happy to talk on a weekday evening.";

describe.skipIf(!db)("let companies find me (database)", () => {
  const run = `find${Date.now()}`;
  const userIds: string[] = [];
  const clock = new Date("2026-10-13T10:00:00Z");
  const deps = (over: Partial<CorporateDeps> = {}): CorporateDeps => ({ db: db!, env, now: clock, delivery: "test", ...over });
  const fd = (days = 0) => ({ db: db!, env, now: new Date(clock.getTime() + days * DAY) });
  const lines: string[] = [];
  const req = { required: ["python", "linux"], oneOf: [], nice: ["sql"] };
  const yes = { real: true, noFee: true, fair: true } as const;

  beforeAll(async () => {
    await db!
      .insert(schema.skills)
      .values(skills.map(({ id, name, category }) => ({ id, name, category })))
      .onConflictDoNothing();
  });
  beforeEach(() => {
    for (const level of ["log", "warn", "error"] as const) vi.spyOn(console, level).mockImplementation((line: unknown) => void lines.push(String(line)));
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    // Each test searches only its own people: everyone made so far is switched off again.
    if (userIds.length) await db!.update(schema.userSettings).set({ companiesCanFind: false }).where(inArray(schema.userSettings.userId, userIds));
  });
  afterAll(async () => {
    await db!.delete(schema.organizations).where(like(schema.organizations.emailDomain, `%${run}%`));
    if (userIds.length) await db!.delete(schema.users).where(inArray(schema.users.id, userIds));
    await sqlClient!.end();
    // Logs carry event names and reasons only: never a name, a ref, a band or a message.
    const all = lines.join("\n");
    for (const secret of ["Priya", "Arjun", "Meera", "Linux work", "weekday evening", "Konkan", run]) expect(all).not.toContain(secret);
  });

  async function person(n: string, name = "Meera Iyer") {
    const [u] = await db!.insert(schema.users).values({ email: `${run}-${n}@example.test`, name }).returning({ id: schema.users.id });
    userIds.push(u.id);
    return u.id;
  }
  /** A person with a resume and a current analysis, and "Let companies find me" as given. */
  async function seeker(n: string, opts: { name?: string; skills?: string[]; on?: boolean; showExperience?: boolean; role?: string } = {}) {
    const id = await person(n, opts.name ?? "Priya Nair");
    const [resume] = await db!.insert(schema.resumes).values({ userId: id, mimeType: "text/plain", sizeBytes: 1, status: "parsed" }).returning();
    const [p] = await db!
      .insert(schema.profiles)
      .values({ resumeId: resume.id, version: 1, data: profileWith(opts.skills ?? ["Python", "Linux"]), confirmedByUser: true })
      .returning();
    await db!.insert(schema.gapAnalyses).values({ profileId: p.id, result: { ...analysis, roleSlug: opts.role ?? analysis.roleSlug }, matcherVersion: MATCHER_VERSION });
    await setFind(id, opts.on ?? true, opts.showExperience ?? true);
    return id;
  }
  async function setFind(userId: string, on: boolean, showExperience = true) {
    await db!
      .insert(schema.userSettings)
      .values({ userId, companiesCanFind: on, showExperience })
      .onConflictDoUpdate({ target: schema.userSettings.userId, set: { companiesCanFind: on, showExperience } });
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
  /** A verified company with an admin, Hiring HR on the job, Hiring HR not on it, an Interviewer on it and an open job. */
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
    await join(admin, otherHr, d, "hiring", "farhan");
    const ivMember = await join(admin, iv, d, "interviewer", "sana");
    const saved = await saveJob(
      admin,
      { roleSlug: "cyber-security-analyst", title: "SOC Analyst L1", workType: "full_time", city: "Pune", requirements: req, open: yes, hiring: [hrMember], interviewers: [ivMember] },
      deps(),
    );
    if (!saved.ok) throw new Error(saved.error);
    return { orgId: done.orgId, domain: d, admin, hr, hrMember, otherHr, iv, jobId: saved.jobId };
  }
  /** The ids behind a search's refs, read back through the database (refs never carry them in the clear). */
  async function found(userId: string, jobId: string, extra: Record<string, unknown> = {}, days = 0) {
    const r = await searchPeople(userId, { jobId, ...extra }, fd(days));
    if (!r.ok) throw new Error(r.error);
    return r.cards;
  }
  const names = (cards: { name: string }[]) => cards.map((c) => c.name).sort();
  const auditOf = async (orgId: string) => db!.select().from(schema.auditLogs).where(eq(schema.auditLogs.orgId, orgId));

  it("finds only people who turned it on and match the job, at once off when they turn it off, with nothing private", async () => {
    const s = await setup("search");
    const on = await seeker("on", { name: "Priya Nair" });
    await seeker("off", { name: "Arjun Mehta", on: false });
    await seeker("nomatch", { name: "Kavya Reddy", skills: ["Excel"] });
    const applied = await seeker("applied", { name: "Imran Qureshi" });
    expect((await applyToJob(applied, { jobId: s.jobId, canJoin: "30", consent: true }, { db: db!, now: clock })).ok).toBe(true);
    // A member of the company who turned it on stays hidden from their own company.
    await setFind(s.otherHr, true);

    const cards = await found(s.admin, s.jobId);
    expect(names(cards)).toEqual(["Priya Nair"]);
    const [card] = cards;
    expect(card.ref).toMatch(/^[A-Za-z0-9_-]{59}$/);
    expect(card.ref).not.toContain(on);
    expect(card.match.requiredTotal).toBe(2);
    expect(card.match.requiredOnResume).toBe(2);
    expect(card.experience).toMatch(/year/);
    expect(card.request).toEqual({ state: "none" });
    const text = JSON.stringify(cards);
    for (const secret of ["@example.test", RESUME_LINE, on, "Konkan"]) expect(text).not.toContain(secret);

    // Turning it off with the settings form takes them out of the next search, and withdraws the consent it recorded.
    const form = (companiesCanFind: boolean) =>
      settingsInput.parse({ username: "", headline: "", currentPay: "", expectedPay: "", settings: { ...DEFAULT_SETTINGS, companiesCanFind } });
    await setFind(on, false);
    expect(await saveAccountSettings(on, form(true), clock, db!)).toEqual({ ok: true });
    expect(await saveAccountSettings(on, form(false), clock, db!)).toEqual({ ok: true });
    expect(await found(s.admin, s.jobId)).toEqual([]);
    const consents = await db!.select().from(schema.consents).where(and(eq(schema.consents.userId, on), eq(schema.consents.purpose, FIND_CONSENT_PURPOSE)));
    expect(consents).toHaveLength(1);
    expect(consents[0].withdrawnAt).not.toBeNull();
    expect(await saveAccountSettings(on, form(true), clock, db!)).toEqual({ ok: true });
    expect(names(await found(s.admin, s.jobId))).toEqual(["Priya Nair"]);

    // An old ref opens nobody once they are off.
    await setFind(on, false);
    expect(await openFoundPerson(s.admin, { jobId: s.jobId, ref: card.ref }, fd())).toEqual({ ok: false, error: "not_found" });
    expect(await sendFoundRequest(s.admin, { jobId: s.jobId, ref: card.ref, body: HELLO }, fd())).toEqual({ ok: false, error: "not_found" });

    // The experience band filters only people who show their experience.
    await setFind(on, true);
    expect(names(await found(s.admin, s.jobId, { bands: ["2-5"] }))).toEqual(["Priya Nair"]);
    expect(await found(s.admin, s.jobId, { bands: ["10+"] })).toEqual([]);
    expect(names(await found(s.admin, s.jobId, { bands: ["10+", "2-5"] }))).toEqual(["Priya Nair"]);
    await setFind(on, true, false);
    expect(await found(s.admin, s.jobId, { bands: ["2-5"] })).toEqual([]);
    const [hidden] = await found(s.admin, s.jobId);
    expect(hidden.experience).toBeNull();
  });

  it("shows the target role of everyone found and filters by target roles and verified profiles, alone or together (T44)", async () => {
    const s = await setup("filters");
    const soc = await seeker("f-soc", { name: "Priya Nair" });
    await seeker("f-analyst", { name: "Arjun Mehta", role: "data-analyst" });
    const proved = await seeker("f-proved", { name: "Kavya Reddy", role: "data-analyst" });
    await db!.insert(schema.gapProofs).values({ userId: proved, skillId: "linux", type: "skill_check", status: "accepted", evidence: { type: "skill_check", checkId: "c" } });
    // A proof still waiting for its check never makes a profile verified.
    await db!.insert(schema.gapProofs).values({ userId: soc, skillId: "python", type: "skill_check", status: "pending", evidence: { type: "skill_check", checkId: "c" } });
    // The target role shows to companies even with "your target role" off on the public profile (T44); gaps never do.
    await db!.update(schema.userSettings).set({ showTargetRole: false }).where(eq(schema.userSettings.userId, soc));

    // An optional city (T44): only Kavya gave one.
    await db!.update(schema.users).set({ city: "Pune" }).where(eq(schema.users.id, proved));

    const all = await found(s.admin, s.jobId);
    expect(all.map((c) => [c.name, c.aim, c.city, c.verified]).sort()).toEqual([
      ["Arjun Mehta", "Data Analyst", null, false],
      ["Kavya Reddy", "Data Analyst", "Pune", true],
      ["Priya Nair", "Cyber Security Analyst", null, false],
    ]);
    expect(names(await found(s.admin, s.jobId, { cities: ["Pune", "Kochi"] }))).toEqual(["Kavya Reddy"]);
    expect(await found(s.admin, s.jobId, { cities: ["Kochi"] })).toEqual([]);
    expect(await searchPeople(s.admin, { jobId: s.jobId, cities: ["MG Road, Pune"] }, fd())).toEqual({ ok: false, error: "invalid" });
    expect(names(await found(s.admin, s.jobId, { roles: ["data-analyst"] }))).toEqual(["Arjun Mehta", "Kavya Reddy"]);
    expect(names(await found(s.admin, s.jobId, { roles: ["data-analyst", "cyber-security-analyst"] }))).toEqual(["Arjun Mehta", "Kavya Reddy", "Priya Nair"]);
    expect(names(await found(s.admin, s.jobId, { verified: true }))).toEqual(["Kavya Reddy"]);
    expect(names(await found(s.admin, s.jobId, { roles: ["cyber-security-analyst"], verified: true }))).toEqual([]);
    expect(names(await found(s.admin, s.jobId, { roles: ["data-analyst"], verified: true, bands: ["2-5"] }))).toEqual(["Kavya Reddy"]);
    expect(await found(s.admin, s.jobId, { roles: ["no-such-role"] })).toEqual([]);

    const priya = all.find((c) => c.name === "Priya Nair")!;
    const opened = await openFoundPerson(s.admin, { jobId: s.jobId, ref: priya.ref }, fd());
    if (!opened.ok) throw new Error(opened.error);
    expect(opened.person.profile.aim).toBe("Cyber Security Analyst");
    expect(opened.person.city).toBeNull();
    expect(JSON.stringify(opened.person)).not.toContain("AWS");
  });

  it("finds people by name, name + role and name + role + company, and never the company's own current staff", async () => {
    const s = await setup("names");
    const priya = await seeker("n-priya", { name: "Priya Nair" });
    // No required skill for the job: only a typed name finds her.
    await seeker("n-kavya", { name: "Kavya Reddy", skills: ["Excel"] });
    const staff = await seeker("n-staff", { name: "Priya Sharma" });

    expect(names(await found(s.admin, s.jobId))).toEqual(["Priya Nair", "Priya Sharma"]);
    expect(names(await found(s.admin, s.jobId, { name: "kavya" }))).toEqual(["Kavya Reddy"]);
    expect(names(await found(s.admin, s.jobId, { name: "pri" }))).toEqual(["Priya Nair", "Priya Sharma"]);
    expect(names(await found(s.admin, s.jobId, { name: "priya nai" }))).toEqual(["Priya Nair"]);
    expect(names(await found(s.admin, s.jobId, { name: "priya", title: "it support" }))).toEqual(["Priya Nair", "Priya Sharma"]);
    expect(names(await found(s.admin, s.jobId, { name: "priya", title: "cyber security" }))).toEqual(["Priya Nair", "Priya Sharma"]);
    expect(await found(s.admin, s.jobId, { name: "priya", title: "data engineer" })).toEqual([]);
    expect(names(await found(s.admin, s.jobId, { name: "priya", title: "it support", company: "Konkan" }))).toEqual(["Priya Nair", "Priya Sharma"]);
    expect(await found(s.admin, s.jobId, { name: "priya", company: "Garuda" })).toEqual([]);
    // Hidden experience: the employer can't be searched.
    await setFind(priya, true, false);
    expect(names(await found(s.admin, s.jobId, { name: "priya", company: "Konkan" }))).toEqual(["Priya Sharma"]);
    await setFind(priya, true, true);
    // Role or company without a name is refused, and nothing typed reaches the audit line.
    expect(await searchPeople(s.admin, { jobId: s.jobId, company: "Konkan" }, fd())).toEqual({ ok: false, error: "invalid" });
    expect(JSON.stringify(await auditOf(s.orgId))).not.toMatch(/kavya|konkan|garuda/i);

    // Priya Sharma moves to the searching company (her profile's current job): it never sees her again, even by name,
    // and a ref it already had opens nobody.
    const [card] = (await found(s.admin, s.jobId, { name: "priya sharma" }));
    const [resume] = await db!.select({ id: schema.resumes.id }).from(schema.resumes).where(eq(schema.resumes.userId, staff));
    await db!.update(schema.profiles).set({ data: profileWith(["Python", "Linux"], "2026-01", "Example Labs Pvt. Ltd.") }).where(eq(schema.profiles.resumeId, resume.id));
    expect(names(await found(s.admin, s.jobId))).toEqual(["Priya Nair"]);
    expect(await found(s.admin, s.jobId, { name: "priya sharma" })).toEqual([]);
    expect(await openFoundPerson(s.admin, { jobId: s.jobId, ref: card.ref }, fd())).toEqual({ ok: false, error: "not_found" });
    expect(await sendFoundRequest(s.admin, { jobId: s.jobId, ref: card.ref, body: HELLO }, fd())).toEqual({ ok: false, error: "not_found" });
  });

  it("lets only Recruiter admins and Hiring HR on the job of a verified company search", async () => {
    const s = await setup("roles");
    await seeker("roles-p");
    expect(await searchPeople(s.iv, { jobId: s.jobId }, fd())).toEqual({ ok: false, error: "interviewer" });
    expect(await searchPeople(s.otherHr, { jobId: s.jobId }, fd())).toEqual({ ok: false, error: "not_on_job" });
    expect((await searchPeople(s.hr, { jobId: s.jobId }, fd())).ok).toBe(true);
    const outsider = await person("roles-out", "Arjun Mehta");
    expect(await searchPeople(outsider, { jobId: s.jobId }, fd())).toEqual({ ok: false, error: "not_member" });
    expect(await searchPeople(s.admin, { jobId: "not-a-uuid" }, fd())).toEqual({ ok: false, error: "invalid" });

    const page = await findPeoplePage(s.iv, { jobId: s.jobId, bands: [], roles: [], cities: [], verified: false, page: 1 }, fd());
    expect(page).toMatchObject({ refusal: "interviewer", jobs: [], results: null });
    expect((await findPeoplePage(s.otherHr, { jobId: null, bands: [], roles: [], cities: [], verified: false, page: 1 }, fd()))!.jobs).toEqual([]);
    expect((await findPeoplePage(s.hr, { jobId: null, bands: [], roles: [], cities: [], verified: false, page: 1 }, fd()))!.jobs.map((j) => j.id)).toEqual([s.jobId]);

    await db!.update(schema.organizations).set({ reviewStatus: "suspended" }).where(eq(schema.organizations.id, s.orgId));
    expect(await searchPeople(s.admin, { jobId: s.jobId }, fd())).toEqual({ ok: false, error: "not_verified" });
    expect((await findPeoplePage(s.admin, { jobId: s.jobId, bands: [], roles: [], cities: [], verified: false, page: 1 }, fd()))!.refusal).toBe("not_verified");
    await db!.update(schema.organizations).set({ reviewStatus: "verified" }).where(eq(schema.organizations.id, s.orgId));
    await db!.update(schema.jobs).set({ status: "paused" }).where(eq(schema.jobs.id, s.jobId));
    expect(await searchPeople(s.admin, { jobId: s.jobId }, fd())).toEqual({ ok: false, error: "job_not_open" });
  });

  it("hides people who blocked the company or the searcher, and blocks are silent", async () => {
    const s = await setup("blocks");
    const p = await seeker("blocks-p");
    const q = await seeker("blocks-q", { name: "Arjun Mehta" });
    await db!.insert(schema.blocks).values({ blockerId: q, blockedId: s.admin, createdAt: clock });
    expect(names(await found(s.admin, s.jobId))).toEqual(["Priya Nair"]);
    expect(names(await found(s.hr, s.jobId))).toEqual(["Arjun Mehta", "Priya Nair"]);

    const [card] = await found(s.admin, s.jobId);
    expect(await blockCompany(p, { orgId: s.orgId }, fd())).toBe(true);
    expect(await found(s.admin, s.jobId)).toEqual([]);
    expect(await openFoundPerson(s.admin, { jobId: s.jobId, ref: card.ref }, fd())).toEqual({ ok: false, error: "not_found" });
    expect((await discoveryFor(p, fd())).blocked.map((b) => b.orgId)).toEqual([s.orgId]);
    expect(await unblockCompany(p, { orgId: s.orgId }, fd())).toBe(true);
    expect(names(await found(s.admin, s.jobId))).toEqual(["Priya Nair"]);
  });

  it("opens a profile with the public parts only, records the view, and sends one message request the person accepts", async () => {
    const s = await setup("flow");
    const p = await seeker("flow-p");
    const [card] = await found(s.hr, s.jobId);
    const opened = await openFoundPerson(s.hr, { jobId: s.jobId, ref: card.ref }, fd());
    if (!opened.ok) throw new Error(opened.error);
    const view = opened.person;
    expect(view.profile.name).toBe("Priya Nair");
    expect(view.profile.skills.weak).toEqual([]);
    expect(view.profile.skills.missing).toEqual([]);
    expect(view.profile.experience.every((x) => x.highlights.length === 0)).toBe(true);
    const text = JSON.stringify(view);
    for (const secret of ["@example.test", RESUME_LINE, "AWS", p]) expect(text).not.toContain(secret);
    expect((await discoveryFor(p, fd())).views).toMatchObject([{ orgId: s.orgId, company: "Example Labs", times: 1, blocked: false }]);

    // A request: one message, then nothing until they accept.
    const base = { hr: await corporateUnread(s.hr, fd()), admin: await corporateUnread(s.admin, fd()), iv: await corporateUnread(s.iv, fd()) };
    const sent = await sendFoundRequest(s.hr, { jobId: s.jobId, ref: card.ref, body: HELLO }, fd());
    if (!sent.ok) throw new Error(sent.error);
    expect(await sendFoundRequest(s.admin, { jobId: s.jobId, ref: card.ref, body: HELLO }, fd())).toEqual({ ok: false, error: "waiting" });
    expect(await sendFoundMessage(s.hr, { conversationId: sent.conversationId, body: "Any news?" }, fd())).toEqual({ ok: false, error: "waiting" });
    expect((await found(s.admin, s.jobId))[0].request).toEqual({ state: "waiting", conversationId: sent.conversationId });
    expect((await sentRequests(s.admin, { db: db! })).map((r) => r.state)).toEqual(["waiting"]);
    // The Interviewer can't read found chats.
    expect(await companyFoundChat(s.iv, sent.conversationId, fd())).toEqual({ ok: false, error: "interviewer" });

    let [thread] = await listThreads(p, fd());
    expect(thread).toMatchObject({ id: sent.conversationId, kind: "request", found: true, name: "Example Labs", job: "SOC Analyst L1", verified: true, unread: true });
    expect(thread.messages.map((m) => m.text)).toEqual([HELLO]);
    // The company can't write from the Inbox side.
    expect(await sendMessage(s.hr, sent.conversationId, "From the Inbox", fd())).toEqual({ ok: false, error: "not_found" });

    expect(await acceptRequest(p, sent.conversationId, fd())).toEqual({ ok: true });
    [thread] = await listThreads(p, fd());
    expect(thread).toMatchObject({ kind: "application", found: true });
    // A little after the request (the sender's read mark is the request's own time, and only later messages are new).
    expect((await sendMessage(p, sent.conversationId, REPLY, fd(1 / 48))).ok).toBe(true);
    // The reply counts on the Corporate tab for the team who may read the chat, not for the Interviewer, until read.
    expect(await corporateUnread(s.hr, fd(1 / 48))).toBe(base.hr + 1);
    expect(await corporateUnread(s.admin, fd(1 / 48))).toBe(base.admin + 1);
    expect(await corporateUnread(s.iv, fd(1 / 48))).toBe(base.iv);
    expect((await companyFoundChat(s.hr, sent.conversationId, { ...fd(1 / 24), markRead: true })).ok).toBe(true);
    expect(await corporateUnread(s.hr, fd(1 / 24))).toBe(base.hr);
    expect((await sendFoundMessage(s.admin, { conversationId: sent.conversationId, body: "Great, thanks." }, fd())).ok).toBe(true);
    const chat = await companyFoundChat(s.hr, sent.conversationId, fd());
    if (!chat.ok) throw new Error(chat.error);
    expect(chat.chat).toMatchObject({ found: sent.conversationId, candidate: "Priya Nair", state: "open", stage: null });
    const list = await companyMessages(s.admin, fd());
    expect(list.ok && list.view.items.some((i) => i.found === sent.conversationId)).toBe(true);
    expect(await sendFoundRequest(s.hr, { jobId: s.jobId, ref: card.ref, body: HELLO }, fd())).toEqual({ ok: false, error: "accepted" });

    // Every search, view and request wrote an audit line that names the job only.
    const audit = await auditOf(s.orgId);
    const mine = audit.filter((a) => ["people_searched", "found_profile_viewed", "found_request_sent"].includes(a.action));
    expect(new Set(mine.map((a) => a.action))).toEqual(new Set(["people_searched", "found_profile_viewed", "found_request_sent"]));
    for (const a of mine) {
      expect(a.target).toContain(s.jobId);
      expect(JSON.stringify(a)).not.toContain(p);
      expect(JSON.stringify(a)).not.toContain("Priya");
    }
  });

  it("shows a hidden found-chat message as the notice on both sides, and leaves a suspended person out until lifted (FR-46)", async () => {
    const s = await setup("removal");
    const p = await seeker("removal-p", { name: "Divya Rao" });
    const [card] = await found(s.admin, s.jobId);
    const sent = await sendFoundRequest(s.admin, { jobId: s.jobId, ref: card.ref, body: HELLO }, fd());
    if (!sent.ok) throw new Error(sent.error);
    expect(await acceptRequest(p, sent.conversationId, fd())).toEqual({ ok: true });
    const hello = and(eq(schema.messages.conversationId, sent.conversationId), eq(schema.messages.body, HELLO));
    await db!.update(schema.messages).set({ hiddenAt: clock, hiddenBy: s.admin, hiddenReason: "Test." }).where(hello);

    const [thread] = await listThreads(p, fd());
    expect(thread.messages.map((m) => m.text)).toContain(HIDDEN_MESSAGE_TEXT);
    const chat = await companyFoundChat(s.admin, sent.conversationId, fd());
    if (!chat.ok) throw new Error(chat.error);
    expect(chat.chat.messages.map((m) => m.text)).toContain(HIDDEN_MESSAGE_TEXT);
    const list = await companyMessages(s.admin, fd());
    if (!list.ok) throw new Error(list.error);
    expect(list.view.items.find((i) => i.found === sent.conversationId)?.preview).toBe(HIDDEN_MESSAGE_TEXT);
    for (const read of [thread, chat, list]) expect(JSON.stringify(read)).not.toContain(HELLO);
    await db!.update(schema.messages).set({ hiddenAt: null, hiddenBy: null, hiddenReason: null }).where(hello);
    expect((await listThreads(p, fd()))[0].messages.map((m) => m.text)).toContain(HELLO);

    // Suspended after a report: out of Find people and the company's found chats; lifting brings them back.
    const suspend = (on: boolean) =>
      db!
        .update(schema.users)
        .set(on ? { suspendedAt: clock, suspendedBy: s.admin, suspendedReason: "Test." } : { suspendedAt: null, suspendedBy: null, suspendedReason: null })
        .where(eq(schema.users.id, p));
    await suspend(true);
    expect(await found(s.admin, s.jobId)).toEqual([]);
    expect(await openFoundPerson(s.admin, { jobId: s.jobId, ref: card.ref }, fd())).toEqual({ ok: false, error: "not_found" });
    expect(await companyFoundChat(s.admin, sent.conversationId, fd())).toEqual({ ok: false, error: "not_found" });
    const hiddenList = await companyMessages(s.admin, fd());
    expect(hiddenList.ok && hiddenList.view.items.some((i) => i.found === sent.conversationId)).toBe(false);
    await suspend(false);
    expect(names(await found(s.admin, s.jobId))).toEqual(["Divya Rao"]);
    expect((await companyFoundChat(s.admin, sent.conversationId, fd())).ok).toBe(true);
  });

  it("blocks the company silently from the Inbox: a blocked request reads exactly like a deleted one; an accepted chat closes", async () => {
    const s = await setup("inbox");
    const p = await seeker("inbox-p");
    const q = await seeker("inbox-q", { name: "Arjun Mehta" });
    const cards = await found(s.admin, s.jobId);
    const refOf = (name: string) => cards.find((c) => c.name === name)!.ref;
    const toP = await sendFoundRequest(s.admin, { jobId: s.jobId, ref: refOf("Priya Nair"), body: HELLO }, fd());
    const toQ = await sendFoundRequest(s.admin, { jobId: s.jobId, ref: refOf("Arjun Mehta"), body: HELLO }, fd());
    if (!toP.ok || !toQ.ok) throw new Error("not sent");

    expect(await blockInChat(p, toP.conversationId, fd())).toEqual({ ok: true });
    expect(await listThreads(p, fd())).toEqual([]);
    expect(names(await found(s.admin, s.jobId))).toEqual(["Arjun Mehta"]);
    expect(await deleteRequest(q, toQ.conversationId, fd())).toEqual({ ok: true });
    expect(await listThreads(q, fd())).toEqual([]);

    // The company can't tell the blocked request from the deleted one: both stay "Waiting", and nothing more sends.
    const sent = await sentRequests(s.admin, { db: db! });
    expect(sent.map((r) => [r.name, r.state]).sort()).toEqual([
      ["Arjun Mehta", "waiting"],
      ["Priya Nair", "waiting"],
    ]);
    const chatOf = async (id: string) => {
      const r = await companyFoundChat(s.admin, id, fd());
      if (!r.ok) throw new Error(r.error);
      return { state: r.chat.state, messages: r.chat.messages.map((m) => m.text) };
    };
    expect(await chatOf(toP.conversationId)).toEqual(await chatOf(toQ.conversationId));
    expect((await chatOf(toP.conversationId)).state).toBe("waiting");
    for (const id of [toP.conversationId, toQ.conversationId])
      expect(await sendFoundMessage(s.admin, { conversationId: id, body: "Any news?" }, fd())).toEqual({ ok: false, error: "waiting" });
    expect((await found(s.admin, s.jobId))[0].request.state).toBe("waiting");

    // A chat the person had accepted closes for good when they block the company, as an application chat does.
    const r = await seeker("inbox-r", { name: "Kavya Reddy" });
    const toR = await sendFoundRequest(s.admin, { jobId: s.jobId, ref: (await found(s.admin, s.jobId)).find((c) => c.name === "Kavya Reddy")!.ref, body: HELLO }, fd());
    if (!toR.ok) throw new Error(toR.error);
    expect(await acceptRequest(r, toR.conversationId, fd())).toEqual({ ok: true });
    expect(await blockCompany(r, { orgId: s.orgId }, fd())).toBe(true);
    expect((await chatOf(toR.conversationId)).state).toBe("closed");
    expect(await listThreads(r, fd())).toEqual([]);
  });

  it("never lets a colleague of the sender accept or delete the company's own request on the person's behalf (security review 2026-10-13)", async () => {
    const s = await setup("exploit");
    const p = await seeker("exploit-p");
    const adminB = await person("exploit-admin-b", "Anil Kapoor");
    const adminBMember = await join(s.admin, adminB, s.domain, "admin", "anil");
    const [card] = await found(s.admin, s.jobId);
    // Admin A sends the request.
    const sent = await sendFoundRequest(s.admin, { jobId: s.jobId, ref: card.ref, body: HELLO }, fd());
    if (!sent.ok) throw new Error(sent.error);
    // Admin B opens the chat in Corporate Messages, which gives B a company-side read row.
    expect((await companyFoundChat(adminB, sent.conversationId, { ...fd(), markRead: true })).ok).toBe(true);
    const rowsOf = async () => db!.select().from(schema.conversationMembers).where(eq(schema.conversationMembers.conversationId, sent.conversationId));
    expect((await rowsOf()).find((r) => r.userId === adminB)).toMatchObject({ role: "company_team", hiddenAt: null });
    // B tries to answer the request from the Inbox side: refused, and the chat stays a request the person can answer.
    expect(await acceptRequest(adminB, sent.conversationId, fd())).toEqual({ ok: false, error: "not_found" });
    expect(await deleteRequest(adminB, sent.conversationId, fd())).toEqual({ ok: false, error: "not_found" });
    const statusOf = async () => (await db!.select({ status: schema.conversations.status }).from(schema.conversations).where(eq(schema.conversations.id, sent.conversationId)))[0].status;
    expect(await statusOf()).toBe("request");
    const msgs = await db!.select().from(schema.messages).where(eq(schema.messages.conversationId, sent.conversationId));
    expect(msgs.filter((m) => m.kind === "system")).toEqual([]);
    expect(await sendFoundMessage(adminB, { conversationId: sent.conversationId, body: "Any news?" }, fd())).toEqual({ ok: false, error: "waiting" });
    // The person still sees the request; after they delete it, B can't bring it back either.
    expect((await listThreads(p, fd()))[0]).toMatchObject({ id: sent.conversationId, kind: "request" });
    expect(await deleteRequest(p, sent.conversationId, fd())).toEqual({ ok: true });
    expect(await acceptRequest(adminB, sent.conversationId, fd())).toEqual({ ok: false, error: "not_found" });
    expect(await statusOf()).toBe("request");
    // Removing B (a third admin keeps the two-admin rule) takes their company-side rows away too.
    await join(s.admin, await person("exploit-admin-c", "Kavita Rao"), s.domain, "admin", "kavita");
    expect(await removeMember(s.admin, { memberId: adminBMember }, deps())).toEqual({ ok: true });
    expect((await rowsOf()).some((r) => r.userId === adminB)).toBe(false);
    expect(await companyFoundChat(adminB, sent.conversationId, { ...fd(), markRead: true })).toEqual({ ok: false, error: "not_member" });
    expect((await rowsOf()).some((r) => r.userId === adminB)).toBe(false);
  });

  it("shows a suspended company nothing of a found chat and writes no row for it; reads and sends are audited by job (security review 2026-10-13)", async () => {
    const s = await setup("found-audit");
    const p = await seeker("found-audit-p");
    const [card] = await found(s.admin, s.jobId);
    const sent = await sendFoundRequest(s.admin, { jobId: s.jobId, ref: card.ref, body: HELLO }, fd());
    if (!sent.ok) throw new Error(sent.error);
    expect(await acceptRequest(p, sent.conversationId, fd())).toEqual({ ok: true });
    expect((await sendFoundMessage(s.hr, { conversationId: sent.conversationId, body: "Great, thanks." }, fd())).ok).toBe(true);
    for (let k = 0; k < 3; k++) expect((await companyFoundChat(s.hr, sent.conversationId, { ...fd(), markRead: true })).ok).toBe(true);
    const lines = (await auditOf(s.orgId)).filter((a) => ["found_chat_read", "found_message_sent"].includes(a.action));
    expect(lines.map((l) => [l.action, l.actor, l.target]).sort()).toEqual([
      ["found_chat_read", `member:${s.hrMember}`, `job:${s.jobId}`],
      ["found_message_sent", `member:${s.hrMember}`, `job:${s.jobId}`],
    ]);
    for (const l of lines) expect(JSON.stringify(l)).not.toContain(p);

    expect((await sendMessage(p, sent.conversationId, REPLY, fd(1 / 24))).ok).toBe(true);
    expect(await corporateUnread(s.admin, fd(1 / 24))).toBe(1);
    await db!.update(schema.organizations).set({ reviewStatus: "suspended" }).where(eq(schema.organizations.id, s.orgId));
    // A suspended company reads no chats, so its Corporate tab counts none.
    expect(await corporateUnread(s.admin, fd(1))).toBe(0);
    const rowsOf = async () =>
      (await db!.select().from(schema.conversationMembers).where(eq(schema.conversationMembers.conversationId, sent.conversationId))).map((r) => [r.userId, r.role, r.lastReadAt?.toISOString()]).sort();
    const before = await rowsOf();
    expect(before.some(([id]) => id === s.otherHr)).toBe(false);
    expect(await companyFoundChat(s.otherHr, sent.conversationId, { ...fd(1), markRead: true })).toEqual({ ok: false, error: "not_found" });
    expect(await companyFoundChat(s.admin, sent.conversationId, { ...fd(1), markRead: true })).toEqual({ ok: false, error: "paused" });
    expect(await companyFoundChat(s.hr, sent.conversationId, { ...fd(1), markRead: true })).toEqual({ ok: false, error: "paused" });
    // No row added or touched while the company is suspended.
    expect(await rowsOf()).toEqual(before);
  });

  it("limits profile openings per member and per company (security review 2026-10-13)", async () => {
    const s = await setup("open-limit");
    await seeker("open-limit-p");
    const [card] = await found(s.admin, s.jobId);
    expect((await openFoundPerson(s.hr, { jobId: s.jobId, ref: card.ref }, fd())).ok).toBe(true);
    for (let i = 0; i < LIMITS.findOpensPerCompanyDay.max; i++) await takeShared(LIMITS.findOpensPerCompanyDay, s.orgId, { db: db!, now: clock.getTime() });
    // Every member of the company is out, though neither has used their own hour.
    expect(await openFoundPerson(s.admin, { jobId: s.jobId, ref: card.ref }, fd())).toEqual({ ok: false, error: "limit" });
    expect(await openFoundPerson(s.hr, { jobId: s.jobId, ref: card.ref }, fd())).toEqual({ ok: false, error: "limit" });
    expect(LIMITS.findOpensPerCompanyDay.max).toBe(300);
  });

  it("limits searches per person and per company", async () => {
    const s = await setup("limit");
    await seeker("limit-p");
    for (let i = 0; i < LIMITS.findSearchesPerUserHour.max; i++) await takeShared(LIMITS.findSearchesPerUserHour, s.hr, { db: db!, now: clock.getTime() });
    expect(await searchPeople(s.hr, { jobId: s.jobId }, fd())).toEqual({ ok: false, error: "limit" });
    expect((await searchPeople(s.admin, { jobId: s.jobId }, fd())).ok).toBe(true);
    for (let i = 0; i < LIMITS.findSearchesPerCompanyDay.max; i++) await takeShared(LIMITS.findSearchesPerCompanyDay, s.orgId, { db: db!, now: clock.getTime() });
    expect(await searchPeople(s.admin, { jobId: s.jobId }, fd())).toEqual({ ok: false, error: "limit" });
  });

  it("exports the switch, views and blocks, clears views after 30 days, and deleting the account removes everything", async () => {
    const s = await setup("delete");
    const p = await seeker("delete-p");
    const [card] = await found(s.admin, s.jobId);
    expect((await openFoundPerson(s.admin, { jobId: s.jobId, ref: card.ref }, fd())).ok).toBe(true);
    const sent = await sendFoundRequest(s.admin, { jobId: s.jobId, ref: card.ref, body: HELLO }, fd());
    if (!sent.ok) throw new Error(sent.error);
    expect(await acceptRequest(p, sent.conversationId, fd())).toEqual({ ok: true });
    expect((await sendMessage(p, sent.conversationId, REPLY, fd())).ok).toBe(true);
    const other = await setup("delete-2");
    expect(await blockCompany(p, { orgId: other.orgId }, fd())).toBe(true);

    const data = await exportAccountData(p, db!, clock);
    expect(EXPORT_VERSION).toBe(18);
    expect(data!.exportVersion).toBe(18);
    expect(data!.companyDiscovery.companiesCanFind).toBe(true);
    expect(data!.companyDiscovery.profileViews).toMatchObject([{ company: "Example Labs", job: "SOC Analyst L1" }]);
    expect(data!.companyDiscovery.blockedCompanies).toMatchObject([{ company: "Example Labs" }]);
    expect(data!.settings).toMatchObject({ companiesCanFind: true });
    expect(data!.inbox.chats.find((c) => c.kind === "found")).toMatchObject({ side: "candidate", company: "Example Labs", job: "SOC Analyst L1" });

    // Views older than 30 days go in the daily clean-up.
    expect(await clearOldProfileViews(db!, new Date(clock.getTime() + 29 * DAY))).toBe(0);
    expect((await discoveryFor(p, fd(29))).views).toHaveLength(1);

    // Waiting out the deletion hides them at once; the purge removes views, blocks and found chats.
    expect(await requestDeletion(p, db!, clock)).toBe(true);
    expect(await found(s.admin, s.jobId)).toEqual([]);
    expect(await purgeDeletedAccounts(db!, new Date(clock.getTime() + 31 * DAY))).toBeGreaterThanOrEqual(1);
    expect(await db!.select().from(schema.companyProfileViews).where(eq(schema.companyProfileViews.userId, p))).toEqual([]);
    expect(await db!.select().from(schema.companyBlocks).where(eq(schema.companyBlocks.userId, p))).toEqual([]);
    expect(await db!.select().from(schema.conversations).where(eq(schema.conversations.id, sent.conversationId))).toEqual([]);
    expect(await db!.select().from(schema.messages).where(eq(schema.messages.conversationId, sent.conversationId))).toEqual([]);
  });

  it("clears views older than 30 days", async () => {
    const s = await setup("old");
    const p = await seeker("old-p");
    const [card] = await found(s.admin, s.jobId);
    expect((await openFoundPerson(s.admin, { jobId: s.jobId, ref: card.ref }, fd())).ok).toBe(true);
    expect(await clearOldProfileViews(db!, new Date(clock.getTime() + 31 * DAY))).toBeGreaterThanOrEqual(1);
    expect((await discoveryFor(p, fd())).views).toEqual([]);
  });

  it("opening a Find people link fills in the form without searching: no limit used, no audit line (T41)", async () => {
    const s = await setup("link");
    await seeker("link-p");
    const searches = async () => (await auditOf(s.orgId)).filter((l) => l.action === "people_searched").length;
    for (let i = 0; i < 3; i++) {
      const search = { jobId: s.jobId, bands: ["2-5" as const], roles: ["data-analyst"], cities: ["Pune" as const], verified: true, page: 2 };
      const view = await findPeoplePage(s.admin, search, fd());
      expect(view).toMatchObject({ search, results: null, error: null });
    }
    expect(await searches()).toBe(0);
    // Pressing Search (searchPeople, from the server action) runs it and writes the line.
    expect(names(await found(s.admin, s.jobId))).toEqual(["Priya Nair"]);
    expect(await searches()).toBe(1);
  });
});
