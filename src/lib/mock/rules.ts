import type { MockBankItem, MockBankView, MockChoiceQuestion, MockQuestion, MockRole, RolePrepView, TimedTestError, TimedTestReview, TimedTestView } from "@/lib/schemas";
import { ELITE_NEEDED_MESSAGE, MOCK_BANK_FREE_OPEN, ROLE_PREP_FREE_OPEN, ROLE_PREP_QUESTIONS, TIMED_TEST_MINUTES, TIMED_TEST_QUESTIONS, TIMED_TESTS_PER_DAY } from "@/lib/schemas/constants";

/*
 * Interview prep rules (`/mock`, FR-50 part 2, handoff 12l), kept apart from the database so they can be tested on
 * their own. Everything here is deterministic code over the bank: no model picks, asks or scores anything.
 */

/** What the rules need of a role profile: its slug, title and skills in order. */
export type MockRoleProfile = { slug: string; title: string; skills: readonly { skillId: string }[] };
type Role = MockRoleProfile;
export type BankQuestion = MockQuestion;

/** The role a person lands on: the one asked for, else their target role, else Data Analyst, the most common target. */
export const DEFAULT_MOCK_ROLE = "data-analyst";

export function roleFor(roles: readonly Role[], asked: string | null | undefined, target: string | null | undefined): Role {
  return roles.find((r) => r.slug === asked) ?? roles.find((r) => r.slug === target) ?? roles.find((r) => r.slug === DEFAULT_MOCK_ROLE) ?? roles[0];
}

/** Unreviewed multiple-choice questions are used on local and preview deployments only, never in production. */
export const unreviewedAllowed = (env: Record<string, string | undefined> = process.env): boolean => env.VERCEL_ENV !== "production";

/** The role's questions in the order of its skills (required first, as the role profile lists them), then bank order. */
function forRole<Q extends BankQuestion>(questions: readonly Q[], role: Role): Q[] {
  const at = new Map(role.skills.map((s, i) => [s.skillId, i]));
  return questions
    .map((q, i) => ({ q, i }))
    .filter(({ q }) => q.roleSlugs.includes(role.slug))
    .sort((a, b) => (at.get(a.q.skillId) ?? 999) - (at.get(b.q.skillId) ?? 999) || a.i - b.i)
    .map(({ q }) => q);
}

/** The multiple-choice questions a timed test for this role may use. */
export function choicePool(bank: readonly BankQuestion[], role: Role, allowUnreviewed: boolean): MockChoiceQuestion[] {
  const choice = bank.filter((q): q is MockChoiceQuestion => q.kind === "choice" && (q.reviewed || allowUnreviewed));
  return forRole(choice, role);
}

/** Roles for the picker, each saying whether it has enough questions for a test. */
export function mockRoles(bank: readonly BankQuestion[], roles: readonly Role[], allowUnreviewed: boolean): MockRole[] {
  return roles.map((r) => ({ slug: r.slug, title: r.title, hasTest: choicePool(bank, r, allowUnreviewed).length >= TIMED_TEST_QUESTIONS }));
}

/**
 * Which open questions a Free person can open: the first question of each topic in role order, up to 5, then the next
 * ones, so the free five spread across the role's skills. Elite opens all of them.
 */
export function freeOpenIds(open: readonly BankQuestion[]): Set<string> {
  const ids: string[] = [];
  const topics = new Set<string>();
  for (const q of open) {
    if (ids.length >= MOCK_BANK_FREE_OPEN) break;
    if (!topics.has(q.topic)) {
      topics.add(q.topic);
      ids.push(q.id);
    }
  }
  for (const q of open) {
    if (ids.length >= MOCK_BANK_FREE_OPEN) break;
    if (!ids.includes(q.id)) ids.push(q.id);
  }
  return new Set(ids);
}

/**
 * "Interview prep for this role" on a Departures role (handoff 12l): five of the role's open questions, in the order
 * the bank opens them on Free (the first of each topic first). On Free only the first is open; a locked question keeps
 * its id and nothing else. Null when the role has fewer than five open questions, so the screen says it is coming.
 */
export function rolePrepFor(bank: readonly BankQuestion[], role: Role, elite: boolean): RolePrepView | null {
  const open = forRole(
    bank.filter((q) => q.kind === "open"),
    role,
  );
  const byId = new Map(open.map((q) => [q.id, q]));
  const five = [...freeOpenIds(open)].slice(0, ROLE_PREP_QUESTIONS).map((id) => byId.get(id)!);
  if (five.length < ROLE_PREP_QUESTIONS) return null;
  return {
    roleSlug: role.slug,
    elite,
    questions: five.map((q, i) => (elite || i < ROLE_PREP_FREE_OPEN ? { open: true, id: q.id, question: q.question } : { open: false, id: q.id })),
  };
}

/** Each Departures job's interview prep, by job id: null for a job with no library role, or one the bank can't fill. */
export function prepForJobs(
  jobs: readonly { id: string; roleSlug: string | null }[],
  bank: readonly BankQuestion[],
  roles: readonly Role[],
  elite: boolean,
): Record<string, RolePrepView | null> {
  return Object.fromEntries(
    jobs.map((j) => {
      const role = j.roleSlug ? roles.find((r) => r.slug === j.roleSlug) : undefined;
      return [j.id, role ? rolePrepFor(bank, role, elite) : null];
    }),
  );
}

/** The question bank tab for a role: every open question, 5 of them open on Free and all on Elite. */
export function bankViewFor(bank: readonly BankQuestion[], role: Role, elite: boolean): MockBankView {
  const open = forRole(
    bank.filter((q) => q.kind === "open"),
    role,
  );
  const free = freeOpenIds(open);
  const items = open.map((q): MockBankItem =>
    (elite || free.has(q.id)) && q.kind === "open"
      ? { open: true, id: q.id, topic: q.topic, question: q.question, strongCovers: q.strongCovers, practiceHref: `/practice?q=${encodeURIComponent(q.id)}` }
      : { open: false, id: q.id, topic: q.topic, question: q.question },
  );
  return { topics: [...new Set(open.map((q) => q.topic))], items };
}

/** FNV-1a, 32 bits: a small stable hash, so the same seed always picks the same questions. */
export function hash32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/**
 * Picks the test's 12 questions from the pool, the same every time for the same seed (the test's id): each skill's
 * questions are shuffled by the seed, then taken in turns across the skills, so a test mixes the role's topics. Null
 * when the pool has fewer than 12.
 */
export function pickTestQuestions(pool: readonly MockChoiceQuestion[], seed: string, n = TIMED_TEST_QUESTIONS): string[] | null {
  if (pool.length < n) return null;
  const bySkill = new Map<string, MockChoiceQuestion[]>();
  for (const q of pool) bySkill.set(q.skillId, [...(bySkill.get(q.skillId) ?? []), q]);
  const order = (id: string) => hash32(`${seed}|${id}`);
  const lists = [...bySkill.entries()]
    .sort((a, b) => order(a[0]) - order(b[0]) || (a[0] < b[0] ? -1 : 1))
    .map(([, qs]) => [...qs].sort((a, b) => order(a.id) - order(b.id) || (a.id < b.id ? -1 : 1)));
  const out: string[] = [];
  for (let round = 0; out.length < n; round++) {
    for (const list of lists) {
      if (out.length >= n) break;
      if (round < list.length) out.push(list[round].id);
    }
  }
  return out;
}

/** "No answer" in the stored picks. */
export const NO_PICK = -1;

export const emptyPicks = (n = TIMED_TEST_QUESTIONS): number[] => Array.from({ length: n }, () => NO_PICK);

/** When the test's 15 minutes run out. */
export const deadlineOf = (startedAt: Date): Date => new Date(startedAt.getTime() + TIMED_TEST_MINUTES * 60_000);

/** A test takes no more picks once it is finished or its 15 minutes are over. */
export const isOver = (t: { startedAt: Date; endedAt: Date | null }, now: Date): boolean => t.endedAt !== null || now.getTime() > deadlineOf(t.startedAt).getTime();

/** When a finished test counts as ended: now, or the deadline if that came first. */
export const endOf = (startedAt: Date, now: Date): Date => (now.getTime() > deadlineOf(startedAt).getTime() ? deadlineOf(startedAt) : now);

/** Right answers: a pick counts only when it is the right option of the question at that position. */
export function scorePicks(questionIds: readonly string[], picks: readonly number[], byId: ReadonlyMap<string, BankQuestion>): number {
  let right = 0;
  questionIds.forEach((id, i) => {
    const q = byId.get(id);
    if (q?.kind === "choice" && picks[i] === q.answer) right++;
  });
  return right;
}

/** The picks with one changed, or null when the question isn't one of the test's or the option doesn't exist. */
export function withPick(questionIds: readonly string[], picks: readonly number[], byId: ReadonlyMap<string, BankQuestion>, questionId: string, pick: number): number[] | null {
  const at = questionIds.indexOf(questionId);
  const q = byId.get(questionId);
  if (at < 0 || q?.kind !== "choice" || pick < 0 || pick >= q.options.length) return null;
  const next = questionIds.map((_, i) => picks[i] ?? NO_PICK);
  next[at] = pick;
  return next;
}

type TestRow = { id: string; roleSlug: string; questionIds: string[]; picks: number[]; startedAt: Date; endedAt: Date | null; right: number | null };

const choiceOf = (byId: ReadonlyMap<string, BankQuestion>, id: string): MockChoiceQuestion | null => {
  const q = byId.get(id);
  return q?.kind === "choice" ? q : null;
};

/** A running test for the screen, without the answers. Null when a question has left the bank. */
export function testViewOf(row: TestRow, byId: ReadonlyMap<string, BankQuestion>, roleTitle: string, now: Date): TimedTestView | null {
  const questions = row.questionIds.map((id) => choiceOf(byId, id));
  if (questions.some((q) => q === null)) return null;
  return {
    id: row.id,
    roleTitle,
    questions: questions.map((q) => ({ id: q!.id, topic: q!.topic, question: q!.question, options: q!.options })),
    picks: row.questionIds.map((_, i) => (row.picks[i] === undefined || row.picks[i] === NO_PICK ? null : row.picks[i])),
    secondsLeft: Math.max(0, Math.floor((deadlineOf(row.startedAt).getTime() - now.getTime()) / 1000)),
  };
}

/** The review: every question still in the bank with the pick, the right answer and why, and the count right. */
export function reviewOf(row: TestRow & { endedAt: Date; right: number }, byId: ReadonlyMap<string, BankQuestion>, roleTitle: string): TimedTestReview {
  const items = row.questionIds.flatMap((id, i) => {
    const q = choiceOf(byId, id);
    if (!q) return [];
    const pick = row.picks[i] === undefined || row.picks[i] === NO_PICK ? null : row.picks[i];
    return [{ id: q.id, topic: q.topic, question: q.question, options: q.options, pick, answer: q.answer, explanation: q.explanation }];
  });
  return {
    id: row.id,
    roleTitle,
    right: row.right,
    total: row.questionIds.length,
    secondsUsed: Math.max(0, Math.round((row.endedAt.getTime() - row.startedAt.getTime()) / 1000)),
    items,
  };
}

export const TIMED_TEST_MESSAGES: Record<TimedTestError, string> = {
  invalid: "That didn't work. Please refresh the page and try again.",
  not_elite: ELITE_NEEDED_MESSAGE,
  limit: `That's ${TIMED_TESTS_PER_DAY} tests today, as many as we allow in a day. Try again tomorrow.`,
  no_test: "Timed test for this role is coming.",
  not_found: "We couldn't find that test. Start a new one.",
  over: "Time is up for this test. Your answers so far are in the review.",
};
