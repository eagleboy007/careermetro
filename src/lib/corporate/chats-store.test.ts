import { and, eq, inArray, like } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { roleProfiles, skills } from "@/content";
import * as schema from "@/db/schema";
import { purgeDeletedAccounts } from "@/lib/account/delete";
import { EXPORT_VERSION, exportAccountData } from "@/lib/account/export";
import { MATCHER_VERSION } from "@/lib/gaps/match";
import { listThreads, markRead, report, sendMessage, unreadChats } from "@/lib/inbox/store";
import { HIDDEN_MESSAGE_TEXT } from "@/lib/inbox/types";
import type { GapAnalysis, Profile } from "@/lib/schemas";
import { LIMITS, takeShared } from "@/lib/shared-limit";
import { applyToJob, jobBoard, moveApplication, openCandidate, withdrawApplication } from "./applications-store";
import { companyChat, companyMessages, sendCompanyMessage } from "./chats-store";
import { requirementsFromRole, roleBySlug } from "./job-content";
import { saveJob } from "./jobs-store";
import { activeMembership, finishCompanySignup, finishJoin, inviteMember, removeMember, startCompanySignup, startJoin, type CorporateDeps } from "./store";

vi.mock("server-only", () => ({}));

// Company chats (dev/corporate-plan.md build step 5) against a real Postgres with migrations applied. Every person,
// company and message here is made up.
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

const HELLO = "Thanks for applying. Could you tell us about the Splunk dashboards you built?";
const REPLY = "Happy to. I built three dashboards for branch login alerts.";
const QUESTION = "Which SIEM tools have you used on shift work?";
const NOTE = "We need hands-on SIEM for this role. Apply again once it is proved.";

describe.skipIf(!db)("company chats (database)", () => {
  const run = `chats${Date.now()}`;
  const userIds: string[] = [];
  const clock = new Date("2026-10-13T10:00:00Z");
  const deps = (over: Partial<CorporateDeps> = {}): CorporateDeps => ({ db: db!, env, now: clock, delivery: "test", ...over });
  const at = (days = 0) => ({ db: db!, now: new Date(clock.getTime() + days * DAY) });
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
    // An unseeded database (CI) gets the role as an unpublished row. The three corporate test files share it and run
    // at the same time, so it is added once and left in place: deleting it could pull it from under another file's jobs.
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
    // Logs carry event names and reasons only: never a message, a name or a note.
    const all = lines.join("\n");
    for (const secret of ["Splunk dashboards", "branch login", "SIEM tools", "Priya", "Rahul", "Meera", "SIEM for this role"]) expect(all).not.toContain(secret);
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
  /**
   * A verified company with an admin, Hiring HR on the job, Hiring HR not on it, an Interviewer on it, an open job and
   * one application to it.
   */
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
    const saved = await saveJob(admin, { roleSlug: SLUG, title: "SOC Analyst L1", workType: "full_time", city: "Pune", requirements: req, open: yes, hiring: [hrMember], interviewers: [ivMember] }, deps());
    if (!saved.ok) throw new Error(saved.error);
    const me = await candidate(`${tag}-cand`);
    const applied = await applyToJob(me, { jobId: saved.jobId, canJoin: "30", consent: true }, at());
    if (!applied.ok) throw new Error(applied.error);
    return { orgId: done.orgId, admin, hr, hrMember, otherHr, iv, me, jobId: saved.jobId, applicationId: applied.applicationId };
  }
  const conversationOf = async (applicationId: string) =>
    (await db!.select().from(schema.conversations).where(eq(schema.conversations.applicationId, applicationId)))[0];
  const send = (userId: string, applicationId: string, body: string, days = 0, question = false) => sendCompanyMessage(userId, { applicationId, body, question }, at(days));

  it("opens one company-owned chat when the person applies, with a first line, in their Inbox with the verified badge", async () => {
    const s = await setup("open");
    const chat = await conversationOf(s.applicationId);
    expect(chat).toMatchObject({ kind: "application", status: "open", orgId: s.orgId, startedBy: s.me });
    const members = await db!.select().from(schema.conversationMembers).where(eq(schema.conversationMembers.conversationId, chat.id));
    expect(members.map((m) => [m.userId, m.role])).toEqual([[s.me, "member"]]);
    // One chat per application, enforced by the database.
    await expect(db!.insert(schema.conversations).values({ kind: "application", status: "open", applicationId: s.applicationId, orgId: s.orgId })).rejects.toThrow();
    const [thread] = await listThreads(s.me, at());
    expect(thread).toMatchObject({ id: chat.id, kind: "application", name: "Example Labs", job: "SOC Analyst L1", verified: true, unread: false });
    expect(thread.state).toBeUndefined();
    expect(thread.messages).toEqual([{ id: expect.any(String), by: "system", text: "You applied on CareerMetro. Example Labs can message you here about this application." }]);
    // Nothing for the company to read yet: Corporate Messages lists chats with a message in them.
    expect(await companyMessages(s.admin, at())).toMatchObject({ ok: true, view: { company: "Example Labs", status: "verified", items: [] } });
  });

  it("lets the job team write and ask a question; the candidate reads who wrote it and replies; unread on both sides", async () => {
    const s = await setup("talk");
    const MIN = 1 / 1440;
    expect(await send(s.hr, s.applicationId, HELLO, MIN)).toMatchObject({ ok: true });
    expect(await send(s.admin, s.applicationId, QUESTION, 2 * MIN, true)).toMatchObject({ ok: true });

    const [thread] = await listThreads(s.me, at(3 * MIN));
    expect(thread.unread).toBe(true);
    expect(await unreadChats(s.me, db!)).toBe(1);
    expect(thread.messages.slice(1)).toEqual([
      { id: expect.any(String), by: "them", who: "Rahul Menon", text: HELLO, at: expect.any(String) },
      { id: expect.any(String), by: "them", who: "Meera Iyer", type: "question", text: QUESTION, at: expect.any(String) },
    ]);
    await markRead(s.me, thread.id, at(3 * MIN));
    expect(await unreadChats(s.me, db!)).toBe(0);
    expect(await sendMessage(s.me, thread.id, REPLY, at(4 * MIN))).toMatchObject({ ok: true });

    // Rahul last read when he wrote, so the reply is new to him and the admin's question is too.
    const list = await companyMessages(s.hr, at(5 * MIN));
    if (!list.ok) throw new Error(list.error);
    expect(list.view.items).toEqual([{ applicationId: s.applicationId, name: "Priya Nair", job: "SOC Analyst L1", stage: "applied", preview: REPLY, at: expect.any(String), unread: true }]);
    const opened = await companyChat(s.hr, s.applicationId, { ...at(5 * MIN), markRead: true });
    if (!opened.ok) throw new Error(opened.error);
    expect(opened.chat).toMatchObject({ applicationId: s.applicationId, jobId: s.jobId, job: "SOC Analyst L1", candidate: "Priya Nair", stage: "applied", state: "open" });
    expect(opened.chat.messages.map((m) => [m.by, m.who, m.question ?? false])).toEqual([
      ["system", "", false],
      ["me", "You", false],
      ["team", "Meera Iyer", true],
      ["candidate", "Priya Nair", false],
    ]);
    const again = await companyMessages(s.hr, at(5 * MIN));
    expect(again.ok && again.view.items[0].unread).toBe(false);
    // The company never gets the candidate's email.
    expect(JSON.stringify([list, opened])).not.toContain("@example.test");
    const [row] = await db!.select({ kind: schema.messages.kind }).from(schema.messages).where(and(eq(schema.messages.body, QUESTION), eq(schema.messages.conversationId, (await conversationOf(s.applicationId)).id)));
    expect(row.kind).toBe("ask_question");
  });

  it("shows a hidden message as the notice on both sides, never its text, and drops its question mark (FR-46)", async () => {
    const s = await setup("hidden");
    const MIN = 1 / 1440;
    expect(await send(s.hr, s.applicationId, HELLO, MIN)).toMatchObject({ ok: true });
    expect(await send(s.admin, s.applicationId, QUESTION, 2 * MIN, true)).toMatchObject({ ok: true });
    const chat = await conversationOf(s.applicationId);
    const hide = (on: boolean) =>
      db!
        .update(schema.messages)
        .set(on ? { hiddenAt: clock, hiddenBy: s.admin, hiddenReason: "Test." } : { hiddenAt: null, hiddenBy: null, hiddenReason: null })
        .where(and(eq(schema.messages.conversationId, chat.id), inArray(schema.messages.body, [HELLO, QUESTION])));
    await hide(true);

    const [thread] = await listThreads(s.me, at(3 * MIN));
    expect(thread.messages.slice(1)).toEqual([
      { id: expect.any(String), by: "them", who: "Rahul Menon", text: HIDDEN_MESSAGE_TEXT, at: expect.any(String) },
      { id: expect.any(String), by: "them", who: "Meera Iyer", text: HIDDEN_MESSAGE_TEXT, at: expect.any(String) },
    ]);
    const opened = await companyChat(s.hr, s.applicationId, at(3 * MIN));
    if (!opened.ok) throw new Error(opened.error);
    expect(opened.chat.messages.slice(1).map((m) => [m.by, m.text, m.question ?? false])).toEqual([
      ["me", HIDDEN_MESSAGE_TEXT, false],
      ["team", HIDDEN_MESSAGE_TEXT, false],
    ]);
    const list = await companyMessages(s.hr, at(3 * MIN));
    if (!list.ok) throw new Error(list.error);
    expect(list.view.items[0].preview).toBe(HIDDEN_MESSAGE_TEXT);
    for (const read of [thread, opened, list]) {
      expect(JSON.stringify(read)).not.toContain(HELLO);
      expect(JSON.stringify(read)).not.toContain(QUESTION);
    }

    // Shown again: the text is back, as it was.
    await hide(false);
    const [back] = await listThreads(s.me, at(3 * MIN));
    expect(back.messages.slice(1).map((m) => m.text)).toEqual([HELLO, QUESTION]);
  });

  it("takes a suspended candidate off the company's board, chats and drawer until the suspension is lifted (FR-46)", async () => {
    const s = await setup("suspended-person");
    expect(await send(s.hr, s.applicationId, HELLO)).toMatchObject({ ok: true });
    const suspend = (on: boolean) =>
      db!
        .update(schema.users)
        .set(on ? { suspendedAt: clock, suspendedBy: s.admin, suspendedReason: "Test." } : { suspendedAt: null, suspendedBy: null, suspendedReason: null })
        .where(eq(schema.users.id, s.me));
    const seen = async () => {
      const board = await jobBoard(s.admin, s.jobId, at());
      const list = await companyMessages(s.admin, at());
      if (!board.ok || !list.ok) throw new Error("unavailable");
      return { cards: board.board.cards.length, chats: list.view.items.length, chat: (await companyChat(s.admin, s.applicationId, at())).ok, drawer: (await openCandidate(s.admin, { applicationId: s.applicationId }, at())).ok };
    };
    expect(await seen()).toEqual({ cards: 1, chats: 1, chat: true, drawer: true });
    await suspend(true);
    expect(await seen()).toEqual({ cards: 0, chats: 0, chat: false, drawer: false });
    await suspend(false);
    expect(await seen()).toEqual({ cards: 1, chats: 1, chat: true, drawer: true });
  });

  it("keeps company chats out of a recruiter's personal Inbox, and the personal Inbox can't write in them", async () => {
    const s = await setup("separate");
    expect(await send(s.hr, s.applicationId, HELLO)).toMatchObject({ ok: true });
    await sendMessage(s.me, (await conversationOf(s.applicationId)).id, REPLY, at());
    expect(await listThreads(s.hr, at())).toEqual([]);
    expect(await unreadChats(s.hr, db!)).toBe(0);
    const chat = await conversationOf(s.applicationId);
    expect(await sendMessage(s.hr, chat.id, "From my personal Inbox", at())).toMatchObject({ ok: false, error: "not_found" });
    expect(await report(s.hr, { conversationId: chat.id, target: "chat", reason: "other" }, at())).toMatchObject({ ok: false, error: "not_found" });
  });

  it("checks the live role and job team: Hiring HR off the job, Interviewers and removed members can't read or send", async () => {
    const s = await setup("access");
    expect(await send(s.hr, s.applicationId, HELLO)).toMatchObject({ ok: true });
    expect(await companyChat(s.otherHr, s.applicationId, at())).toMatchObject({ ok: false, error: "not_allowed" });
    expect(await send(s.otherHr, s.applicationId, "Hello")).toMatchObject({ ok: false, error: "not_allowed" });
    expect(await companyMessages(s.otherHr, at())).toMatchObject({ ok: true, view: { items: [] } });
    // Interviewers read only the candidates assigned to them (interviews come in step 6) and never send.
    expect(await companyMessages(s.iv, at())).toMatchObject({ ok: true, view: { role: "interviewer", items: [] } });
    expect(await companyChat(s.iv, s.applicationId, at())).toMatchObject({ ok: false, error: "not_found" });
    expect(await send(s.iv, s.applicationId, "Hello")).toMatchObject({ ok: false, error: "read_only" });
    // Removing the role ends access on the next request.
    expect(await removeMember(s.admin, { memberId: s.hrMember }, deps())).toEqual({ ok: true });
    expect(await companyMessages(s.hr, at())).toMatchObject({ ok: false, error: "not_member" });
    expect(await companyChat(s.hr, s.applicationId, at())).toMatchObject({ ok: false, error: "not_member" });
    expect(await send(s.hr, s.applicationId, "Hello")).toMatchObject({ ok: false, error: "not_member" });
    // Someone outside the company.
    const stranger = await person("access-stranger");
    expect(await companyChat(stranger, s.applicationId, at())).toMatchObject({ ok: false, error: "not_member" });
    const count = await db!.select().from(schema.messages).where(eq(schema.messages.conversationId, (await conversationOf(s.applicationId)).id));
    expect(count.filter((m) => m.kind !== "system")).toHaveLength(1);
  });

  it("lets only a verified company message; the candidate sees no badge while it is suspended", async () => {
    const s = await setup("suspended");
    expect(await send(s.hr, s.applicationId, HELLO)).toMatchObject({ ok: true });
    await db!.update(schema.organizations).set({ reviewStatus: "suspended" }).where(eq(schema.organizations.id, s.orgId));
    expect(await send(s.hr, s.applicationId, "Another")).toMatchObject({ ok: false, error: "suspended" });
    // A suspended company reads nothing of its candidates' chats, not even the list (security review 2026-10-13).
    expect(await companyChat(s.admin, s.applicationId, at())).toEqual({ ok: false, error: "suspended" });
    const list = await companyMessages(s.admin, at());
    expect(list.ok && list.view).toMatchObject({ status: "suspended", items: [] });
    const [thread] = await listThreads(s.me, at());
    expect(thread).toMatchObject({ verified: false, state: "paused" });
    expect(await sendMessage(s.me, thread.id, REPLY, at())).toMatchObject({ ok: false, error: "paused" });
  });

  it("audits each message sent, and chat reads once a day per member and application, with ids only (security review 2026-10-13)", async () => {
    const s = await setup("audit");
    const auditOf = async () =>
      (await db!.select().from(schema.auditLogs).where(eq(schema.auditLogs.orgId, s.orgId))).filter((a) => ["message_sent", "chat_read"].includes(a.action));
    expect(await send(s.hr, s.applicationId, HELLO)).toMatchObject({ ok: true });
    expect(await send(s.hr, s.applicationId, QUESTION, 0, true)).toMatchObject({ ok: true });
    // Read three times today by Hiring HR, once by the admin, then again the next day.
    for (let k = 0; k < 3; k++) expect((await companyChat(s.hr, s.applicationId, { ...at(), markRead: true })).ok).toBe(true);
    expect((await companyChat(s.admin, s.applicationId, at())).ok).toBe(true);
    expect((await companyChat(s.hr, s.applicationId, at(1))).ok).toBe(true);
    const lines = await auditOf();
    const hrActor = `member:${s.hrMember}`;
    expect(lines.filter((l) => l.action === "message_sent").map((l) => [l.actor, l.target])).toEqual([
      [hrActor, `application:${s.applicationId}`],
      [hrActor, `application:${s.applicationId}`],
    ]);
    const reads = lines.filter((l) => l.action === "chat_read");
    expect(reads.filter((l) => l.actor === hrActor)).toHaveLength(2);
    expect(reads.filter((l) => l.actor !== hrActor)).toHaveLength(1);
    for (const l of lines) {
      expect(l.target).toBe(`application:${s.applicationId}`);
      expect(JSON.stringify(l)).not.toMatch(/Splunk|SIEM|Priya|Rahul/);
    }
  });

  it("closes the chat 30 days after Not this time, and at once when the candidate withdraws", async () => {
    const s = await setup("close");
    expect(await moveApplication(s.admin, { applicationId: s.applicationId, to: "not_this_time", note: NOTE }, at())).toEqual({ ok: true });
    const chatId = (await conversationOf(s.applicationId)).id;
    expect(await send(s.hr, s.applicationId, HELLO, 29)).toMatchObject({ ok: true });
    expect(await sendMessage(s.me, chatId, REPLY, at(29))).toMatchObject({ ok: true });
    expect(await send(s.hr, s.applicationId, "Late", 31)).toMatchObject({ ok: false, error: "closed" });
    expect(await sendMessage(s.me, chatId, "Late", at(31))).toMatchObject({ ok: false, error: "closed" });
    const late = await companyChat(s.hr, s.applicationId, at(31));
    expect(late.ok && late.chat.state).toBe("closed");
    expect((await listThreads(s.me, at(31)))[0].state).toBe("closed");

    const w = await setup("withdraw");
    expect(await send(w.hr, w.applicationId, HELLO)).toMatchObject({ ok: true });
    expect(await withdrawApplication(w.me, { applicationId: w.applicationId }, at(1))).toEqual({ ok: true });
    expect(await send(w.hr, w.applicationId, "Still there?", 1)).toMatchObject({ ok: false, error: "not_found" });
    expect(await companyChat(w.hr, w.applicationId, at(1))).toMatchObject({ ok: false, error: "not_found" });
    expect(await companyMessages(w.hr, at(1))).toMatchObject({ ok: true, view: { items: [] } });
    const [thread] = await listThreads(w.me, at(1));
    expect(thread.state).toBe("closed");
    expect(await sendMessage(w.me, thread.id, REPLY, at(1))).toMatchObject({ ok: false, error: "closed" });
  });

  it("takes Report and Block from the Inbox: the report goes to the queue, the chat closes and leaves the Inbox", async () => {
    const s = await setup("block");
    expect(await send(s.hr, s.applicationId, HELLO)).toMatchObject({ ok: true });
    const chatId = (await conversationOf(s.applicationId)).id;
    const [thread] = await listThreads(s.me, at());
    const fromCompany = thread.messages.find((m) => m.by === "them")!;
    // Report one message, then the chat with Block.
    expect(await report(s.me, { conversationId: chatId, target: "message", messageId: fromCompany.id, reason: "money_or_otp" }, at())).toMatchObject({ ok: true });
    expect(await report(s.me, { conversationId: chatId, target: "chat", reason: "fake_or_spam", block: true }, at())).toMatchObject({ ok: true });
    const filed = await db!.select().from(schema.reports).where(eq(schema.reports.reporterId, s.me));
    expect(filed.map((r) => [r.target, r.targetId, r.status]).sort()).toEqual(
      [
        ["chat", chatId, "open"],
        ["message", fromCompany.id, "open"],
      ].sort(),
    );
    expect((await conversationOf(s.applicationId)).status).toBe("closed");
    expect(await listThreads(s.me, at())).toEqual([]);
    expect(await send(s.hr, s.applicationId, "Hello?")).toMatchObject({ ok: false, error: "closed" });
    // The application itself goes on.
    expect((await db!.select().from(schema.applications).where(eq(schema.applications.id, s.applicationId)))[0].withdrawnAt).toBeNull();
  });

  it("rate-limits the company's messages per day, and the candidate's", async () => {
    const s = await setup("limit");
    for (let i = 0; i < LIMITS.companyMessagesPerCompanyDay.max; i++) await takeShared(LIMITS.companyMessagesPerCompanyDay, s.orgId, { db: db!, now: clock.getTime() });
    expect(await send(s.admin, s.applicationId, HELLO)).toMatchObject({ ok: false, error: "limit" });
    const chatId = (await conversationOf(s.applicationId)).id;
    for (let i = 0; i < LIMITS.applicationMessagesPerUserDay.max; i++) await takeShared(LIMITS.applicationMessagesPerUserDay, s.me, { db: db!, now: clock.getTime() });
    expect(await sendMessage(s.me, chatId, REPLY, at())).toMatchObject({ ok: false, error: "limit" });
  });

  it("limits the company's messages to one candidate a day, whoever on the team writes", async () => {
    const s = await setup("perapp");
    for (let i = 0; i < LIMITS.companyMessagesPerApplicationDay.max; i++)
      expect(await send(i % 2 ? s.hr : s.admin, s.applicationId, `Note ${i}`, (i + 1) / 1440)).toMatchObject({ ok: true });
    expect(await send(s.hr, s.applicationId, HELLO, 30 / 1440)).toMatchObject({ ok: false, error: "limit" });
    // The next day the chat takes messages again.
    expect(await send(s.hr, s.applicationId, HELLO, 1)).toMatchObject({ ok: true });
  });

  it("keeps a deleted recruiter's messages, from the company team", async () => {
    const s = await setup("purge");
    expect(await send(s.hr, s.applicationId, HELLO, 1 / 1440)).toMatchObject({ ok: true });
    await db!.update(schema.users).set({ deletionRequestedAt: new Date(clock.getTime() - 40 * DAY) }).where(eq(schema.users.id, s.hr));
    expect(await purgeDeletedAccounts(db!, clock)).toBeGreaterThanOrEqual(1);
    const [kept] = await db!.select().from(schema.messages).where(and(eq(schema.messages.body, HELLO), eq(schema.messages.conversationId, (await conversationOf(s.applicationId)).id)));
    expect(kept.senderId).toBeNull();
    const [thread] = await listThreads(s.me, at());
    expect(thread.messages.at(-1)).toMatchObject({ by: "them", who: "The company team", text: HELLO });
    const opened = await companyChat(s.admin, s.applicationId, at());
    expect(opened.ok && opened.chat.messages.at(-1)).toMatchObject({ by: "team", who: "The company team", text: HELLO });
  });

  it("puts company chats in Download your data: the candidate's and the recruiter's own messages, never the other side's", async () => {
    const s = await setup("export");
    expect(await send(s.hr, s.applicationId, HELLO)).toMatchObject({ ok: true });
    await sendMessage(s.me, (await conversationOf(s.applicationId)).id, REPLY, at());
    expect(EXPORT_VERSION).toBe(18);
    const mine = await exportAccountData(s.me, db!, clock);
    expect(mine!.exportVersion).toBe(18);
    const chat = mine!.inbox.chats.find((c) => c.kind === "application")!;
    expect(chat).toMatchObject({ company: "Example Labs", job: "SOC Analyst L1", side: "candidate" });
    expect(chat.yourMessages.map((m) => m.body)).toEqual([REPLY]);
    const hrData = await exportAccountData(s.hr, db!, clock);
    const hrChat = hrData!.inbox.chats.find((c) => c.kind === "application")!;
    expect(hrChat).toMatchObject({ company: "Example Labs", job: "SOC Analyst L1", side: "company" });
    expect(hrChat.yourMessages.map((m) => m.body)).toEqual([HELLO]);
    const text = JSON.stringify(hrData);
    expect(text).not.toContain(REPLY);
    expect(text).not.toContain("Priya");
  });

  it("never shows a company member their own application's chat from the company side", async () => {
    const s = await setup("own");
    const own = await candidate("own-admin2", "Meera Iyer");
    const d = (await db!.select({ d: schema.organizations.emailDomain }).from(schema.organizations).where(eq(schema.organizations.id, s.orgId)))[0].d!;
    await join(s.admin, own, d, "admin", "meera2");
    const applied = await applyToJob(own, { jobId: s.jobId, canJoin: "now", consent: true }, at());
    if (!applied.ok) throw new Error(applied.error);
    expect(await companyChat(own, applied.applicationId, at())).toMatchObject({ ok: false, error: "not_found" });
    expect(await send(own, applied.applicationId, "Hello me")).toMatchObject({ ok: false, error: "not_found" });
    expect(await send(s.admin, applied.applicationId, HELLO)).toMatchObject({ ok: true });
    const list = await companyMessages(own, at());
    expect(list.ok && list.view.items.map((i) => i.applicationId)).toEqual([]);
    // Their own side of it is in their Inbox as a candidate.
    expect((await listThreads(own, at())).map((t) => t.kind)).toEqual(["application"]);
    expect(await db!.select().from(schema.conversationMembers).where(and(eq(schema.conversationMembers.userId, own), eq(schema.conversationMembers.role, "company_team")))).toEqual([]);
  });
});
