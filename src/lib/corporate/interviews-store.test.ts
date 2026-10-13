import { and, eq, inArray, like, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { roleProfiles, skills } from "@/content";
import * as schema from "@/db/schema";
import { purgeDeletedAccounts } from "@/lib/account/delete";
import { EXPORT_VERSION, exportAccountData } from "@/lib/account/export";
import { MATCHER_VERSION } from "@/lib/gaps/match";
import { listThreads } from "@/lib/inbox/store";
import type { GapAnalysis, Profile } from "@/lib/schemas";
import { applyToJob, exportApplications, jobBoard, moveApplication, myApplications, openCandidate, withdrawApplication } from "./applications-store";
import { companyChat, companyMessages, sendCompanyMessage } from "./chats-store";
import {
  askForTimes,
  cancelInterview,
  companyInterviews,
  exportInterviewer,
  offerTimes,
  respondToInterview,
  scheduleInterview,
  schedulingView,
  stopSharingPhone,
  submitFeedback,
} from "./interviews-store";
import { requirementsFromRole, roleBySlug } from "./job-content";
import { saveJob } from "./jobs-store";
import { activeMembership, finishCompanySignup, finishJoin, inviteMember, startCompanySignup, startJoin, type CorporateDeps } from "./store";

vi.mock("server-only", () => ({}));

// Interviews (dev/corporate-plan.md build step 6) against a real Postgres with migrations applied. Every person,
// company, phone number and line of feedback here is made up.
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
const PHONE_SHOWN = "+91 98765 43210";
const FEEDBACK = "Walked through two phishing alerts end to end and wrote clear incident notes.";
const FEEDBACK_2 = "Changed my mind after the debrief: strong triage, thin on cloud logs.";

describe.skipIf(!db)("interviews (database)", () => {
  const run = `ivs${Date.now()}`;
  const userIds: string[] = [];
  // Tuesday 13 October 2026, 15:30 India time.
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
    await db!.delete(schema.organizations).where(like(schema.organizations.emailDomain, `%${run}%`));
    if (userIds.length) await db!.delete(schema.users).where(inArray(schema.users.id, userIds));
    await sqlClient!.end();
    // Logs carry event names and reasons only: never a phone, feedback, a name or an offered time.
    const all = lines.join("\n");
    for (const secret of ["98765", "phishing alerts", "cloud logs", "Priya", "Sana", "Meera", "Rahul", "Wed 14 Oct", "2026-10-14T"]) expect(all).not.toContain(secret);
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
  /** A verified company: an admin, Hiring HR on the job, Hiring HR not on it, an Interviewer on it, an open job and one application. */
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
    return { orgId: done.orgId, admin, adminMember, hr, hrMember, otherHr, otherMember, iv, ivMember, me, jobId: saved.jobId, applicationId: applied.applicationId };
  }
  /** Asks for times as Hiring HR and has the candidate offer `keys`; returns the slot ids by key. */
  async function offered(s: { hr: string; me: string; applicationId: string }, keys: string[], asker = s.hr) {
    const asked = await askForTimes(asker, { applicationId: s.applicationId }, at());
    if (!asked.ok) throw new Error(asked.error);
    const r = await offerTimes(s.me, { messageId: asked.messageId, slots: keys }, at());
    if (!r.ok) throw new Error(r.error);
    const rows = await db!.select().from(schema.candidateSlots).where(eq(schema.candidateSlots.askMessageId, asked.messageId));
    return { messageId: asked.messageId, slot: (key: string) => rows.find((x) => x.startsAt.getTime() === new Date(`${key}:00+05:30`).getTime())!.id };
  }

  it("asks for times in the chat; the candidate offers only times from the days asked, once, and only those reach the company", async () => {
    const s = await setup("ask");
    // Interviewers and Hiring HR off the job can't ask.
    expect(await askForTimes(s.iv, { applicationId: s.applicationId }, at())).toMatchObject({ ok: false, error: "read_only" });
    expect(await askForTimes(s.otherHr, { applicationId: s.applicationId }, at())).toMatchObject({ ok: false, error: "not_allowed" });
    const asked = await askForTimes(s.hr, { applicationId: s.applicationId }, at());
    if (!asked.ok) throw new Error(asked.error);
    expect(await askForTimes(s.admin, { applicationId: s.applicationId }, at())).toMatchObject({ ok: false, error: "already_asked" });

    // The candidate sees the card in their Inbox: the next five weekdays, India time.
    const [thread] = await listThreads(s.me, at());
    const card = thread.messages.find((m) => m.type === "times")!;
    expect(card.ask).toMatchObject({ messageId: asked.messageId, offered: null, open: true });
    expect(card.ask!.days.map((d) => d.day)).toEqual(["2026-10-14", "2026-10-15", "2026-10-16", "2026-10-19", "2026-10-20"]);
    expect(card.text).toContain("Wed 14 Oct and Tue 20 Oct");

    // Only the asked days; not the candidate's own message; nothing the day of the ask.
    expect(await offerTimes(s.me, { messageId: asked.messageId, slots: ["2026-10-21T11:00"] }, at())).toMatchObject({ ok: false, error: "not_offered" });
    expect(await offerTimes(s.hr, { messageId: asked.messageId, slots: ["2026-10-14T11:00"] }, at())).toMatchObject({ ok: false, error: "not_found" });
    // Less than two hours ahead is too soon: 10:00 on the 14th, asked at 09:00 that morning.
    expect(await offerTimes(s.me, { messageId: asked.messageId, slots: ["2026-10-14T10:00"] }, { db: db!, now: new Date("2026-10-14T03:30:00Z") })).toMatchObject({
      ok: false,
      error: "too_soon",
    });
    expect(await offerTimes(s.me, { messageId: asked.messageId, slots: ["2026-10-15T10:00", "2026-10-14T11:00"] }, at(1 / 1440))).toEqual({ ok: true, offered: 2 });
    expect(await offerTimes(s.me, { messageId: asked.messageId, slots: ["2026-10-16T15:00"] }, at())).toMatchObject({ ok: false, error: "answered" });

    // The company sees the times on the card and in the candidate's own line, never anything else from their calendar.
    const chat = await companyChat(s.hr, s.applicationId, at());
    if (!chat.ok) throw new Error(chat.error);
    const asks = chat.chat.messages.filter((m) => m.times);
    expect(asks).toHaveLength(1);
    expect(asks[0]!.times!.offered).toEqual(["Wed 14 Oct, 11:00", "Thu 15 Oct, 10:00"]);
    expect(chat.chat.messages.at(-1)).toMatchObject({ by: "candidate", text: "I've offered 2 times: Wed 14 Oct, 11:00 · Thu 15 Oct, 10:00." });
    expect(chat.chat.canAskTimes).toBe(true);
    const [after] = await listThreads(s.me, at());
    expect(after.messages.find((m) => m.type === "times")!.ask).toMatchObject({ offered: ["Wed 14 Oct, 11:00", "Thu 15 Oct, 10:00"], open: false });

    // Answered, the team may ask again.
    expect(await askForTimes(s.hr, { applicationId: s.applicationId }, at())).toMatchObject({ ok: true });
  });

  it("books an offered time with interviewers from the job's team, refuses clashes, and shows the interviewer that candidate read only", async () => {
    const s = await setup("book");
    const { slot } = await offered(s, ["2026-10-14T11:00", "2026-10-15T10:00"]);
    const view = await schedulingView(s.hr, s.applicationId, at());
    if (!view.ok) throw new Error(view.error);
    expect(view.view.slots.map((x) => x.label)).toEqual(["Wed 14 Oct, 11:00", "Thu 15 Oct, 10:00"]);
    // The job's team and Recruiter admins; never Hiring HR off the job, never the candidate.
    expect(view.view.team.map((t) => t.name).sort()).toEqual(["Meera Iyer", "Rahul Menon", "Sana Qureshi"]);
    expect(await schedulingView(s.iv, s.applicationId, at())).toMatchObject({ ok: false, error: "not_found" });

    // Before an interview the Interviewer sees nothing of the candidate.
    expect(await openCandidate(s.iv, { applicationId: s.applicationId }, at())).toMatchObject({ ok: false });
    const board0 = await jobBoard(s.iv, s.jobId, at());
    expect(board0.ok && board0.board.cards).toEqual([]);

    const base = { applicationId: s.applicationId, minutes: 45 };
    expect(await scheduleInterview(s.iv, { ...base, slotId: slot("2026-10-14T11:00"), interviewers: [s.ivMember] }, at())).toMatchObject({ ok: false, error: "read_only" });
    expect(await scheduleInterview(s.hr, { ...base, slotId: slot("2026-10-14T11:00"), interviewers: [s.otherMember] }, at())).toMatchObject({ ok: false, error: "bad_interviewer" });
    const booked = await scheduleInterview(s.hr, { ...base, slotId: slot("2026-10-14T11:00"), interviewers: [s.ivMember] }, at());
    if (!booked.ok) throw new Error(booked.error);
    expect(await scheduleInterview(s.admin, { ...base, slotId: slot("2026-10-14T11:00"), interviewers: [s.adminMember] }, at())).toMatchObject({ ok: false, error: "slot_gone" });

    // Another candidate offering the same time can't have Sana then: she is busy (shown without whose interview).
    const other = await candidate("book-cand2", "Ananya Ghosh");
    const second = await applyToJob(other, { jobId: s.jobId, canJoin: "now", consent: true }, at());
    if (!second.ok) throw new Error(second.error);
    const two = await offered({ hr: s.hr, me: other, applicationId: second.applicationId }, ["2026-10-14T11:00", "2026-10-16T15:00"]);
    const view2 = await schedulingView(s.hr, second.applicationId, at());
    expect(view2.ok && view2.view.team.find((t) => t.memberId === s.ivMember)!.busyKeys).toEqual(["2026-10-14T11:00"]);
    expect(view2.ok && JSON.stringify(view2.view.teamWeek)).not.toContain("Priya");
    expect(await scheduleInterview(s.hr, { applicationId: second.applicationId, slotId: two.slot("2026-10-14T11:00"), minutes: 30, interviewers: [s.ivMember] }, at())).toMatchObject({
      ok: false,
      error: "busy",
    });

    // Now Sana sees Priya read only: on the board, in the drawer, and in the chat, where she can't write.
    const board = await jobBoard(s.iv, s.jobId, at());
    expect(board.ok && board.board.cards.map((c) => c.applicationId)).toEqual([s.applicationId]);
    const drawer = await openCandidate(s.iv, { applicationId: s.applicationId }, at());
    if (!drawer.ok) throw new Error(drawer.error);
    expect(drawer.candidate.interviews).toMatchObject({ canSchedule: false, phone: null });
    expect(drawer.candidate.interviews.interviews[0]).toMatchObject({ status: "proposed", when: "Wed 14 Oct, 11:00", range: "11:00 to 11:45", interviewers: ["Sana Qureshi"], canCancel: false });
    const list = await companyMessages(s.iv, at());
    expect(list.ok && list.view.items.map((i) => i.applicationId)).toEqual([s.applicationId]);
    const chat = await companyChat(s.iv, s.applicationId, at());
    expect(chat.ok && chat.chat.state).toBe("read_only");
    expect(chat.ok && chat.chat.canAskTimes).toBe(false);
    expect(await sendCompanyMessage(s.iv, { applicationId: s.applicationId, body: "Hello there", question: false }, at())).toMatchObject({ ok: false });
    expect(await moveApplication(s.iv, { applicationId: s.applicationId, to: "team", note: "" }, at())).toMatchObject({ ok: false });
    // Corporate Interviews: Sana sees hers; Hiring HR off the job sees none.
    const mine = await companyInterviews(s.iv, at());
    expect(mine.ok && mine.view.items.map((i) => [i.candidate, i.assigned])).toEqual([["Priya Nair", true]]);
    const off = await companyInterviews(s.otherHr, at());
    expect(off.ok && off.view.items).toEqual([]);

    // Cancelling ends Sana's access again.
    expect(await cancelInterview(s.iv, { interviewId: booked.interviewId }, at())).toMatchObject({ ok: false, error: "read_only" });
    expect(await cancelInterview(s.hr, { interviewId: booked.interviewId }, at())).toEqual({ ok: true });
    expect(await openCandidate(s.iv, { applicationId: s.applicationId }, at())).toMatchObject({ ok: false });
  });

  it("lets the candidate accept, sharing a phone only by choice, shown only to that interview's team, and take it back", async () => {
    const s = await setup("phone");
    const { slot } = await offered(s, ["2026-10-14T11:00", "2026-10-15T10:00"]);
    const one = await scheduleInterview(s.hr, { applicationId: s.applicationId, slotId: slot("2026-10-14T11:00"), minutes: 30, interviewers: [s.ivMember] }, at());
    if (!one.ok) throw new Error(one.error);

    // Arrivals shows it to answer; never who booked it.
    const [app] = await myApplications(s.me, at());
    expect(app.interviews).toEqual([
      { id: one.interviewId, round: "team", day: "2026-10-14", when: "Wed 14 Oct, 11:00", range: "11:00 to 11:30", minutes: 30, status: "proposed", canRespond: true, phoneShared: false },
    ]);
    expect(await respondToInterview(s.hr, { interviewId: one.interviewId, answer: "accept", sharePhone: false }, at())).toMatchObject({ ok: false, error: "not_found" });

    // Feedback waits for the candidate's answer.
    expect(await submitFeedback(s.iv, { interviewId: one.interviewId, recommendation: "yes", text: FEEDBACK }, at())).toMatchObject({ ok: false, error: "not_accepted" });

    // In production without PHONE_KEY or NAME_HASH_KEY, sharing is off; nothing changes and accepting without it works.
    const noKey = { db: db!, now: clock, env: { VERCEL_ENV: "production", CRON_SECRET: "c" } };
    expect(await respondToInterview(s.me, { interviewId: one.interviewId, answer: "accept", sharePhone: true, phone: PHONE }, noKey)).toMatchObject({ ok: false, error: "phone_unavailable" });
    expect((await myApplications(s.me, at()))[0]!.interviews[0]!.status).toBe("proposed");

    expect(await respondToInterview(s.me, { interviewId: one.interviewId, answer: "accept", sharePhone: true, phone: PHONE }, at())).toEqual({ ok: true });
    expect(await respondToInterview(s.me, { interviewId: one.interviewId, answer: "decline" }, at())).toMatchObject({ ok: false, error: "answered" });
    // Stored sealed, never as typed.
    const [row] = await db!.select({ phone: schema.applications.phoneShared }).from(schema.applications).where(eq(schema.applications.id, s.applicationId));
    expect(row.phone).toMatch(/^v2:/);
    expect(row.phone).not.toContain("98765");

    // Without the key in production it isn't opened for anyone.
    const blind = await openCandidate(s.hr, { applicationId: s.applicationId }, noKey);
    expect(blind.ok && blind.candidate.interviews.phone).toBeNull();
    // The job team and the interviewer on it see it; Hiring HR off the job sees nothing of the candidate.
    for (const who of [s.hr, s.admin, s.iv]) {
      const r = await openCandidate(who, { applicationId: s.applicationId }, at());
      expect(r.ok && r.candidate.interviews.phone).toBe(PHONE_SHOWN);
    }
    expect(await openCandidate(s.otherHr, { applicationId: s.applicationId }, at())).toMatchObject({ ok: false });

    // An interviewer on a later interview that the phone wasn't shared for doesn't see it.
    const later = await scheduleInterview(s.hr, { applicationId: s.applicationId, slotId: slot("2026-10-15T10:00"), minutes: 30, interviewers: [s.adminMember] }, at());
    expect(later.ok).toBe(true);
    const sana = await openCandidate(s.iv, { applicationId: s.applicationId }, at());
    expect(sana.ok && sana.candidate.interviews.phone).toBe(PHONE_SHOWN);

    // Download your data has the person's interviews, times offered and the phone they shared.
    const exported = await exportApplications(s.me, db!, env);
    expect(exported[0]!.phoneSharedWithCompany).toBe(PHONE_SHOWN);
    expect(exported[0]!.interviews.map((x) => x.status)).toEqual(["accepted", "proposed"]);
    expect(exported[0]!.timesOffered).toHaveLength(2);

    // Stop sharing erases it.
    expect(await stopSharingPhone(s.me, { applicationId: s.applicationId }, at())).toEqual({ ok: true });
    const gone = await openCandidate(s.hr, { applicationId: s.applicationId }, at());
    expect(gone.ok && gone.candidate.interviews.phone).toBeNull();
    const [cleared] = await db!.select({ phone: schema.applications.phoneShared }).from(schema.applications).where(eq(schema.applications.id, s.applicationId));
    expect(cleared.phone).toBeNull();
  });

  it("takes feedback from the interviewers on it only, shows it to the job team, never to the candidate, and keeps it when they leave", async () => {
    const s = await setup("feedback");
    const { slot } = await offered(s, ["2026-10-14T11:00"]);
    const one = await scheduleInterview(s.hr, { applicationId: s.applicationId, slotId: slot("2026-10-14T11:00"), minutes: 60, interviewers: [s.ivMember] }, at());
    if (!one.ok) throw new Error(one.error);
    expect(await respondToInterview(s.me, { interviewId: one.interviewId, answer: "accept", sharePhone: false }, at())).toEqual({ ok: true });

    expect(await submitFeedback(s.admin, { interviewId: one.interviewId, recommendation: "yes", text: FEEDBACK }, at())).toMatchObject({ ok: false, error: "not_assigned" });
    expect(await submitFeedback(s.iv, { interviewId: one.interviewId, recommendation: "yes", text: "Good." }, at())).toMatchObject({ ok: false, error: "invalid" });
    expect(await submitFeedback(s.iv, { interviewId: one.interviewId, recommendation: "yes", text: FEEDBACK }, at())).toEqual({ ok: true });
    // Writing again replaces it: one per interviewer.
    expect(await submitFeedback(s.iv, { interviewId: one.interviewId, recommendation: "not_sure", text: FEEDBACK_2 }, at(2))).toEqual({ ok: true });
    expect(await db!.select().from(schema.interviewFeedback).where(eq(schema.interviewFeedback.interviewId, one.interviewId))).toHaveLength(1);

    const team = await openCandidate(s.hr, { applicationId: s.applicationId }, at(2));
    expect(team.ok && team.candidate.interviews.interviews[0]!.feedback).toEqual([{ by: "Sana Qureshi", mine: false, recommendation: "not_sure", text: FEEDBACK_2, on: "2026-10-15" }]);
    // After the interview's hour it reads as done, still open to feedback.
    expect(team.ok && team.candidate.interviews.interviews[0]!.status).toBe("done");
    const own = await openCandidate(s.iv, { applicationId: s.applicationId }, at(2));
    expect(own.ok && own.candidate.interviews.interviews[0]).toMatchObject({ canGiveFeedback: true, feedback: [{ by: "Sana Qureshi", mine: true }] });
    // Her access ends 7 days after the interview ends (Wed 14 Oct, 12:00 India time): there on the 21st at 11:00, gone at 12:30.
    expect((await openCandidate(s.iv, { applicationId: s.applicationId }, { db: db!, env, now: new Date("2026-10-21T05:30:00Z") })).ok).toBe(true);
    expect(await openCandidate(s.iv, { applicationId: s.applicationId }, { db: db!, env, now: new Date("2026-10-21T07:00:00Z") })).toMatchObject({ ok: false });
    const lateBoard = await jobBoard(s.iv, s.jobId, { db: db!, env, now: new Date("2026-10-21T07:00:00Z") });
    expect(lateBoard.ok && lateBoard.board.cards).toEqual([]);
    expect(await submitFeedback(s.iv, { interviewId: one.interviewId, recommendation: "yes", text: FEEDBACK }, { db: db!, now: new Date("2026-10-21T07:00:00Z") })).toMatchObject({ ok: false });

    // The candidate never sees feedback: not on Arrivals, not in their download.
    expect(JSON.stringify(await myApplications(s.me, at(2)))).not.toContain("debrief");
    const theirs = await exportAccountData(s.me, db!, clock);
    expect(theirs!.exportVersion).toBe(EXPORT_VERSION);
    expect(EXPORT_VERSION).toBe(10);
    expect(JSON.stringify(theirs)).not.toContain("debrief");
    // The interviewer's download has the interviews they were on and their own feedback, never the candidate's name.
    const hers = await exportInterviewer(s.iv, db!);
    expect(hers.feedbackYouWrote.map((f) => f.text)).toEqual([FEEDBACK_2]);
    expect(hers.interviewsYouWereOn).toHaveLength(1);
    expect(JSON.stringify(hers)).not.toContain("Priya");
    expect((await exportAccountData(s.iv, db!, clock))!.interviewer.feedbackYouWrote).toHaveLength(1);

    // Sana deletes her account: the feedback stays with the company, from "A former team member".
    await db!.update(schema.users).set({ deletionRequestedAt: new Date(clock.getTime() - 40 * DAY) }).where(eq(schema.users.id, s.iv));
    expect(await purgeDeletedAccounts(db!, clock)).toBeGreaterThanOrEqual(1);
    const kept = await openCandidate(s.hr, { applicationId: s.applicationId }, at(2));
    expect(kept.ok && kept.candidate.interviews.interviews[0]!.feedback).toMatchObject([{ by: "A former team member", text: FEEDBACK_2 }]);
  });

  it("stops at a suspended company, cancels interviews ahead on Not this time and withdraw, and erases the phone on withdraw", async () => {
    const s = await setup("close");
    const { slot } = await offered(s, ["2026-10-14T11:00", "2026-10-15T10:00", "2026-10-16T15:00"]);
    const book = (key: string) => scheduleInterview(s.hr, { applicationId: s.applicationId, slotId: slot(key), minutes: 30, interviewers: [s.ivMember] }, at());
    const a = await book("2026-10-14T11:00");
    const b = await book("2026-10-15T10:00");
    if (!a.ok || !b.ok) throw new Error("not booked");

    await db!.update(schema.organizations).set({ reviewStatus: "suspended" }).where(eq(schema.organizations.id, s.orgId));
    expect(await askForTimes(s.admin, { applicationId: s.applicationId }, at())).toMatchObject({ ok: false, error: "suspended" });
    expect(await book("2026-10-16T15:00")).toMatchObject({ ok: false, error: "suspended" });
    // The candidate can't accept a suspended company's interview but can decline it.
    expect(await respondToInterview(s.me, { interviewId: a.interviewId, answer: "accept", sharePhone: false }, at())).toMatchObject({ ok: false, error: "paused" });
    expect(await respondToInterview(s.me, { interviewId: a.interviewId, answer: "decline" }, at())).toEqual({ ok: true });
    await db!.update(schema.organizations).set({ reviewStatus: "verified" }).where(eq(schema.organizations.id, s.orgId));
    expect(await respondToInterview(s.me, { interviewId: b.interviewId, answer: "accept", sharePhone: true, phone: PHONE }, at())).toEqual({ ok: true });

    // Not this time cancels what is ahead; asking for times is refused on a closed application.
    expect(await moveApplication(s.hr, { applicationId: s.applicationId, to: "not_this_time", note: "We need hands-on SIEM for this role." }, at())).toEqual({ ok: true });
    const statuses = async () => (await db!.select().from(schema.interviews).where(eq(schema.interviews.applicationId, s.applicationId))).map((x) => x.status).sort();
    expect(await statuses()).toEqual(["cancelled", "declined"]);
    expect(await askForTimes(s.hr, { applicationId: s.applicationId }, at())).toMatchObject({ ok: false, error: "closed" });
    // Not this time erases the shared phone too.
    const closed = await openCandidate(s.hr, { applicationId: s.applicationId }, at());
    expect(closed.ok && closed.candidate.interviews.phone).toBeNull();
    const [erased] = await db!.select({ phone: schema.applications.phoneShared }).from(schema.applications).where(eq(schema.applications.id, s.applicationId));
    expect(erased.phone).toBeNull();
    // The candidate is told in their own words that a closed application can't be answered.
    expect(await respondToInterview(s.me, { interviewId: b.interviewId, answer: "decline" }, at())).toMatchObject({ ok: false, error: "closed", message: expect.stringMatching(/application is closed/) });

    // Open again, book, and withdraw: the interview is cancelled and the phone erased.
    expect(await moveApplication(s.hr, { applicationId: s.applicationId, to: "team", note: "" }, at())).toEqual({ ok: true });
    const c = await book("2026-10-16T15:00");
    if (!c.ok) throw new Error(c.error);
    expect(await respondToInterview(s.me, { interviewId: c.interviewId, answer: "accept", sharePhone: true, phone: PHONE }, at())).toEqual({ ok: true });
    expect(await withdrawApplication(s.me, { applicationId: s.applicationId }, at())).toEqual({ ok: true });
    expect(await statuses()).toEqual(["cancelled", "cancelled", "declined"]);
    const [row] = await db!.select({ phone: schema.applications.phoneShared }).from(schema.applications).where(and(eq(schema.applications.id, s.applicationId)));
    expect(row.phone).toBeNull();
    expect(await openCandidate(s.iv, { applicationId: s.applicationId }, at())).toMatchObject({ ok: false });
  });

  it("never double-books an interviewer when two bookings for different candidates run at the same time", async () => {
    const s = await setup("race");
    const other = await candidate("race-cand2", "Ananya Ghosh");
    const second = await applyToJob(other, { jobId: s.jobId, canJoin: "now", consent: true }, at());
    if (!second.ok) throw new Error(second.error);
    const one = await offered(s, ["2026-10-14T11:00"]);
    const two = await offered({ hr: s.hr, me: other, applicationId: second.applicationId }, ["2026-10-14T11:00"]);
    const results = await Promise.all([
      scheduleInterview(s.hr, { applicationId: s.applicationId, slotId: one.slot("2026-10-14T11:00"), minutes: 45, interviewers: [s.ivMember] }, at()),
      scheduleInterview(s.admin, { applicationId: second.applicationId, slotId: two.slot("2026-10-14T11:00"), minutes: 45, interviewers: [s.ivMember] }, at()),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.find((r) => !r.ok)).toMatchObject({ ok: false, error: "busy" });
    const [count] = await db!
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.interviewInterviewers)
      .innerJoin(schema.interviews, eq(schema.interviews.id, schema.interviewInterviewers.interviewId))
      .where(and(eq(schema.interviewInterviewers.userId, s.iv), eq(schema.interviews.status, "proposed")));
    expect(count.n).toBe(1);
  });
});
