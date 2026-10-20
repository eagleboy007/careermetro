import "server-only";
import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray, isNull, lt, sql } from "drizzle-orm";
import { getDb } from "@/db";
import type { Tx } from "@/db/lock";
import { mockAnswers, mockSessions } from "@/db/schema";
import { mockQuestions, roleProfiles, skillGroupMembers } from "@/content";
import { loadPrompt } from "@/lib/ai/prompts";
import { refIn, reserveCall, runReserved, usedToday } from "@/lib/ai/reserve";
import { eliteOn } from "@/lib/elite/store";
import { swappedSkill } from "@/lib/goals/not-for-me";
import { goalsOf } from "@/lib/goals/store";
import { errorFields, logEvent } from "@/lib/log";
import {
  mockInterviewAnswerInput,
  mockInterviewEndInput,
  mockInterviewStartInput,
  PRACTICE_KEEP_DAYS,
  type MockFeedbackState,
  type MockInterviewError,
  type MockInterviewFeedback,
  type MockQuestion,
  type MockSessionResult,
  type MockSessionView,
} from "@/lib/schemas";
import { LIMITS, takeShared } from "@/lib/shared-limit";
import { pickInterviewQuestions, resultOf, sessionClosed, sessionEndOf, sessionRunning, sessionViewOf } from "./interview";
import { MOCK_MODEL, mockFeedbackFor, type MockFeedbackClient, type MockFeedbackItem } from "./interview-feedback";
import type { MockRoleProfile } from "./rules";

/*
 * The mock interview (FR-50 part 3, handoff 12l): sessions of bank questions picked by code, the person's answers, and
 * one model call for feedback in words when the session ends. Every read and write is scoped to the person's own user
 * id; every action checks Elite with `eliteOn`. Answers never reach a log, ai_calls or analytics: logs carry event names
 * and counts only, ai_calls ids only.
 */

type Db = ReturnType<typeof getDb>;
export type InterviewDeps = { db?: Db; now?: Date; bank?: readonly MockQuestion[]; roles?: readonly MockRoleProfile[]; client?: MockFeedbackClient };

export const MOCK_LIMITS = {
  /** Spend on mock interview feedback per UTC day, across everyone, apart from the other budgets. */
  // A value that isn't a number falls back to the default, so a typo can never switch the budget off.
  dailyBudgetUsd: () => {
    // Unset or empty is the default, so a blank line copied from .env.example never turns feedback off.
    const raw = process.env.MOCK_DAILY_BUDGET_USD?.trim();
    const usd = raw ? Number(raw) : 3;
    return Number.isFinite(usd) && usd >= 0 ? usd : 3;
  },
};
/** What a feedback call still running is assumed to cost when checking the budget. A typical one costs 3 to 8 cents. */
const IN_FLIGHT_MOCK_USD = 0.12;
const DAY = 86_400_000;

type Content = { bank: readonly MockQuestion[]; roles: readonly MockRoleProfile[]; byId: Map<string, MockQuestion> };
const contentOf = (deps: InterviewDeps): Content => {
  const bank = deps.bank ?? mockQuestions;
  return { bank, roles: deps.roles ?? roleProfiles, byId: new Map(bank.map((q) => [q.id, q])) };
};
const titleOf = (c: Content, slug: string) => c.roles.find((r) => r.slug === slug)?.title ?? "Your role";

const sessionColumns = {
  id: mockSessions.id,
  roleSlug: mockSessions.roleSlug,
  length: mockSessions.length,
  focus: mockSessions.focus,
  questionIds: mockSessions.questionIds,
  startedAt: mockSessions.startedAt,
  endedAt: mockSessions.endedAt,
  feedback: mockSessions.feedback,
};
const answerColumns = { position: mockAnswers.position, answer: mockAnswers.answer, whatWorked: mockAnswers.whatWorked, addNextTime: mockAnswers.addNextTime };

type AnswerRow = { position: number; answer: string; whatWorked: string | null; addNextTime: string | null };
const answersOf = async (db: Db | Tx, sessionId: string): Promise<AnswerRow[]> =>
  db.select(answerColumns).from(mockAnswers).where(eq(mockAnswers.sessionId, sessionId)).orderBy(asc(mockAnswers.position));

/** The skills of the person's open goals (not met, not proved, not skipped), as "Your gaps" asks about them. */
async function openGoalSkills(userId: string, db: Db | Tx): Promise<string[]> {
  const goals = await goalsOf(userId, db);
  return goals.filter((g) => g.status !== "met" && g.status !== "skipped" && !g.proved).map((g) => swappedSkill(g, skillGroupMembers) ?? g.skillId);
}

/** The person's latest session that hasn't ended and is still within its time, for /mock to carry on with. */
export async function runningInterview(userId: string, deps: InterviewDeps = {}): Promise<MockSessionView | null> {
  const db = deps.db ?? getDb();
  const now = deps.now ?? new Date();
  const c = contentOf(deps);
  const [row] = await db
    .select(sessionColumns)
    .from(mockSessions)
    .where(and(eq(mockSessions.userId, userId), isNull(mockSessions.endedAt)))
    .orderBy(desc(mockSessions.startedAt))
    .limit(1);
  if (!row || !sessionRunning(row, now)) return null;
  return sessionViewOf(row, await answersOf(db, row.id), c.byId, titleOf(c, row.roleSlug), now);
}

type StartOutcome = { ok: true; session: MockSessionView } | { ok: false; error: MockInterviewError };
type AnswerOutcome = { ok: true } | { ok: false; error: MockInterviewError };
type EndOutcome = { ok: true; result: MockSessionResult } | { ok: false; error: MockInterviewError };

/**
 * "Start mock interview": Elite only, a role from the profiles, and at most 5 starts a day per person (each start
 * counts). The questions are picked from the bank by code, seeded by the session's id; the model never writes or
 * picks one.
 */
export async function startMockInterview(userId: string, raw: unknown, deps: InterviewDeps = {}): Promise<StartOutcome> {
  const db = deps.db ?? getDb();
  const now = deps.now ?? new Date();
  const c = contentOf(deps);
  const input = mockInterviewStartInput.safeParse(raw);
  if (!input.success) return { ok: false, error: "invalid" };
  const role = c.roles.find((r) => r.slug === input.data.roleSlug);
  if (!role) return { ok: false, error: "invalid" };
  const id = randomUUID();
  return db.transaction(async (tx): Promise<StartOutcome> => {
    if (!(await eliteOn(userId, tx))) return { ok: false, error: "not_elite" };
    const goalSkills = input.data.focus === "gaps" ? await openGoalSkills(userId, tx) : [];
    const questionIds = pickInterviewQuestions(c.bank, role, input.data.focus, input.data.length, id, goalSkills);
    if (!questionIds) return { ok: false, error: "no_questions" };
    if (!(await takeShared(LIMITS.mockSessionsPerUserDay, userId, { db: tx, now: now.getTime() }))) return { ok: false, error: "limit" };
    const [row] = await tx
      .insert(mockSessions)
      .values({ id, userId, roleSlug: role.slug, length: input.data.length, focus: input.data.focus, questionIds, startedAt: now })
      .returning(sessionColumns);
    const session = sessionViewOf(row, [], c.byId, role.title, now);
    if (!session) throw new Error("mock interview questions missing from the bank");
    logEvent("info", "mock_interview_started", { questions: questionIds.length });
    return { ok: true, session };
  });
}

/** The person's own session, locked for this change. Someone else's session id finds nothing. */
async function lockedSession(tx: Tx, userId: string, sessionId: string) {
  const [row] = await tx
    .select(sessionColumns)
    .from(mockSessions)
    .where(and(eq(mockSessions.id, sessionId), eq(mockSessions.userId, userId)))
    .for("update");
  return row ?? null;
}

/** Saves one answer, or clears it when empty (a skip). The caller has checked the session is the person's and open. */
async function putAnswer(tx: Tx, sessionId: string, position: number, answer: string): Promise<void> {
  if (!answer) {
    await tx.delete(mockAnswers).where(and(eq(mockAnswers.sessionId, sessionId), eq(mockAnswers.position, position)));
    return;
  }
  await tx
    .insert(mockAnswers)
    .values({ sessionId, position, answer })
    .onConflictDoUpdate({ target: [mockAnswers.sessionId, mockAnswers.position], set: { answer } });
}

/**
 * "Next": saves the answer to one question of the person's own session, while it hasn't ended and is within its time
 * (with a minute's grace for an answer sent as the clock ran out). Anything later is refused as "over".
 */
export async function saveMockAnswer(userId: string, raw: unknown, deps: InterviewDeps = {}): Promise<AnswerOutcome> {
  const db = deps.db ?? getDb();
  const now = deps.now ?? new Date();
  const input = mockInterviewAnswerInput.safeParse(raw);
  if (!input.success) return { ok: false, error: "invalid" };
  return db.transaction(async (tx): Promise<AnswerOutcome> => {
    if (!(await eliteOn(userId, tx))) return { ok: false, error: "not_elite" };
    const row = await lockedSession(tx, userId, input.data.sessionId);
    if (!row) return { ok: false, error: "not_found" };
    if (sessionClosed(row, now)) return { ok: false, error: "over" };
    if (input.data.position > row.questionIds.length) return { ok: false, error: "invalid" };
    await putAnswer(tx, row.id, input.data.position, input.data.answer);
    return { ok: true };
  });
}

/**
 * Reserves the feedback call when the mock interview budget has room and the person has feedback left today (5), and
 * returns the reserved call's id; null means no feedback today. Under a short lock for the purpose, like Practice, so
 * parallel requests see each other's reservations before the model is called.
 */
async function reserveMockFeedback(tx: Tx, userId: string, refs: Record<string, string>, now: Date): Promise<string | null> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext('cm-ai:mock-interview'))`);
  const own = tx.select({ id: sql<string>`${mockSessions.id}::text` }).from(mockSessions).where(eq(mockSessions.userId, userId));
  const used = await usedToday(tx, "mock-interview", IN_FLIGHT_MOCK_USD, refIn("mockSessionId", own));
  if (used.usd >= MOCK_LIMITS.dailyBudgetUsd()) return null;
  if (!(await takeShared(LIMITS.mockFeedbackPerUserDay, userId, { db: tx, now: now.getTime() }))) return null;
  return reserveCall(tx, { purpose: "mock-interview", model: MOCK_MODEL, promptVersion: loadPrompt("mock-interview").id, inputRefs: refs });
}

/**
 * "End and get feedback", or the time running out: saves any answers sent with it (while the session is open), ends
 * it at now or its deadline if that came first, and asks the model once for feedback on every answer, within the
 * budget and the person's 5 a day. The call runs after the transaction, never inside it. Past the budget or the limit,
 * or when the call fails, the session still ends with its answers saved and the screen says feedback isn't available.
 * Ending again shows the same result without another call.
 */
export async function endMockInterview(userId: string, raw: unknown, deps: InterviewDeps = {}): Promise<EndOutcome> {
  const db = deps.db ?? getDb();
  const now = deps.now ?? new Date();
  const c = contentOf(deps);
  const input = mockInterviewEndInput.safeParse(raw);
  if (!input.success) return { ok: false, error: "invalid" };

  type Row = NonNullable<Awaited<ReturnType<typeof lockedSession>>>;
  type First = { ok: false; error: MockInterviewError } | { ok: true; row: Row; answers: AnswerRow[]; state: MockFeedbackState; reservedId: string | null };
  const first = await db.transaction(async (tx): Promise<First> => {
    if (!(await eliteOn(userId, tx))) return { ok: false, error: "not_elite" };
    const row = await lockedSession(tx, userId, input.data.sessionId);
    if (!row) return { ok: false, error: "not_found" };
    if (row.endedAt !== null) {
      const answers = await answersOf(tx, row.id);
      return { ok: true, row, answers, state: row.feedback ? "ready" : answers.length ? "unavailable" : "none_answered", reservedId: null };
    }
    if (!sessionClosed(row, now)) {
      for (const a of input.data.answers) if (a.position <= row.questionIds.length) await putAnswer(tx, row.id, a.position, a.answer);
    }
    const answers = await answersOf(tx, row.id);
    const reservedId = answers.length ? await reserveMockFeedback(tx, userId, { mockSessionId: row.id, roleSlug: row.roleSlug }, now) : null;
    const endedAt = sessionEndOf(row, now);
    await tx
      .update(mockSessions)
      .set({ endedAt, aiCallId: reservedId })
      .where(and(eq(mockSessions.id, row.id), eq(mockSessions.userId, userId)));
    const state: MockFeedbackState = !answers.length ? "none_answered" : reservedId ? "unavailable" : "unavailable_today";
    return { ok: true, row: { ...row, endedAt }, answers, state, reservedId };
  });
  if (!first.ok) return first;

  const { row } = first;
  let answers = first.answers;
  let state = first.state;
  let summary = row.feedback?.summary ?? null;
  if (first.reservedId) {
    const items = answers.flatMap((a): MockFeedbackItem[] => {
      const q = c.byId.get(row.questionIds[a.position - 1] ?? "");
      return q?.kind === "open" ? [{ position: a.position, topic: q.topic, question: q.question, strongCovers: q.strongCovers, answer: a.answer }] : [];
    });
    let feedback: MockInterviewFeedback | null = null;
    try {
      const refs = { mockSessionId: row.id, roleSlug: row.roleSlug };
      feedback = (await runReserved(db, first.reservedId, () => mockFeedbackFor({ roleTitle: titleOf(c, row.roleSlug), items }, refs, deps.client))).feedback;
    } catch (error) {
      // Settled as done by runReserved; the session stays ended without feedback.
      logEvent("error", "mock_feedback_failed", errorFields(error));
    }
    if (feedback) {
      const words = feedback;
      await db.transaction(async (tx) => {
        await tx
          .update(mockSessions)
          .set({ feedback: { summary: words.summary } })
          .where(and(eq(mockSessions.id, row.id), eq(mockSessions.userId, userId)));
        for (const q of words.questions) {
          await tx
            .update(mockAnswers)
            .set({ whatWorked: q.whatWorked, addNextTime: q.addNextTime })
            .where(and(eq(mockAnswers.sessionId, row.id), eq(mockAnswers.position, q.position)));
        }
      });
      const byPosition = new Map(words.questions.map((q) => [q.position, q]));
      answers = answers.map((a) => ({ ...a, whatWorked: byPosition.get(a.position)?.whatWorked ?? null, addNextTime: byPosition.get(a.position)?.addNextTime ?? null }));
      summary = words.summary;
      state = "ready";
    }
  }
  logEvent("info", "mock_interview_ended", { answered: answers.length, questions: row.questionIds.length, feedback: state });
  return { ok: true, result: resultOf(row, answers, c.byId, titleOf(c, row.roleSlug), state, summary) };
}

/**
 * For "Download your data": every session with its questions, times and summary, and the answers still kept (the
 * last 30 days) with the words on each.
 */
export async function exportMockSessions(userId: string, db: Pick<Db, "select"> = getDb()) {
  const [sessions, answers] = await Promise.all([
    db
      .select({ id: mockSessions.id, roleSlug: mockSessions.roleSlug, length: mockSessions.length, focus: mockSessions.focus, questionIds: mockSessions.questionIds, startedAt: mockSessions.startedAt, endedAt: mockSessions.endedAt, feedback: mockSessions.feedback })
      .from(mockSessions)
      .where(eq(mockSessions.userId, userId))
      .orderBy(asc(mockSessions.startedAt)),
    db
      .select({ sessionId: mockAnswers.sessionId, ...answerColumns })
      .from(mockAnswers)
      .innerJoin(mockSessions, eq(mockSessions.id, mockAnswers.sessionId))
      .where(eq(mockSessions.userId, userId))
      .orderBy(asc(mockAnswers.position)),
  ]);
  return sessions.map(({ id, feedback, ...s }) => ({
    ...s,
    summary: feedback?.summary ?? null,
    answers: answers.filter((a) => a.sessionId === id).map((a) => ({ position: a.position, answer: a.answer, whatWorked: a.whatWorked, addNextTime: a.addNextTime })),
  }));
}

/** The daily clean-up: deletes the answers of sessions started over 30 days ago, keeping each session's dates and summary. */
export async function clearOldMockAnswers(db: Db = getDb(), now = new Date()): Promise<number> {
  const old = db
    .select({ id: mockSessions.id })
    .from(mockSessions)
    .where(lt(mockSessions.startedAt, new Date(now.getTime() - PRACTICE_KEEP_DAYS * DAY)));
  const gone = await db.delete(mockAnswers).where(inArray(mockAnswers.sessionId, old)).returning({ sessionId: mockAnswers.sessionId });
  return gone.length;
}
