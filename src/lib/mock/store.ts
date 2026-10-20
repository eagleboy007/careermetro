import "server-only";
import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, isNull } from "drizzle-orm";
import { getDb } from "@/db";
import type { Tx } from "@/db/lock";
import { timedTests } from "@/db/schema";
import { mockQuestions, roleProfiles } from "@/content";
import { eliteOn } from "@/lib/elite/store";
import { currentAnalysis } from "@/lib/gaps/current";
import { logEvent } from "@/lib/log";
import {
  timedTestFinishInput,
  timedTestPickInput,
  timedTestStartInput,
  type MockPageView,
  type TimedTestError,
  type TimedTestReview,
  type TimedTestView,
} from "@/lib/schemas";
import { LIMITS, takeShared } from "@/lib/shared-limit";
import {
  bankViewFor,
  choicePool,
  emptyPicks,
  endOf,
  isOver,
  mockRoles,
  pickTestQuestions,
  reviewOf,
  roleFor,
  scorePicks,
  testViewOf,
  unreviewedAllowed,
  withPick,
  type BankQuestion,
  type MockRoleProfile,
} from "./rules";

/*
 * Interview prep (`/mock`, FR-50 part 2, handoff 12l): the question bank and the timed test. Every read and write is
 * scoped to the person's own user id; every action checks Elite with `eliteOn`. No model: questions come from the bank
 * and are picked and scored by code. Logs carry event names and counts only.
 */

type Db = ReturnType<typeof getDb>;
export type MockDeps = { db?: Db; now?: Date; bank?: readonly BankQuestion[]; roles?: readonly MockRoleProfile[]; allowUnreviewed?: boolean };

type Content = { bank: readonly BankQuestion[]; roles: readonly MockRoleProfile[]; byId: Map<string, BankQuestion>; allowUnreviewed: boolean };
const contentOf = (deps: MockDeps): Content => {
  const bank = deps.bank ?? mockQuestions;
  return { bank, roles: deps.roles ?? roleProfiles, byId: new Map(bank.map((q) => [q.id, q])), allowUnreviewed: deps.allowUnreviewed ?? unreviewedAllowed() };
};
const titleOf = (c: Content, slug: string) => c.roles.find((r) => r.slug === slug)?.title ?? "Your role";

const testColumns = {
  id: timedTests.id,
  roleSlug: timedTests.roleSlug,
  questionIds: timedTests.questionIds,
  picks: timedTests.picks,
  startedAt: timedTests.startedAt,
  endedAt: timedTests.endedAt,
  right: timedTests.right,
};

/** The person's latest test that hasn't ended and is still within its 15 minutes, for the screen to carry on with. */
async function runningTest(userId: string, c: Content, db: Db, now: Date): Promise<TimedTestView | null> {
  const [row] = await db
    .select(testColumns)
    .from(timedTests)
    .where(and(eq(timedTests.userId, userId), isNull(timedTests.endedAt)))
    .orderBy(desc(timedTests.startedAt))
    .limit(1);
  if (!row || isOver(row, now)) return null;
  return testViewOf(row, c.byId, titleOf(c, row.roleSlug), now);
}

/**
 * /mock for a signed-in person: the role asked for in the address, else their target role, else Data Analyst; the bank
 * for that role (5 open on Free, all on Elite); and a test still running, on Elite only.
 */
export async function mockPageFor(userId: string, askedRole: string | null, deps: MockDeps = {}): Promise<MockPageView> {
  const db = deps.db ?? getDb();
  const now = deps.now ?? new Date();
  const c = contentOf(deps);
  const [elite, analysis] = await Promise.all([eliteOn(userId, db), currentAnalysis(userId, db)]);
  const roles = mockRoles(c.bank, c.roles, c.allowUnreviewed);
  const role = roleFor(c.roles, askedRole, analysis?.result.roleSlug);
  return {
    elite,
    role: roles.find((r) => r.slug === role.slug)!,
    roles,
    bank: bankViewFor(c.bank, role, elite),
    test: elite ? await runningTest(userId, c, db, now) : null,
  };
}

type StartOutcome = { ok: true; test: TimedTestView } | { ok: false; error: TimedTestError };
type PickOutcome = { ok: true } | { ok: false; error: TimedTestError };
type FinishOutcome = { ok: true; review: TimedTestReview } | { ok: false; error: TimedTestError };

/**
 * "Start the test": Elite only, a role with at least 12 multiple-choice questions, and at most 10 starts a day per
 * person (each start counts). The 12 are picked from the bank by the test's id, so the same test always has the same
 * questions; the screen never gets the answers.
 */
export async function startTimedTest(userId: string, raw: unknown, deps: MockDeps = {}): Promise<StartOutcome> {
  const db = deps.db ?? getDb();
  const now = deps.now ?? new Date();
  const c = contentOf(deps);
  const input = timedTestStartInput.safeParse(raw);
  if (!input.success) return { ok: false, error: "invalid" };
  const role = c.roles.find((r) => r.slug === input.data.roleSlug);
  if (!role) return { ok: false, error: "invalid" };
  const id = randomUUID();
  const questionIds = pickTestQuestions(choicePool(c.bank, role, c.allowUnreviewed), id);
  if (!questionIds) return { ok: false, error: "no_test" };
  return db.transaction(async (tx): Promise<StartOutcome> => {
    if (!(await eliteOn(userId, tx))) return { ok: false, error: "not_elite" };
    if (!(await takeShared(LIMITS.timedTestsPerUserDay, userId, { db: tx, now: now.getTime() }))) return { ok: false, error: "limit" };
    const [row] = await tx
      .insert(timedTests)
      .values({ id, userId, roleSlug: role.slug, questionIds, picks: emptyPicks(questionIds.length), startedAt: now })
      .returning(testColumns);
    const test = testViewOf(row, c.byId, role.title, now);
    if (!test) throw new Error("timed test questions missing from the bank");
    logEvent("info", "timed_test_started", { questions: questionIds.length });
    return { ok: true, test };
  });
}

/** The person's own test, locked for this change. Someone else's test id finds nothing. */
async function lockedTest(tx: Tx, userId: string, testId: string) {
  const [row] = await tx
    .select(testColumns)
    .from(timedTests)
    .where(and(eq(timedTests.id, testId), eq(timedTests.userId, userId)))
    .for("update");
  return row ?? null;
}

/**
 * One pick. Counted only for the person's own test, for one of that test's questions and one of its options, while the
 * test hasn't ended and is within its 15 minutes; anything later is refused as "over" and changes nothing.
 */
export async function pickTimedTest(userId: string, raw: unknown, deps: MockDeps = {}): Promise<PickOutcome> {
  const db = deps.db ?? getDb();
  const now = deps.now ?? new Date();
  const c = contentOf(deps);
  const input = timedTestPickInput.safeParse(raw);
  if (!input.success) return { ok: false, error: "invalid" };
  return db.transaction(async (tx): Promise<PickOutcome> => {
    if (!(await eliteOn(userId, tx))) return { ok: false, error: "not_elite" };
    const row = await lockedTest(tx, userId, input.data.testId);
    if (!row) return { ok: false, error: "not_found" };
    if (isOver(row, now)) return { ok: false, error: "over" };
    const picks = withPick(row.questionIds, row.picks, c.byId, input.data.questionId, input.data.pick);
    if (!picks) return { ok: false, error: "invalid" };
    await tx.update(timedTests).set({ picks }).where(and(eq(timedTests.id, row.id), eq(timedTests.userId, userId)));
    return { ok: true };
  });
}

/**
 * "Finish test", or the timer running out: ends the test at now, or at its deadline if that came first, and counts
 * the right answers from the stored picks. Finishing again shows the same review.
 */
export async function finishTimedTest(userId: string, raw: unknown, deps: MockDeps = {}): Promise<FinishOutcome> {
  const db = deps.db ?? getDb();
  const now = deps.now ?? new Date();
  const c = contentOf(deps);
  const input = timedTestFinishInput.safeParse(raw);
  if (!input.success) return { ok: false, error: "invalid" };
  return db.transaction(async (tx): Promise<FinishOutcome> => {
    if (!(await eliteOn(userId, tx))) return { ok: false, error: "not_elite" };
    const row = await lockedTest(tx, userId, input.data.testId);
    if (!row) return { ok: false, error: "not_found" };
    let ended = row.endedAt;
    let right = row.right;
    if (ended === null || right === null) {
      ended = endOf(row.startedAt, now);
      right = scorePicks(row.questionIds, row.picks, c.byId);
      await tx.update(timedTests).set({ endedAt: ended, right }).where(and(eq(timedTests.id, row.id), eq(timedTests.userId, userId)));
      logEvent("info", "timed_test_finished", { right, questions: row.questionIds.length });
    }
    return { ok: true, review: reviewOf({ ...row, endedAt: ended, right }, c.byId, titleOf(c, row.roleSlug)) };
  });
}

/** For "Download your data": every test with its questions, picks (-1 is no answer), times and right answers. */
export async function exportTimedTests(userId: string, db: Pick<Db, "select"> = getDb()) {
  return db
    .select({ roleSlug: timedTests.roleSlug, questionIds: timedTests.questionIds, picks: timedTests.picks, startedAt: timedTests.startedAt, endedAt: timedTests.endedAt, right: timedTests.right })
    .from(timedTests)
    .where(eq(timedTests.userId, userId))
    .orderBy(asc(timedTests.startedAt));
}
