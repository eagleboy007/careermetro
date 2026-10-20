import "server-only";
import { randomUUID } from "node:crypto";
import { and, asc, count, desc, eq, gte, isNotNull, lt, or, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { withKeyLock, type Tx } from "@/db/lock";
import { aiCalls, practiceAnswers, userGoals } from "@/db/schema";
import { practiceQuestions, skillGroupMembers, skills } from "@/content";
import { loadPrompt } from "@/lib/ai/prompts";
import { refIn, RESERVATION_MINUTES, reserveCall, runReserved, usedToday } from "@/lib/ai/reserve";
import { eliteOn } from "@/lib/elite/store";
import { practiceCapFor } from "@/lib/elite/rules";
import { swappedSkill } from "@/lib/goals/not-for-me";
import { goalsOf, indiaToday } from "@/lib/goals/store";
import { errorFields, logEvent } from "@/lib/log";
import {
  PRACTICE_DAILY_ANSWERS,
  PRACTICE_KEEP_DAYS,
  practiceAnswerInput,
  practiceRateInput,
  practiceTrend,
  practiceView,
  type PracticeAnswerResult,
  type PracticeFeedback,
  type PracticeQuestion,
  type PracticeRateResult,
  type PracticeSkill,
  type PracticeTrend,
  type PracticeView,
} from "@/lib/schemas";
import { PRACTICE_MODEL, practiceFeedbackFor, type FeedbackClient } from "./feedback";

type Db = ReturnType<typeof getDb>;

export const PRACTICE_LIMITS = {
  /**
   * Answers with feedback one person on Free gets a day (an India day); one whose feedback wasn't available doesn't
   * count. Elite has no daily cap (FR-50, practiceCapFor).
   */
  answersPerDay: PRACTICE_DAILY_ANSWERS,
  /** Feedback calls one person may start a UTC day, failed ones included, so retrying can't run up the budget (AI-6). */
  callsPerPersonPerDay: 20,
  /** Spend on practice feedback per UTC day, across all users, kept apart from the other budgets (AI-6). */
  // A value that isn't a number falls back to the default, so a typo can never switch the budget off.
  dailyBudgetUsd: () => {
    const usd = Number(process.env.PRACTICE_DAILY_BUDGET_USD ?? 2);
    return Number.isFinite(usd) && usd >= 0 ? usd : 2;
  },
  /** How long a second answer from the same person waits for the first to be saved before answering "busy". */
  lockTimeoutMs: 30_000,
};

/** What a feedback call still running is assumed to cost when checking the budget. A typical one costs 1 to 3 cents. */
const IN_FLIGHT_PRACTICE_USD = 0.05;
const DAY = 86_400_000;

const skillNames = new Map(skills.map((s) => [s.id, s.name]));
const questionById = new Map(practiceQuestions.map((q) => [q.id, q]));
const questionsBySkill = new Map<string, PracticeQuestion[]>();
for (const q of practiceQuestions) questionsBySkill.set(q.skillId, [...(questionsBySkill.get(q.skillId) ?? []), q]);

/** Midnight in India, as the start of the day the daily answers count in (goals and proof dates use India days too). */
export const startOfIndiaDay = (now: Date): Date => new Date(`${indiaToday(now)}T00:00:00+05:30`);

export const PRACTICE_MESSAGES = {
  invalid: "Write at least 5 words, and keep it under 4,000 characters.",
  not_found: "That question isn't available. Pick a skill again.",
  not_goal: "Practice is for skills on your goals. Pick one of them.",
  limit: `You've had your ${PRACTICE_DAILY_ANSWERS} answers with feedback today. Come back tomorrow.`,
  busy: "Your last answer is still being saved. Try again in a moment.",
} as const;

/**
 * Answers used today: those with feedback, plus any whose feedback call is still running (so two at once can't both
 * take the last one). A saved answer whose feedback wasn't available doesn't count.
 */
async function usedAnswers(db: Db | Tx, userId: string, now: Date): Promise<number> {
  const running = new Date(Date.now() - RESERVATION_MINUTES * 60_000);
  const [row] = await db
    .select({ n: count() })
    .from(practiceAnswers)
    .leftJoin(aiCalls, eq(aiCalls.id, practiceAnswers.aiCallId))
    .where(
      and(
        eq(practiceAnswers.userId, userId),
        gte(practiceAnswers.createdAt, startOfIndiaDay(now)),
        or(isNotNull(practiceAnswers.feedback), and(eq(aiCalls.status, "reserved"), gte(aiCalls.createdAt, running))),
      ),
    );
  return row?.n ?? 0;
}

/**
 * Reserves a feedback call when this person is under their daily call count and the practice budget has room, and
 * returns the reserved call's id; null means no feedback this time. Under a short lock for the purpose, like the
 * Gaps and Path wording, so parallel requests see each other's reservations before the model is called.
 */
async function reserveFeedback(tx: Tx, userId: string, refs: Record<string, string>): Promise<string | null> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext('cm-ai:practice-feedback'))`);
  const ownAnswers = tx.select({ id: sql<string>`${practiceAnswers.id}::text` }).from(practiceAnswers).where(eq(practiceAnswers.userId, userId));
  const used = await usedToday(tx, "practice-feedback", IN_FLIGHT_PRACTICE_USD, refIn("practiceAnswerId", ownAnswers));
  if (used.mine >= PRACTICE_LIMITS.callsPerPersonPerDay || used.usd >= PRACTICE_LIMITS.dailyBudgetUsd()) return null;
  return reserveCall(tx, { purpose: "practice-feedback", model: PRACTICE_MODEL, promptVersion: loadPrompt("practice-feedback").id, inputRefs: refs });
}

/**
 * "Get feedback" (FR-22): saves the person's answer to a bank question on one of their goals, asks the model for
 * feedback within the limits, and stores it with the answer. The model call runs between two short transactions,
 * never inside one. Feedback that isn't available (budget, an outage, output that fails its schema) leaves the answer
 * saved with none, and that answer uses none of the day's 10. Practice never writes to goals or proof. The answer text
 * never reaches a log: only ids and counts do.
 */
export async function submitPracticeAnswer(
  userId: string,
  raw: unknown,
  deps: { db?: Db; client?: FeedbackClient; now?: Date } = {},
): Promise<PracticeAnswerResult> {
  const db = deps.db ?? getDb();
  const now = deps.now ?? new Date();
  const parsed = practiceAnswerInput.safeParse(raw);
  if (!parsed.success) return { ok: false, message: PRACTICE_MESSAGES.invalid };
  const question = questionById.get(parsed.data.questionId);
  if (!question) return { ok: false, message: PRACTICE_MESSAGES.not_found };

  const answerId = randomUUID();
  const refs = { practiceAnswerId: answerId, questionId: question.id };
  type First = { ok: false; reason: "not_goal" | "limit" } | { ok: true; used: number; cap: number | null; reservedId: string | null };
  const first = await withKeyLock(db, `cm-practice:${userId}`, PRACTICE_LIMITS.lockTimeoutMs, async (tx): Promise<First> => {
    const [goal] = await tx
      .select({ id: userGoals.id })
      .from(userGoals)
      // A goal swapped to this skill ("Not for me", FR-48) practises it too (T58).
      .where(and(eq(userGoals.userId, userId), or(eq(userGoals.skillId, question.skillId), eq(userGoals.swappedTo, question.skillId))))
      .limit(1);
    if (!goal) return { ok: false, reason: "not_goal" };
    const used = await usedAnswers(tx, userId, now);
    // 10 a day on Free; Elite has no daily cap (FR-50), though feedback calls still stop at 20 a day.
    const cap = practiceCapFor(await eliteOn(userId, tx));
    if (cap !== null && used >= cap) return { ok: false, reason: "limit" };
    const reservedId = await reserveFeedback(tx, userId, refs);
    await tx.insert(practiceAnswers).values({
      id: answerId,
      userId,
      skillId: question.skillId,
      questionId: question.id,
      answer: parsed.data.answer,
      aiCallId: reservedId,
      createdAt: now,
    });
    return { ok: true, used, cap, reservedId };
  });
  if (first === "busy") return { ok: false, message: PRACTICE_MESSAGES.busy };
  if (!first.ok) return first.reason === "limit" ? { ok: false, message: PRACTICE_MESSAGES.limit, left: 0 } : { ok: false, message: PRACTICE_MESSAGES.not_goal };

  let feedback: PracticeFeedback | null = null;
  if (first.reservedId) {
    try {
      const input = { skillName: skillNames.get(question.skillId) ?? question.skillId, question: question.question, lookFor: question.lookFor, answer: parsed.data.answer };
      feedback = (await runReserved(db, first.reservedId, () => practiceFeedbackFor(input, refs, deps.client))).feedback;
    } catch (error) {
      // Settled as done by runReserved; the answer stays saved without feedback.
      logEvent("error", "practice_feedback_failed", errorFields(error));
    }
  }
  if (feedback) {
    await db
      .update(practiceAnswers)
      .set({ feedback })
      .where(and(eq(practiceAnswers.id, answerId), eq(practiceAnswers.userId, userId)));
  }
  const left = first.cap === null ? null : Math.max(0, first.cap - first.used - (feedback ? 1 : 0));
  logEvent("info", "practice_answered", { feedback: feedback !== null, left });
  return { ok: true, answerId, feedback, left };
}

/**
 * "How sure do you feel about this now?" (FR-23): the person's own rating, 1 to 4, on one of their own answers that
 * got feedback. Rating again replaces it. Ownership is in the WHERE clause.
 */
export async function ratePracticeAnswer(userId: string, raw: unknown, db: Db = getDb()): Promise<PracticeRateResult> {
  const parsed = practiceRateInput.safeParse(raw);
  if (!parsed.success) return { ok: false, message: "Pick one of the four answers." };
  const rows = await db
    .update(practiceAnswers)
    .set({ confidence: parsed.data.confidence })
    .where(and(eq(practiceAnswers.id, parsed.data.answerId), eq(practiceAnswers.userId, userId), isNotNull(practiceAnswers.feedback)))
    .returning({ id: practiceAnswers.id });
  return rows.length ? { ok: true } : { ok: false, message: "That answer isn't available any more." };
}

/** This person's ratings by skill, oldest first. */
async function ratingsBySkill(db: Db, userId: string): Promise<Map<string, number[]>> {
  const rows = await db
    .select({ skillId: practiceAnswers.skillId, confidence: practiceAnswers.confidence })
    .from(practiceAnswers)
    .where(and(eq(practiceAnswers.userId, userId), isNotNull(practiceAnswers.confidence)))
    .orderBy(asc(practiceAnswers.createdAt), asc(practiceAnswers.id));
  const out = new Map<string, number[]>();
  for (const r of rows) if (r.confidence !== null) out.set(r.skillId, [...(out.get(r.skillId) ?? []), r.confidence]);
  return out;
}

/**
 * The Practice page for this person (handoff 12h): their goals that have bank questions, each tagged as the current
 * goal, a goal ahead or a goal met, with their own ratings; how many answers are left today; and goals with no
 * questions yet. Read only: practice never changes goals.
 */
export async function practiceFor(userId: string, now = new Date(), db: Db = getDb()): Promise<PracticeView> {
  const [goals, ratings, used, elite] = await Promise.all([goalsOf(userId, db), ratingsBySkill(db, userId), usedAnswers(db, userId, now), eliteOn(userId, db)]);
  const cap = practiceCapFor(elite);
  const open = goals.filter((g) => g.status !== "skipped");
  const current = open.find((g) => g.status !== "met" && !g.proved);
  const skillsOut: PracticeSkill[] = [];
  const noQuestions: string[] = [];
  for (const g of open) {
    // A swapped goal practises the skill it is on now (T58).
    const skillId = swappedSkill(g, skillGroupMembers) ?? g.skillId;
    const name = skillNames.get(skillId) ?? skillId;
    const questions = questionsBySkill.get(skillId);
    if (!questions) {
      noQuestions.push(name);
      continue;
    }
    skillsOut.push({
      skillId,
      name,
      tag: g.status === "met" || g.proved ? "met" : g === current ? "current" : "ahead",
      questions: questions.map((q) => ({ id: q.id, question: q.question, lookFor: q.lookFor })),
      ratings: ratings.get(skillId) ?? [],
    });
  }
  return practiceView.parse({ skills: skillsOut, left: cap === null ? null : Math.max(0, cap - used), noQuestions });
}

/**
 * "Practice confidence" on Me (FR-23): one row per skill the person has rated, newest first, ratings oldest first.
 * Private: only the person's own profile shows it; never the public profile, "View as others" or a company.
 */
export async function practiceTrendsFor(userId: string, db: Db = getDb()): Promise<PracticeTrend[]> {
  const ratings = await ratingsBySkill(db, userId);
  return [...ratings].reverse().map(([skillId, list]) => practiceTrend.parse({ skillId, name: skillNames.get(skillId) ?? skillId, ratings: list }));
}

/** For "Download your data": every practice answer kept (the last 30 days), with its question, feedback and rating. */
export async function exportPractice(userId: string, db: Db = getDb()) {
  const rows = await db
    .select({
      createdAt: practiceAnswers.createdAt,
      skill: practiceAnswers.skillId,
      questionId: practiceAnswers.questionId,
      answer: practiceAnswers.answer,
      feedback: practiceAnswers.feedback,
      confidence: practiceAnswers.confidence,
    })
    .from(practiceAnswers)
    .where(eq(practiceAnswers.userId, userId))
    .orderBy(desc(practiceAnswers.createdAt));
  return rows.map((r) => ({ ...r, question: questionById.get(r.questionId)?.question ?? null }));
}

/** The daily clean-up: deletes practice answers older than 30 days. Returns how many went. */
export async function clearOldPracticeAnswers(db: Db = getDb(), now = new Date()): Promise<number> {
  const gone = await db
    .delete(practiceAnswers)
    .where(lt(practiceAnswers.createdAt, new Date(now.getTime() - PRACTICE_KEEP_DAYS * DAY)))
    .returning({ id: practiceAnswers.id });
  return gone.length;
}
