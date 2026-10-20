import "server-only";
import { and, asc, eq, gt, inArray, isNotNull, ne, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { applications, candidateSlots, interviewFeedback, interviewInterviewers, interviews, messages, users } from "@/db/schema";
import { displayName } from "@/lib/account/name";
import { indiaDay } from "@/lib/ride/days";
import { canCancel, canRespond, feedbackRefusal, shownStatus } from "./rules";
import { slotLabel, slotOpen, timeRange } from "./slots";
import type { CompanyInterviewView, MyInterviewView } from "./types";

/*
 * Reading interviews (dev/corporate-plan.md build step 6), shared by the board, the chats and the interviews store.
 * Callers check the person's live company access first (visibleApplication); these only shape what that person may
 * see. Feedback is read by the job team in full and by each interviewer for their own only; never by the candidate.
 */

type Db = ReturnType<typeof getDb>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/** Who wrote feedback whose account has gone: the feedback stays the company's. */
export const FORMER_MEMBER = "A former team member";

/** An interviewer's access lasts while the interview is proposed or accepted, until 7 days after it ends. */
export const INTERVIEWER_ACCESS_DAYS = 7;
export const interviewerWindow = (now: Date) =>
  and(
    inArray(interviews.status, ["proposed", "accepted"]),
    sql`${interviews.startsAt} + make_interval(mins => ${interviews.minutes}) + make_interval(days => ${INTERVIEWER_ACCESS_DAYS}) > ${now.toISOString()}::timestamptz`,
  );

/** The applications among these where the person is on an interview still in its access window. */
export async function assignedApplications(userId: string, applicationIds: string[], db: Db | Tx, now: Date): Promise<Set<string>> {
  if (!applicationIds.length) return new Set();
  const rows = await db
    .selectDistinct({ applicationId: interviews.applicationId })
    .from(interviews)
    .innerJoin(interviewInterviewers, eq(interviewInterviewers.interviewId, interviews.id))
    .where(and(eq(interviewInterviewers.userId, userId), inArray(interviews.applicationId, applicationIds), interviewerWindow(now)));
  return new Set(rows.map((r) => r.applicationId));
}

/** Application ids (any job) the person is on an interview of, within its access window: a subquery for lists. */
export const assignedSubquery = (userId: string, db: Db | Tx, now: Date) =>
  db
    .select({ id: interviews.applicationId })
    .from(interviews)
    .innerJoin(interviewInterviewers, eq(interviewInterviewers.interviewId, interviews.id))
    .where(and(eq(interviewInterviewers.userId, userId), interviewerWindow(now)));

type Viewer = { userId: string; canMove: boolean };

/** Interviews of these applications as one company member may see them, oldest first, keyed by application. */
export async function companyInterviewsOf(applicationIds: string[], viewer: Viewer, db: Db | Tx, now: Date): Promise<Map<string, CompanyInterviewView[]>> {
  const out = new Map<string, CompanyInterviewView[]>(applicationIds.map((id) => [id, []]));
  if (!applicationIds.length) return out;
  const rows = await db
    .select({
      id: interviews.id,
      applicationId: interviews.applicationId,
      round: interviews.round,
      startsAt: interviews.startsAt,
      minutes: interviews.minutes,
      status: interviews.status,
      phoneShared: interviews.phoneShared,
    })
    .from(interviews)
    .where(inArray(interviews.applicationId, applicationIds))
    .orderBy(asc(interviews.startsAt), asc(interviews.createdAt));
  if (!rows.length) return out;
  const ids = rows.map((r) => r.id);
  const [people, notes] = await Promise.all([
    db
      .select({ interviewId: interviewInterviewers.interviewId, userId: interviewInterviewers.userId, name: users.name })
      .from(interviewInterviewers)
      .innerJoin(users, eq(users.id, interviewInterviewers.userId))
      .where(inArray(interviewInterviewers.interviewId, ids))
      .orderBy(asc(users.name)),
    db
      .select({
        interviewId: interviewFeedback.interviewId,
        interviewerId: interviewFeedback.interviewerId,
        name: users.name,
        deleted: users.deletionRequestedAt,
        recommendation: interviewFeedback.recommendation,
        text: interviewFeedback.text,
        updatedAt: interviewFeedback.updatedAt,
      })
      .from(interviewFeedback)
      .leftJoin(users, eq(users.id, interviewFeedback.interviewerId))
      .where(inArray(interviewFeedback.interviewId, ids))
      .orderBy(asc(interviewFeedback.createdAt)),
  ]);
  for (const r of rows) {
    const status = shownStatus(r, now);
    const team = people.filter((p) => p.interviewId === r.id);
    const assigned = team.some((p) => p.userId === viewer.userId);
    const feedback = notes
      .filter((f) => f.interviewId === r.id && (viewer.canMove || f.interviewerId === viewer.userId))
      .map((f) => ({
        by: f.interviewerId && !f.deleted ? displayName(f.name) : FORMER_MEMBER,
        mine: f.interviewerId === viewer.userId,
        recommendation: f.recommendation,
        text: f.text,
        on: indiaDay(f.updatedAt),
      }));
    out.get(r.applicationId)?.push({
      id: r.id,
      round: r.round,
      when: slotLabel(r.startsAt),
      range: timeRange(r.startsAt, r.minutes),
      minutes: r.minutes,
      status,
      interviewers: team.map((p) => displayName(p.name)),
      phoneShared: r.phoneShared && (r.status === "accepted" || r.status === "done"),
      feedback,
      canGiveFeedback: feedbackRefusal({ assigned, status }) === null,
      canCancel: viewer.canMove && canCancel(r, now),
    });
  }
  return out;
}

/**
 * Whether a shared phone may be shown to this person: on file for an accepted interview, and they are on that
 * interview's team while its access window is still open (7 days after it ends). Being on another interview for the
 * same candidate, live or not, never shows a phone that was shared for an interview whose window has closed (Testing
 * T39).
 */
export async function phoneAudience(applicationId: string, viewer: Viewer, db: Db | Tx, now: Date): Promise<{ anyShared: boolean; assignedToShared: boolean }> {
  const shared = await db
    .select({ id: interviews.id })
    .from(interviews)
    .where(and(eq(interviews.applicationId, applicationId), eq(interviews.phoneShared, true), eq(interviews.status, "accepted")));
  if (!shared.length) return { anyShared: false, assignedToShared: false };
  const [mine] = await db
    .select({ id: interviewInterviewers.interviewId })
    .from(interviewInterviewers)
    .innerJoin(interviews, eq(interviews.id, interviewInterviewers.interviewId))
    .where(and(eq(interviewInterviewers.userId, viewer.userId), inArray(interviewInterviewers.interviewId, shared.map((s) => s.id)), interviewerWindow(now)))
    .limit(1);
  return { anyShared: true, assignedToShared: !!mine };
}

/**
 * After an interview is cancelled: erases the phone shared with the company, as Not this time does, when the
 * cancelled interview is one it was shared for and no other accepted interview it was shared for is still within its
 * access window (Testing T42, T47). Cancelling an interview the phone wasn't shared for leaves it alone. Run inside the
 * cancel's transaction, which holds the application row.
 */
export async function erasePhoneUnlessNeeded(tx: Tx, applicationId: string, cancelledId: string, now: Date): Promise<boolean> {
  const [cancelled] = await tx
    .select({ phoneShared: interviews.phoneShared })
    .from(interviews)
    .where(and(eq(interviews.id, cancelledId), eq(interviews.applicationId, applicationId)));
  if (!cancelled?.phoneShared) return false;
  const [needed] = await tx
    .select({ id: interviews.id })
    .from(interviews)
    .where(
      and(
        eq(interviews.applicationId, applicationId),
        ne(interviews.id, cancelledId),
        eq(interviews.phoneShared, true),
        eq(interviews.status, "accepted"),
        interviewerWindow(now),
      ),
    )
    .limit(1);
  if (needed) return false;
  await tx.update(applications).set({ phoneShared: null }).where(and(eq(applications.id, applicationId), isNotNull(applications.phoneShared)));
  await tx.update(interviews).set({ phoneShared: false }).where(and(eq(interviews.applicationId, applicationId), eq(interviews.phoneShared, true)));
  return true;
}

/** Offered times still ahead and not booked, and whether an "Ask for times" is still waiting for an answer. */
export async function offeredState(applicationId: string, conversationId: string | null, db: Db | Tx, now: Date): Promise<{ offeredTimes: number; waitingForTimes: boolean }> {
  const [slots, live, asks] = await Promise.all([
    db.select({ id: candidateSlots.id, startsAt: candidateSlots.startsAt }).from(candidateSlots).where(and(eq(candidateSlots.applicationId, applicationId), gt(candidateSlots.startsAt, now))),
    db
      .select({ slotId: interviews.slotId })
      .from(interviews)
      .where(and(eq(interviews.applicationId, applicationId), inArray(interviews.status, ["proposed", "accepted"]))),
    conversationId
      ? db
          .select({ id: messages.id, payload: messages.payload })
          .from(messages)
          .where(
            and(
              eq(messages.conversationId, conversationId),
              eq(messages.kind, "ask_times"),
              sql`not exists (select 1 from ${candidateSlots} s where s.ask_message_id = ${messages.id})`,
              // Answered, its offered times since deleted by the daily clean-up (build step 7).
              sql`coalesce(${messages.payload}->>'answered', '') <> 'true'`,
            ),
          )
      : Promise.resolve([] as { id: string; payload: unknown }[]),
  ]);
  const taken = new Set(live.map((l) => l.slotId));
  const today = indiaDay(now);
  return {
    offeredTimes: slots.filter((s) => !taken.has(s.id) && slotOpen(s.startsAt, now)).length,
    waitingForTimes: asks.some((a) => askDaysOf(a.payload).some((d) => d >= today)),
  };
}

/** The days an "Ask for times" message offered (its payload), or none. */
export function askDaysOf(payload: unknown): string[] {
  const days = (payload as { days?: unknown } | null)?.days;
  return Array.isArray(days) ? days.filter((d): d is string => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d)) : [];
}

/** The candidate's own interviews, per application, for Arrivals. Never who at the company booked them. */
export async function myInterviewsOf(applicationIds: string[], db: Db | Tx, now: Date): Promise<Map<string, MyInterviewView[]>> {
  const out = new Map<string, MyInterviewView[]>(applicationIds.map((id) => [id, []]));
  if (!applicationIds.length) return out;
  const rows = await db
    .select({
      id: interviews.id,
      applicationId: interviews.applicationId,
      round: interviews.round,
      startsAt: interviews.startsAt,
      minutes: interviews.minutes,
      status: interviews.status,
      phoneShared: interviews.phoneShared,
    })
    .from(interviews)
    .where(inArray(interviews.applicationId, applicationIds))
    .orderBy(asc(interviews.startsAt));
  for (const r of rows)
    out.get(r.applicationId)?.push({
      id: r.id,
      round: r.round,
      day: indiaDay(r.startsAt),
      startsAt: r.startsAt.toISOString(),
      when: slotLabel(r.startsAt),
      range: timeRange(r.startsAt, r.minutes),
      minutes: r.minutes,
      status: shownStatus(r, now),
      canRespond: canRespond(r, now),
      phoneShared: r.phoneShared,
    });
  return out;
}

/** Cancels an application's interviews that are still ahead: on Not this time and on withdrawing. */
export async function cancelUpcoming(tx: Tx, applicationId: string, now: Date): Promise<number> {
  const cancelled = await tx
    .update(interviews)
    .set({ status: "cancelled", cancelledAt: now })
    .where(and(eq(interviews.applicationId, applicationId), inArray(interviews.status, ["proposed", "accepted"]), gt(interviews.startsAt, now)))
    .returning({ id: interviews.id });
  return cancelled.length;
}


/** The people on interviews, for the busy check: live interviews of these people that overlap the window. */
export async function busyOf(userIds: string[], from: Date, to: Date, db: Db | Tx) {
  if (!userIds.length) return [];
  return db
    .select({ userId: interviewInterviewers.userId, startsAt: interviews.startsAt, minutes: interviews.minutes, interviewId: interviews.id })
    .from(interviews)
    .innerJoin(interviewInterviewers, eq(interviewInterviewers.interviewId, interviews.id))
    .where(
      and(
        inArray(interviewInterviewers.userId, userIds),
        inArray(interviews.status, ["proposed", "accepted"]),
        sql`${interviews.startsAt} < ${to.toISOString()}::timestamptz`,
        sql`${interviews.startsAt} + make_interval(mins => ${interviews.minutes}) > ${from.toISOString()}::timestamptz`,
      ),
    );
}

/** Whether two time spans overlap. */
export const overlaps = (a: Date, aMin: number, b: Date, bMin: number) => a.getTime() < b.getTime() + bMin * 60_000 && b.getTime() < a.getTime() + aMin * 60_000;

