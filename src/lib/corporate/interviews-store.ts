import "server-only";
import { and, asc, eq, gt, gte, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { getDb } from "@/db";
import {
  applications,
  candidateSlots,
  conversationMembers,
  conversations,
  interviewFeedback,
  interviewInterviewers,
  interviews,
  jobs,
  jobTeam,
  messages,
  organizations,
  orgMembers,
  users,
} from "@/db/schema";
import { displayName } from "@/lib/account/name";
import { openApplicationChat } from "@/lib/inbox/store";
import { logEvent } from "@/lib/log";
import { indiaDay } from "@/lib/ride/days";
import { applicationIdInput, askTimesInput, feedbackInput, interviewIdInput, offerTimesInput, respondInput, scheduleInput } from "@/lib/schemas/corporate";
import { SLOT_MINUTES, SLOT_TIMES } from "@/lib/schemas/constants";
import { LIMITS, takeShared } from "@/lib/shared-limit";
import { visibleApplication } from "./applications-store";
import { writeAudit } from "./audit-line";
import { askDaysOf, busyOf, companyInterviewsOf, offeredState, overlaps } from "./interview-reads";
import { encryptPhone, phoneSharingAvailable } from "./phone";
import { canCancel, canRespond, chatClosed, feedbackRefusal, scheduleRefusal, shownStatus, type FeedbackRefusal, type ScheduleRefusal } from "./rules";
import { askDays, askText, dayParts, slotKeyOf, slotLabel, slotOpen, slotStart } from "./slots";
import { visibleApplicationsWhere } from "./scope";
import { activeMembership } from "./store";
import type { CompanyInterviewsView, InterviewerOptionView, InterviewListItem, OrgRole, SchedulerView } from "./types";

/*
 * Interviews (dev/corporate-plan.md build step 6; handoff 12b, 12e and section 9). The job team asks for times in the
 * application's chat; the candidate offers slots on a small week grid, and only those times reach the company. The
 * team books one of them with a round, a length and interviewers; the candidate accepts or declines on Arrivals and,
 * accepting, may choose to share a phone with that interview's team. Interviewers on a live interview see that
 * candidate read only and write feedback; they never move stages or send messages.
 *
 * Every company read and write re-reads the person's live org_members row and the job team (visibleApplication). A
 * suspended or unverified company books nothing. Logs carry event names and reasons only: never a name, a phone, a
 * time someone offered, or feedback text. Feedback is written by people; nothing here calls the model.
 */

type Db = ReturnType<typeof getDb>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
type Env = Record<string, string | undefined>;
export type InterviewDeps = { db?: Db; now?: Date; env?: Env };

const DAY = 86_400_000;

export type InterviewError =
  | "invalid"
  | "not_member"
  | "not_allowed"
  | "not_found"
  | "limit"
  | ScheduleRefusal
  | FeedbackRefusal
  | "paused"
  | "already_asked"
  | "answered"
  | "not_offered"
  | "too_soon"
  | "slot_gone"
  | "busy"
  | "bad_interviewer"
  | "not_open"
  | "phone_unavailable";

export const INTERVIEW_ERROR_TEXT: Record<InterviewError, string> = {
  invalid: "Check the details and try again.",
  not_member: "You don't have access to this company.",
  not_allowed: "Only Recruiter admins, and Hiring HR on this job, arrange interviews.",
  not_found: "That isn't available any more.",
  limit: "That's a lot of messages today. Try again tomorrow.",
  read_only: "Interviewers see their candidates and write feedback. Hiring HR and Recruiter admins arrange interviews.",
  suspended: "Your company can't arrange interviews until CareerMetro has verified it.",
  closed: "This application is closed, so no interviews can be arranged for it.",
  not_assigned: "Only the interviewers on this interview write feedback for it.",
  not_accepted: "Feedback opens once the candidate accepts the interview.",
  paused: "This company's interviews are paused while we review it.",
  already_asked: "You've already asked for times. Wait for their answer.",
  answered: "This has already been answered.",
  not_offered: "Pick times from the grid.",
  too_soon: "Pick times at least two hours from now.",
  slot_gone: "That time is already booked. Pick another.",
  busy: "One of the interviewers already has an interview then. Pick another time or interviewer.",
  bad_interviewer: "Pick interviewers from this job's team.",
  not_open: "That interview can't be changed now.",
  phone_unavailable: "Sharing a phone isn't available right now. You can accept without it.",
};

/** The candidate's words for a closed application (INTERVIEW_ERROR_TEXT.closed speaks to the company). */
const CANDIDATE_CLOSED = "This application is closed, so this interview can't be answered.";
const CHAT_CLOSED = "This chat is closed, so times can't be offered here.";

export type InterviewResult<T = object> = ({ ok: true } & T) | { ok: false; error: InterviewError; message?: string };
const fail = (error: InterviewError, message?: string) => ({ ok: false as const, error, ...(message ? { message } : {}) });
const companyFail = (error: string): { ok: false; error: InterviewError } =>
  fail(error === "not_member" || error === "not_allowed" ? (error as InterviewError) : "not_found");

/** Interviewer choices for a job: active members on the job's team, and Recruiter admins. Never the candidate. */
async function teamOptions(orgId: string, jobId: string, candidateId: string, db: Db | Tx) {
  return db
    .select({ memberId: orgMembers.id, userId: orgMembers.userId, role: orgMembers.role, name: users.name })
    .from(orgMembers)
    .innerJoin(users, eq(users.id, orgMembers.userId))
    .leftJoin(jobTeam, and(eq(jobTeam.jobId, jobId), eq(jobTeam.userId, orgMembers.userId)))
    .where(
      and(
        eq(orgMembers.orgId, orgId),
        isNull(orgMembers.removedAt),
        isNull(users.deletionRequestedAt),
        ne(orgMembers.userId, candidateId),
        or(eq(orgMembers.role, "admin"), sql`${jobTeam.userId} is not null`),
      ),
    )
    .orderBy(asc(users.name));
}

/* Ask for times --------------------------------------------------------------------------------------------------- */

/**
 * "Ask for times" in an application's chat: a card asking the candidate to pick times on the next five weekdays.
 * The job team of a verified company only, for an open application; one unanswered ask at a time. Counts as a company
 * message for the daily limits.
 */
export async function askForTimes(userId: string, raw: unknown, deps: InterviewDeps = {}): Promise<InterviewResult<{ messageId: string }>> {
  const db = deps.db ?? getDb();
  const now = deps.now ?? new Date();
  const parsed = askTimesInput.safeParse(raw);
  if (!parsed.success) return fail("invalid");
  const result = await db.transaction(async (tx): Promise<InterviewResult<{ messageId: string }>> => {
    const me = await activeMembership(userId, tx);
    if (!me) return fail("not_member");
    if (me.role === "interviewer") return fail("read_only");
    const found = await visibleApplication(userId, parsed.data.applicationId, tx, now, true);
    if (!found.ok) return companyFail(found.error);
    const { app, access } = found;
    if (app.withdrawnAt) return fail("not_found");
    const refusal = scheduleRefusal({ role: access.me.role, teamRole: access.teamRole, orgStatus: app.orgStatus, app: { stage: app.stage, withdrawn: false, jobStatus: app.jobStatus } });
    if (refusal) return fail(refusal);
    const conversationId = await openApplicationChat(tx, { applicationId: app.id, orgId: app.orgId, userId: app.userId }, now, false);
    const [conversation] = await tx.select({ status: conversations.status }).from(conversations).where(eq(conversations.id, conversationId)).for("update");
    if (chatClosed(app, conversation!.status, now)) return fail("closed");
    if ((await offeredState(app.id, conversationId, tx, now)).waitingForTimes) return fail("already_asked");
    const at = { db: tx, now: now.getTime() };
    if (!(await takeShared(LIMITS.companyMessagesPerApplicationDay, app.id, at))) return fail("limit");
    if (!(await takeShared(LIMITS.companyMessagesPerCompanyDay, app.orgId, at))) return fail("limit");
    const days = askDays(now);
    const [message] = await tx
      .insert(messages)
      .values({ conversationId, senderId: userId, kind: "ask_times", body: askText(days), payload: { days }, createdAt: now })
      .returning({ id: messages.id });
    await writeAudit(tx, { orgId: app.orgId, actor: { memberId: access.me.memberId }, action: "times_asked", target: { application: app.id } }, now);
    await tx.update(conversations).set({ lastMessageAt: now }).where(eq(conversations.id, conversationId));
    await tx
      .insert(conversationMembers)
      .values({ conversationId, userId, role: "company_team", lastReadAt: now })
      .onConflictDoUpdate({ target: [conversationMembers.conversationId, conversationMembers.userId], set: { lastReadAt: now } });
    return { ok: true, messageId: message.id };
  });
  logEvent("info", result.ok ? "interview_times_asked" : "interview_times_ask_refused", result.ok ? {} : { reason: result.error });
  return result;
}

/**
 * The candidate's answer to "Ask for times": the slots they pick, from the days asked, at least two hours ahead. Only
 * these times reach the company. Also writes a short line in the chat from the candidate naming the times, so the
 * company sees the answer arrive. Once per ask.
 */
export async function offerTimes(userId: string, raw: unknown, deps: InterviewDeps = {}): Promise<InterviewResult<{ offered: number }>> {
  const db = deps.db ?? getDb();
  const now = deps.now ?? new Date();
  const parsed = offerTimesInput.safeParse(raw);
  if (!parsed.success) return fail("invalid", parsed.error.issues[0]?.message);
  const result = await db.transaction(async (tx): Promise<InterviewResult<{ offered: number }>> => {
    const [row] = await tx
      .select({
        kind: messages.kind,
        payload: messages.payload,
        conversationId: messages.conversationId,
        status: conversations.status,
        applicationId: applications.id,
        owner: applications.userId,
        closedAt: applications.closedAt,
        withdrawnAt: applications.withdrawnAt,
        orgStatus: organizations.reviewStatus,
      })
      .from(messages)
      .innerJoin(conversations, eq(conversations.id, messages.conversationId))
      .innerJoin(applications, eq(applications.id, conversations.applicationId))
      .innerJoin(organizations, eq(organizations.id, applications.orgId))
      .where(eq(messages.id, parsed.data.messageId))
      .for("update", { of: conversations });
    if (!row || row.kind !== "ask_times" || row.owner !== userId) return fail("not_found");
    if (row.closedAt || chatClosed(row, row.status, now)) return fail("closed", CHAT_CLOSED);
    if (row.orgStatus !== "verified") return fail("paused");
    const [done] = await tx.select({ id: candidateSlots.id }).from(candidateSlots).where(eq(candidateSlots.askMessageId, parsed.data.messageId)).limit(1);
    if (done) return fail("answered");
    const days = askDaysOf(row.payload);
    const starts: Date[] = [];
    for (const key of parsed.data.slots) {
      const at = slotStart(key);
      if (!at || !days.includes(key.slice(0, 10))) return fail("not_offered");
      if (!slotOpen(at, now)) return fail("too_soon");
      starts.push(at);
    }
    starts.sort((a, b) => a.getTime() - b.getTime());
    if (!(await takeShared(LIMITS.applicationMessagesPerUserDay, userId, { db: tx, now: now.getTime() }))) return fail("limit");
    await tx.insert(candidateSlots).values(starts.map((startsAt) => ({ applicationId: row.applicationId, startsAt, minutes: SLOT_MINUTES, askMessageId: parsed.data.messageId, createdAt: now })));
    const n = starts.length;
    await tx.insert(messages).values({
      conversationId: row.conversationId,
      senderId: userId,
      body: `I've offered ${n} ${n === 1 ? "time" : "times"}: ${starts.map(slotLabel).join(" · ")}.`,
      createdAt: now,
    });
    await tx.update(conversations).set({ lastMessageAt: now }).where(eq(conversations.id, row.conversationId));
    await tx
      .update(conversationMembers)
      .set({ lastReadAt: now, hiddenAt: null })
      .where(and(eq(conversationMembers.conversationId, row.conversationId), eq(conversationMembers.userId, userId)));
    return { ok: true, offered: n };
  });
  logEvent("info", result.ok ? "interview_times_offered" : "interview_times_offer_refused", result.ok ? { count: result.offered } : { reason: result.error });
  return result;
}

/* The scheduler --------------------------------------------------------------------------------------------------- */

/** What the scheduler shows for one application: the offered times as a week grid, the interviewers and their busy times. */
export async function schedulingView(userId: string, applicationId: string, deps: InterviewDeps = {}): Promise<InterviewResult<{ view: SchedulerView }>> {
  const db = deps.db ?? getDb();
  const now = deps.now ?? new Date();
  const parsedId = applicationIdInput.safeParse({ applicationId });
  if (!parsedId.success) return fail("not_found");
  const found = await visibleApplication(userId, applicationId, db, now);
  if (!found.ok) return companyFail(found.error);
  const { app, access } = found;
  if (app.withdrawnAt) return fail("not_found");
  if (!access.canMove) return fail(access.me.role === "interviewer" ? "read_only" : "not_allowed");
  const refusal = scheduleRefusal({ role: access.me.role, teamRole: access.teamRole, orgStatus: app.orgStatus, app: { stage: app.stage, withdrawn: false, jobStatus: app.jobStatus } });
  const [slots, live, options, [chat]] = await Promise.all([
    db
      .select({ id: candidateSlots.id, startsAt: candidateSlots.startsAt })
      .from(candidateSlots)
      .where(and(eq(candidateSlots.applicationId, app.id), gt(candidateSlots.startsAt, now)))
      .orderBy(asc(candidateSlots.startsAt)),
    db
      .select({ slotId: interviews.slotId, startsAt: interviews.startsAt })
      .from(interviews)
      .where(and(eq(interviews.applicationId, app.id), inArray(interviews.status, ["proposed", "accepted"]))),
    teamOptions(app.orgId, app.jobId, app.userId, db),
    db.select({ id: conversations.id }).from(conversations).where(eq(conversations.applicationId, app.id)),
  ]);
  const open = slots.filter((s) => slotOpen(s.startsAt, now));
  // The same time offered in two answers shows once.
  const seen = new Set<string>();
  const unique = open.filter((s) => {
    const k = slotKeyOf(s.startsAt);
    return !seen.has(k) && !!seen.add(k);
  });
  const takenAt = new Set(live.map((l) => l.startsAt.getTime()));
  const weekEnd = new Date(now.getTime() + 7 * DAY);
  const last = unique.length ? new Date(unique[unique.length - 1]!.startsAt.getTime() + SLOT_MINUTES * 60_000) : now;
  const busy = await busyOf(
    options.map((o) => o.userId),
    now,
    last > weekEnd ? last : weekEnd,
    db,
  );
  const team: InterviewerOptionView[] = options.map((o) => {
    const mine = busy.filter((b) => b.userId === o.userId);
    return {
      memberId: o.memberId,
      name: displayName(o.name),
      role: o.role as OrgRole,
      busyKeys: unique.filter((s) => mine.some((b) => overlaps(s.startsAt, SLOT_MINUTES, b.startsAt, b.minutes))).map((s) => slotKeyOf(s.startsAt)),
      thisWeek: mine.filter((b) => b.startsAt < weekEnd).length,
    };
  });
  const names = new Map(options.map((o) => [o.userId, displayName(o.name)]));
  const teamWeek = busy
    .filter((b) => b.startsAt < weekEnd)
    .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())
    .map((b) => ({ when: slotLabel(b.startsAt), who: names.get(b.userId) ?? "" }));
  const days = [...new Set(unique.map((s) => indiaDay(s.startsAt)))].map((day) => ({ day, label: dayParts(day) }));
  const booked = await companyInterviewsOf([app.id], { userId, canMove: true }, db, now);
  const offered = await offeredState(app.id, chat?.id ?? null, db, now);
  return {
    ok: true,
    view: {
      applicationId: app.id,
      jobId: app.jobId,
      job: app.jobTitle,
      candidate: displayName(app.name),
      company: access.me.orgName,
      refusal: refusal ? INTERVIEW_ERROR_TEXT[refusal] : null,
      days,
      times: [...SLOT_TIMES],
      slots: unique.map((s) => {
        const key = slotKeyOf(s.startsAt);
        return { id: s.id, key, day: key.slice(0, 10), time: key.slice(11), label: slotLabel(s.startsAt), taken: takenAt.has(s.startsAt.getTime()) };
      }),
      team,
      teamWeek,
      interviews: booked.get(app.id) ?? [],
      waitingForTimes: offered.waitingForTimes,
    },
  };
}

/**
 * Books an interview on one of the candidate's offered times: the job team of a verified company, an open
 * application, a time still at least two hours ahead and not already booked, and interviewers from the job's team (or
 * Recruiter admins) who have no other interview then. The candidate answers on Arrivals.
 */
export async function scheduleInterview(userId: string, raw: unknown, deps: InterviewDeps = {}): Promise<InterviewResult<{ interviewId: string }>> {
  const db = deps.db ?? getDb();
  const now = deps.now ?? new Date();
  const parsed = scheduleInput.safeParse(raw);
  if (!parsed.success) return fail("invalid", parsed.error.issues[0]?.message);
  const input = parsed.data;
  const result = await db.transaction(async (tx): Promise<InterviewResult<{ interviewId: string }>> => {
    const me = await activeMembership(userId, tx);
    if (!me) return fail("not_member");
    if (me.role === "interviewer") return fail("read_only");
    const found = await visibleApplication(userId, input.applicationId, tx, now, true);
    if (!found.ok) return companyFail(found.error);
    const { app, access } = found;
    if (app.withdrawnAt) return fail("not_found");
    const refusal = scheduleRefusal({ role: access.me.role, teamRole: access.teamRole, orgStatus: app.orgStatus, app: { stage: app.stage, withdrawn: false, jobStatus: app.jobStatus } });
    if (refusal) return fail(refusal);
    const [slot] = await tx
      .select({ id: candidateSlots.id, startsAt: candidateSlots.startsAt, minutes: candidateSlots.minutes })
      .from(candidateSlots)
      .where(and(eq(candidateSlots.id, input.slotId), eq(candidateSlots.applicationId, app.id)));
    if (!slot) return fail("not_offered");
    if (!slotOpen(slot.startsAt, now)) return fail("too_soon");
    if (input.minutes > slot.minutes) return fail("invalid");
    const [taken] = await tx
      .select({ id: interviews.id })
      .from(interviews)
      .where(and(eq(interviews.applicationId, app.id), eq(interviews.startsAt, slot.startsAt), inArray(interviews.status, ["proposed", "accepted"])))
      .limit(1);
    if (taken) return fail("slot_gone");
    const options = await teamOptions(app.orgId, app.jobId, app.userId, tx);
    const chosen = input.interviewers.map((memberId) => options.find((o) => o.memberId === memberId));
    if (chosen.some((c) => !c)) return fail("bad_interviewer");
    const people = chosen.map((c) => c!.userId);
    // Two bookings at once (for different candidates) must not both pass the busy check for the same interviewer:
    // take a lock per interviewer, in a fixed order so two bookings can't wait on each other, then check.
    for (const id of [...people].sort()) await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`interviewer:${id}`}))`);
    const clash = await busyOf(people, slot.startsAt, new Date(slot.startsAt.getTime() + input.minutes * 60_000), tx);
    if (clash.length) return fail("busy");
    const [made] = await tx
      .insert(interviews)
      .values({ applicationId: app.id, round: input.round, startsAt: slot.startsAt, minutes: input.minutes, slotId: slot.id, createdBy: userId, createdAt: now })
      .returning({ id: interviews.id });
    await tx.insert(interviewInterviewers).values(people.map((p) => ({ interviewId: made.id, userId: p })));
    await writeAudit(tx, { orgId: app.orgId, actor: { memberId: access.me.memberId }, action: "interview_booked", target: { application: app.id } }, now);
    return { ok: true, interviewId: made.id };
  });
  logEvent("info", result.ok ? "interview_booked" : "interview_book_refused", result.ok ? { interviewers: input.interviewers.length } : { reason: result.error });
  return result;
}

/** Cancels an interview still ahead: the job team only. A suspended company may still cancel, which only helps the candidate. */
export async function cancelInterview(userId: string, raw: unknown, deps: InterviewDeps = {}): Promise<InterviewResult> {
  const db = deps.db ?? getDb();
  const now = deps.now ?? new Date();
  const parsed = interviewIdInput.safeParse(raw);
  if (!parsed.success) return fail("invalid");
  const result = await db.transaction(async (tx): Promise<InterviewResult> => {
    // Lock order everywhere: the application row first, then the interview.
    const [ref] = await tx.select({ applicationId: interviews.applicationId }).from(interviews).where(eq(interviews.id, parsed.data.interviewId));
    if (!ref) return fail("not_found");
    const found = await visibleApplication(userId, ref.applicationId, tx, now, true);
    if (!found.ok) return companyFail(found.error);
    const [iv] = await tx
      .select({ id: interviews.id, status: interviews.status, startsAt: interviews.startsAt })
      .from(interviews)
      .where(eq(interviews.id, parsed.data.interviewId))
      .for("update");
    if (!iv) return fail("not_found");
    if (!found.access.canMove) return fail(found.access.me.role === "interviewer" ? "read_only" : "not_allowed");
    if (!canCancel(iv, now)) return fail("not_open");
    await tx.update(interviews).set({ status: "cancelled", cancelledAt: now }).where(eq(interviews.id, iv.id));
    await writeAudit(tx, { orgId: found.app.orgId, actor: { memberId: found.access.me.memberId }, action: "interview_cancelled", target: { application: ref.applicationId } }, now);
    return { ok: true };
  });
  logEvent("info", result.ok ? "interview_cancelled" : "interview_cancel_refused", result.ok ? {} : { reason: result.error });
  return result;
}

/* The candidate --------------------------------------------------------------------------------------------------- */

/**
 * The candidate accepts or declines an interview on Arrivals, while it is proposed and ahead. Accepting, they may
 * choose to share a phone with the interview's team: it is stored encrypted on the application and shown only to that
 * team. A suspended company's interview can be declined but not accepted.
 */
export async function respondToInterview(userId: string, raw: unknown, deps: InterviewDeps = {}): Promise<InterviewResult> {
  const db = deps.db ?? getDb();
  const now = deps.now ?? new Date();
  const parsed = respondInput.safeParse(raw);
  if (!parsed.success) return fail("invalid", parsed.error.issues[0]?.message);
  const input = parsed.data;
  // Without a key (production before PHONE_KEY or NAME_HASH_KEY is set) a phone can't be kept safely, so sharing is off.
  if (input.answer === "accept" && input.sharePhone && !phoneSharingAvailable(deps.env)) {
    logEvent("warn", "phone_key_missing");
    logEvent("info", "interview_answer_refused", { reason: "phone_unavailable" });
    return fail("phone_unavailable");
  }
  const result = await db.transaction(async (tx): Promise<InterviewResult> => {
    // Lock order everywhere: the application row first, then the interview.
    const [ref] = await tx.select({ applicationId: interviews.applicationId }).from(interviews).where(eq(interviews.id, input.interviewId));
    if (!ref) return fail("not_found");
    const [app] = await tx
      .select({
        id: applications.id,
        owner: applications.userId,
        orgId: applications.orgId,
        closedAt: applications.closedAt,
        withdrawnAt: applications.withdrawnAt,
        orgStatus: organizations.reviewStatus,
      })
      .from(applications)
      .innerJoin(organizations, eq(organizations.id, applications.orgId))
      .where(eq(applications.id, ref.applicationId))
      .for("update", { of: applications });
    if (!app || app.owner !== userId) return fail("not_found");
    const [row] = await tx
      .select({ id: interviews.id, status: interviews.status, startsAt: interviews.startsAt })
      .from(interviews)
      .where(eq(interviews.id, input.interviewId))
      .for("update");
    if (!row) return fail("not_found");
    if (app.withdrawnAt || app.closedAt) return fail("closed", CANDIDATE_CLOSED);
    if (row.status !== "proposed") return fail("answered");
    if (!canRespond(row, now)) return fail("not_open");
    // The company's audit names the candidate only as "the candidate", and never says whether a phone was shared.
    const line = { orgId: app.orgId, actor: "candidate", target: { application: app.id } } as const;
    if (input.answer === "decline") {
      await tx.update(interviews).set({ status: "declined", respondedAt: now }).where(eq(interviews.id, row.id));
      await writeAudit(tx, { ...line, action: "interview_declined" }, now);
      return { ok: true };
    }
    if (app.orgStatus !== "verified") return fail("paused");
    let sealed: string | null = null;
    if (input.sharePhone) {
      sealed = encryptPhone(input.phone, app.id, deps.env);
      if (!sealed) return fail("phone_unavailable");
    }
    await tx.update(interviews).set({ status: "accepted", respondedAt: now, phoneShared: !!sealed }).where(eq(interviews.id, row.id));
    if (sealed) await tx.update(applications).set({ phoneShared: sealed }).where(eq(applications.id, app.id));
    await writeAudit(tx, { ...line, action: "interview_accepted" }, now);
    return { ok: true };
  });
  logEvent("info", result.ok ? "interview_answered" : "interview_answer_refused", result.ok ? { answer: input.answer, shared: input.answer === "accept" && input.sharePhone } : { reason: result.error });
  return result;
}

/** The candidate stops sharing their phone with the company: the number is erased and no interview shows it. */
export async function stopSharingPhone(userId: string, raw: unknown, deps: InterviewDeps = {}): Promise<InterviewResult> {
  const db = deps.db ?? getDb();
  const parsed = applicationIdInput.safeParse(raw);
  if (!parsed.success) return fail("invalid");
  const result = await db.transaction(async (tx): Promise<InterviewResult> => {
    const [app] = await tx
      .update(applications)
      .set({ phoneShared: null })
      .where(and(eq(applications.id, parsed.data.applicationId), eq(applications.userId, userId)))
      .returning({ id: applications.id });
    if (!app) return fail("not_found");
    await tx.update(interviews).set({ phoneShared: false }).where(eq(interviews.applicationId, app.id));
    return { ok: true };
  });
  logEvent("info", result.ok ? "interview_phone_unshared" : "interview_phone_unshare_refused", result.ok ? {} : { reason: result.error });
  return result;
}

/* Feedback -------------------------------------------------------------------------------------------------------- */

/**
 * An interviewer's feedback on an interview they are on, once the candidate has accepted it: a recommendation and
 * their own words. Writing again replaces it. Read by the job team, never by the candidate.
 */
export async function submitFeedback(userId: string, raw: unknown, deps: InterviewDeps = {}): Promise<InterviewResult> {
  const db = deps.db ?? getDb();
  const now = deps.now ?? new Date();
  const parsed = feedbackInput.safeParse(raw);
  if (!parsed.success) return fail("invalid", parsed.error.issues[0]?.message);
  const input = parsed.data;
  const result = await db.transaction(async (tx): Promise<InterviewResult> => {
    const [iv] = await tx
      .select({ id: interviews.id, applicationId: interviews.applicationId, status: interviews.status, startsAt: interviews.startsAt, minutes: interviews.minutes })
      .from(interviews)
      .where(eq(interviews.id, input.interviewId));
    if (!iv) return fail("not_found");
    const found = await visibleApplication(userId, iv.applicationId, tx, now);
    if (!found.ok) return companyFail(found.error);
    if (found.app.withdrawnAt) return fail("not_found");
    const [assigned] = await tx
      .select({ id: interviewInterviewers.userId })
      .from(interviewInterviewers)
      .where(and(eq(interviewInterviewers.interviewId, iv.id), eq(interviewInterviewers.userId, userId)));
    const refusal = feedbackRefusal({ assigned: !!assigned, status: shownStatus(iv, now) });
    if (refusal) return fail(refusal);
    await tx
      .insert(interviewFeedback)
      .values({ interviewId: iv.id, interviewerId: userId, text: input.text, recommendation: input.recommendation, createdAt: now, updatedAt: now })
      .onConflictDoUpdate({ target: [interviewFeedback.interviewId, interviewFeedback.interviewerId], set: { text: input.text, recommendation: input.recommendation, updatedAt: now } });
    // That feedback was saved, and by whom; never what it says or recommends.
    await writeAudit(tx, { orgId: found.app.orgId, actor: { memberId: found.access.me.memberId }, action: "feedback_saved", target: { application: iv.applicationId } }, now);
    return { ok: true };
  });
  logEvent("info", result.ok ? "interview_feedback_saved" : "interview_feedback_refused", result.ok ? { recommendation: input.recommendation } : { reason: result.error });
  return result;
}

/* Corporate Interviews --------------------------------------------------------------------------------------------- */

/**
 * Corporate Interviews: the interviews this person may see, from a week ago on, soonest first. Recruiter admins see
 * the company's; Hiring HR those of jobs they move candidates on; anyone, the ones they are on. Never the person's own
 * application, withdrawn ones, deleted accounts or applications more than 180 days past closing.
 */
export async function companyInterviews(userId: string, deps: InterviewDeps = {}): Promise<InterviewResult<{ view: CompanyInterviewsView }>> {
  const db = deps.db ?? getDb();
  const now = deps.now ?? new Date();
  const me = await activeMembership(userId, db);
  if (!me) return fail("not_member");
  const rows = await db
    .select({
      applicationId: applications.id,
      jobId: jobs.id,
      job: jobs.title,
      candidate: users.name,
      startsAt: interviews.startsAt,
      interviewId: interviews.id,
    })
    .from(interviews)
    .innerJoin(applications, eq(applications.id, interviews.applicationId))
    .innerJoin(jobs, eq(jobs.id, applications.jobId))
    .innerJoin(users, eq(users.id, applications.userId))
    .where(
      and(
        visibleApplicationsWhere(me, userId, db, now),
        inArray(interviews.status, ["proposed", "accepted"]),
        gte(interviews.startsAt, new Date(now.getTime() - 7 * DAY)),
      ),
    )
    .orderBy(asc(interviews.startsAt))
    .limit(200);
  const appIds = [...new Set(rows.map((r) => r.applicationId))];
  // Who moves which job decides whether the person reads everyone's feedback or only their own.
  const moverJobs =
    me.role === "admin"
      ? null
      : new Set((await db.select({ jobId: jobTeam.jobId }).from(jobTeam).where(and(eq(jobTeam.userId, userId), inArray(jobTeam.role, ["owner", "hiring"])))).map((r) => r.jobId));
  const canMoveOn = (jobId: string) => me.role === "admin" || (me.role === "hiring" && !!moverJobs?.has(jobId));
  const byApp = new Map<string, Awaited<ReturnType<typeof companyInterviewsOf>>>();
  for (const id of appIds) {
    const jobId = rows.find((r) => r.applicationId === id)!.jobId;
    byApp.set(id, await companyInterviewsOf([id], { userId, canMove: canMoveOn(jobId) }, db, now));
  }
  const [mine] = await Promise.all([
    db
      .select({ interviewId: interviewInterviewers.interviewId })
      .from(interviewInterviewers)
      .where(and(eq(interviewInterviewers.userId, userId), inArray(interviewInterviewers.interviewId, rows.length ? rows.map((r) => r.interviewId) : ["00000000-0000-0000-0000-000000000000"]))),
  ]);
  const assigned = new Set(mine.map((m) => m.interviewId));
  const items: InterviewListItem[] = rows.flatMap((r) => {
    const view = byApp.get(r.applicationId)?.get(r.applicationId)?.find((v) => v.id === r.interviewId);
    // Interviews that ended in the last week stay, so their interviewers can find them to write feedback.
    if (!view) return [];
    return [{ ...view, applicationId: r.applicationId, jobId: r.jobId, candidate: displayName(r.candidate), job: r.job, day: indiaDay(r.startsAt), assigned: assigned.has(r.interviewId) }];
  });
  return { ok: true, view: { company: me.orgName, role: me.role, items } };
}

/* Download your data ---------------------------------------------------------------------------------------------- */

/**
 * For "Download your data", someone on a company's side: the interviews they were on (company, job, time; never the
 * candidate) and the feedback they wrote. The candidate's own interviews and offered times come with their
 * applications (exportApplications).
 */
export async function exportInterviewer(userId: string, db: Db = getDb()) {
  const [onInterviews, feedback] = await Promise.all([
    db
      .select({ company: organizations.name, job: jobs.title, round: interviews.round, startsAt: interviews.startsAt, minutes: interviews.minutes, status: interviews.status })
      .from(interviewInterviewers)
      .innerJoin(interviews, eq(interviews.id, interviewInterviewers.interviewId))
      .innerJoin(applications, eq(applications.id, interviews.applicationId))
      .innerJoin(jobs, eq(jobs.id, applications.jobId))
      .innerJoin(organizations, eq(organizations.id, applications.orgId))
      .where(eq(interviewInterviewers.userId, userId))
      .orderBy(asc(interviews.startsAt)),
    db
      .select({
        company: organizations.name,
        job: jobs.title,
        interviewAt: interviews.startsAt,
        recommendation: interviewFeedback.recommendation,
        text: interviewFeedback.text,
        createdAt: interviewFeedback.createdAt,
        updatedAt: interviewFeedback.updatedAt,
      })
      .from(interviewFeedback)
      .innerJoin(interviews, eq(interviews.id, interviewFeedback.interviewId))
      .innerJoin(applications, eq(applications.id, interviews.applicationId))
      .innerJoin(jobs, eq(jobs.id, applications.jobId))
      .innerJoin(organizations, eq(organizations.id, applications.orgId))
      .where(eq(interviewFeedback.interviewerId, userId))
      .orderBy(asc(interviewFeedback.createdAt)),
  ]);
  return { interviewsYouWereOn: onInterviews, feedbackYouWrote: feedback };
}
