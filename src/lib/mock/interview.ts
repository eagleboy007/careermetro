import type {
  MockFeedbackState,
  MockFocus,
  MockFollowUp,
  MockInterviewError,
  MockInterviewFeedback,
  MockLength,
  MockQuestion,
  MockSessionResult,
  MockSessionView,
} from "@/lib/schemas";
import {
  ELITE_NEEDED_MESSAGE,
  MOCK_FOLLOW_UP_MIN_WORDS,
  MOCK_FOLLOW_UPS_PER_ROUND,
  MOCK_LENGTH_MINUTES,
  MOCK_LENGTH_QUESTIONS,
  MOCK_SESSIONS_PER_DAY,
} from "@/lib/schemas/constants";
import { countWords } from "@/lib/practice/words";
import { ABOUT_SKILLS, followUpsOf, hash32, type MockRoleProfile } from "./rules";

/*
 * Mock interview rules (FR-50 part 3, handoff 12l), apart from the database so they can be tested on their own. The
 * questions are the bank's open questions, picked here by code; the model never writes or picks a question. Its only
 * part is feedback in words when the session ends, which these rules check for anything that reads as a score.
 */

type Open = Extract<MockQuestion, { kind: "open" }>;

export { ABOUT_SKILLS };

const isOpen = (q: MockQuestion): q is Open => q.kind === "open";

/** The role's open questions in the order of its skills, then bank order (as the question bank tab lists them). */
function roleOpen(bank: readonly MockQuestion[], role: MockRoleProfile): Open[] {
  const at = new Map(role.skills.map((s, i) => [s.skillId, i]));
  return bank
    .map((q, i) => ({ q, i }))
    .filter((x): x is { q: Open; i: number } => isOpen(x.q) && x.q.roleSlugs.includes(role.slug))
    .sort((a, b) => (at.get(a.q.skillId) ?? 999) - (at.get(b.q.skillId) ?? 999) || a.i - b.i)
    .map(({ q }) => q);
}

/**
 * Up to `n` of `pool`, the same every time for the same seed: each skill's questions shuffled by the seed and taken in
 * turns across the skills, so a round mixes topics. Skips ids already in `taken`.
 */
export function spread(pool: readonly Open[], seed: string, n: number, taken: ReadonlySet<string> = new Set()): string[] {
  const order = (id: string) => hash32(`${seed}|${id}`);
  const bySkill = new Map<string, Open[]>();
  for (const q of pool) if (!taken.has(q.id)) bySkill.set(q.skillId, [...(bySkill.get(q.skillId) ?? []), q]);
  const lists = [...bySkill.entries()]
    .sort((a, b) => order(a[0]) - order(b[0]) || (a[0] < b[0] ? -1 : 1))
    .map(([, qs]) => [...qs].sort((a, b) => order(a.id) - order(b.id) || (a.id < b.id ? -1 : 1)));
  const out: string[] = [];
  const longest = Math.max(0, ...lists.map((l) => l.length));
  for (let round = 0; round < longest && out.length < n; round++) {
    for (const list of lists) {
      if (out.length >= n) break;
      if (round < list.length && !out.includes(list[round].id)) out.push(list[round].id);
    }
  }
  return out;
}

/**
 * The session's questions, picked by code from the bank's open questions and seeded by the session id:
 * - Mix: one "about you" question first (two in a full round), then the role's technical ones across its skills.
 * Mix and Technical ask about the role's required skills before its nice-to-haves, so a role with many nice-to-have
 * questions (cloud, tooling) still gets a round about what it needs (T127).
 * - Your gaps: questions on the skills of the person's open goals, then the role's others.
 * - Technical: the role's questions other than "about you" ones.
 * - About you: the "about you" questions, then the role's others.
 * Each fills up from the role's remaining questions, then the "about you" ones; a role with fewer questions than the
 * length gets all it has. Null when there is nothing to ask.
 */
export function pickInterviewQuestions(
  bank: readonly MockQuestion[],
  role: MockRoleProfile,
  focus: MockFocus,
  length: MockLength,
  seed: string,
  goalSkills: readonly string[] = [],
): string[] | null {
  const n = MOCK_LENGTH_QUESTIONS[length];
  const forRole = roleOpen(bank, role);
  const about = bank.filter(isOpen).filter((q) => ABOUT_SKILLS.has(q.skillId));
  const technical = forRole.filter((q) => !ABOUT_SKILLS.has(q.skillId));
  const extra = new Set(role.skills.filter((s) => s.importance === "nice_to_have").map((s) => s.skillId));
  const required = technical.filter((q) => !extra.has(q.skillId));
  const goals = new Set(goalSkills);
  const firsts: { pool: readonly Open[]; take: number }[] =
    focus === "mix"
      ? [
          { pool: about, take: Math.max(1, Math.floor(n / 4)) },
          { pool: required, take: n },
          { pool: technical, take: n },
        ]
      : focus === "gaps"
        ? [{ pool: bank.filter(isOpen).filter((q) => goals.has(q.skillId)), take: n }]
        : focus === "technical"
          ? [
              { pool: required, take: n },
              { pool: technical, take: n },
            ]
          : [{ pool: about, take: n }];
  const out: string[] = [];
  for (const step of [...firsts, { pool: forRole, take: n }, { pool: about, take: n }]) {
    if (out.length >= n) break;
    out.push(...spread(step.pool, seed, Math.min(step.take, n - out.length), new Set(out)));
  }
  return out.length ? out : null;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Curly apostrophes, as phone keyboards type them, read as straight ones: "I’d" is "I'd". */
const straightQuotes = (s: string) => s.replace(/[\u2018\u2019]/g, "'");

/** True when the answer has the word or phrase, in any case, as whole words: "log" is in "a log file", not in "login". */
export function mentions(answer: string, phrase: string): boolean {
  const words = straightQuotes(phrase).trim().split(/\s+/).filter(Boolean).map(escapeRe);
  if (!words.length) return false;
  return new RegExp(`(?<![\\p{L}\\p{N}])${words.join("\\s+")}(?![\\p{L}\\p{N}])`, "iu").test(straightQuotes(answer));
}

/**
 * The follow-up to ask after this answer, picked by code, never by the model (docs/plans/mock-followups-plan.md):
 * - none for an answer under 20 words, or once the round has asked its share (2 in a Quick round, 4 in a Full one);
 * - else the question's first follow-up none of whose skip words or phrases is in the answer, since an answer that
 *   already covers the point isn't asked it again;
 * - else none.
 * Only reviewed follow-ups, unless `allowUnreviewed` (local and preview). The same answer always gets the same one.
 */
export function pickFollowUp(
  question: MockQuestion,
  answer: string,
  round: { used: number; length: MockLength; allowUnreviewed: boolean },
): MockFollowUp | null {
  if (countWords(answer) < MOCK_FOLLOW_UP_MIN_WORDS || round.used >= MOCK_FOLLOW_UPS_PER_ROUND[round.length]) return null;
  return followUpsOf(question, round.allowUnreviewed).find((f) => !f.skipIf.some((w) => mentions(answer, w))) ?? null;
}

/** A follow-up's words by its id, from the question it was asked after; null when it has left the bank. */
export function followUpText(question: MockQuestion | null | undefined, followUpId: string | null): string | null {
  if (!followUpId || question?.kind !== "open") return null;
  return question.followUps?.find((f) => f.id === followUpId)?.text ?? null;
}

/** How long a session runs, and when it ends: 10 minutes for Quick, 20 for Full. */
export const minutesOf = (length: MockLength): number => MOCK_LENGTH_MINUTES[length];
export const sessionDeadline = (startedAt: Date, length: MockLength): Date => new Date(startedAt.getTime() + minutesOf(length) * 60_000);
/** An answer sent as the clock ran out may arrive a little late; this long after the deadline it is still taken. */
export const ANSWER_GRACE_MS = 60_000;

type SessionTimes = { startedAt: Date; endedAt: Date | null; length: MockLength };
/** No more answers once the session has ended or its time (plus the grace) is over. */
export const sessionClosed = (s: SessionTimes, now: Date): boolean =>
  s.endedAt !== null || now.getTime() > sessionDeadline(s.startedAt, s.length).getTime() + ANSWER_GRACE_MS;
/** A session the page carries on with: not ended and still within its time. */
export const sessionRunning = (s: SessionTimes, now: Date): boolean => s.endedAt === null && now.getTime() <= sessionDeadline(s.startedAt, s.length).getTime();
/** When an ended session counts as ended: now, or the deadline if that came first. */
export const sessionEndOf = (s: Pick<SessionTimes, "startedAt" | "length">, now: Date): Date => {
  const deadline = sessionDeadline(s.startedAt, s.length);
  return now.getTime() > deadline.getTime() ? deadline : now;
};

/** Where a skipped question opens in the question bank. */
export const bankHrefFor = (roleSlug: string): string => `/mock?tab=bank&role=${encodeURIComponent(roleSlug)}`;

type SessionRow = { id: string; roleSlug: string; length: MockLength; focus: MockFocus; questionIds: string[]; startedAt: Date; endedAt: Date | null };
type AnswerRow = { position: number; answer: string; whatWorked: string | null; addNextTime: string | null; followUpId?: string | null; followUpAnswer?: string | null };

const openOf = (byId: ReadonlyMap<string, MockQuestion>, id: string): Open | null => {
  const q = byId.get(id);
  return q && isOpen(q) ? q : null;
};

/** A running session for the screen, with its saved answers. Null when a question has left the bank. */
export function sessionViewOf(row: SessionRow, answers: readonly AnswerRow[], byId: ReadonlyMap<string, MockQuestion>, roleTitle: string, now: Date): MockSessionView | null {
  const questions = row.questionIds.map((id) => openOf(byId, id));
  if (questions.some((q) => q === null)) return null;
  const saved = new Map(answers.map((a) => [a.position, a.answer]));
  return {
    id: row.id,
    roleSlug: row.roleSlug,
    roleTitle,
    length: row.length,
    focus: row.focus,
    questions: questions.map((q, i) => ({ position: i + 1, id: q!.id, topic: q!.topic, question: q!.question })),
    answers: row.questionIds.map((_, i) => saved.get(i + 1) ?? ""),
    secondsLeft: Math.max(0, Math.floor((sessionDeadline(row.startedAt, row.length).getTime() - now.getTime()) / 1000)),
  };
}

/** The feedback screen for an ended session: every question still in the bank, its answer and the words on it. */
export function resultOf(
  row: SessionRow,
  answers: readonly AnswerRow[],
  byId: ReadonlyMap<string, MockQuestion>,
  roleTitle: string,
  feedback: MockFeedbackState,
  summary: string | null,
): MockSessionResult {
  const saved = new Map(answers.map((a) => [a.position, a]));
  const items = row.questionIds.flatMap((id, i) => {
    const q = openOf(byId, id);
    if (!q) return [];
    const a = saved.get(i + 1);
    const asked = a ? followUpText(q, a.followUpId ?? null) : null;
    return [
      {
        position: i + 1,
        id: q.id,
        topic: q.topic,
        question: q.question,
        answer: a?.answer ?? null,
        whatWorked: a?.whatWorked ?? null,
        addNextTime: a?.addNextTime ?? null,
        followUp: asked ? { question: asked, answer: a?.followUpAnswer ?? null } : null,
        bankHref: bankHrefFor(row.roleSlug),
      },
    ];
  });
  return {
    id: row.id,
    roleTitle,
    length: row.length,
    answered: answers.length,
    total: row.questionIds.length,
    feedback,
    summary: feedback === "ready" ? summary : null,
    items,
  };
}

/** How long the prompt asks each part to be, in words; the eval fails anything longer. */
export const MOCK_FEEDBACK_WORDS = { summary: 80, point: 40 } as const;

// "production-grade" is not a grade, so a word joined by a hyphen before it doesn't count.
const SCORE_WORDS = /(?<!-)\b(scores?|scored|scoring|grades?|graded|grading|ratings?|rated|marks|percentile)\b/i;
// "24/7" is not a score: only a number out of 5, 10 or 100 reads as one.
const SCORE_SHAPES = /\b\d+(\.\d+)?\s*(\/|out\s+of)\s*(5|10|100)\b|\b(one|two|three|four|five|six|seven|eight|nine|ten)\s+out\s+of\s+(five|ten)\b/i;
const READY = /\b(ready|unready|readiness)\b/i;
const NUMBER = /\d+(?:\.\d+)?/g;

export type FeedbackProblems = { scoreWords: string[]; ready: string[]; numbers: string[]; tooLong: string[]; exclamations: number };

/**
 * What in the feedback breaks the prompt's rules: score words or score shapes ("7/10", "four out of five"), anything
 * saying ready or not ready, numbers that are in nothing the model was given (`given`: the questions and answers),
 * parts over their word caps, and exclamation marks. The eval fails on any of them; the app drops feedback with score
 * words, score shapes or "ready", so the person never sees one.
 */
export function feedbackProblems(f: MockInterviewFeedback, given: string): FeedbackProblems {
  const parts = [f.summary, ...f.questions.flatMap((q) => [q.whatWorked, q.addNextTime])];
  const known = new Set(given.match(NUMBER) ?? []);
  const found = (re: RegExp): string[] =>
    parts.flatMap((p) => {
      const m = p.match(re);
      return m ? [m[0]] : [];
    });
  return {
    scoreWords: [...found(SCORE_WORDS), ...found(SCORE_SHAPES)],
    ready: found(READY),
    numbers: parts.flatMap((p) => (p.match(NUMBER) ?? []).filter((n) => !known.has(n))),
    tooLong: [
      ...(countWords(f.summary) > MOCK_FEEDBACK_WORDS.summary ? ["summary"] : []),
      ...f.questions.flatMap((q) => [
        ...(countWords(q.whatWorked) > MOCK_FEEDBACK_WORDS.point ? [`${q.position}.whatWorked`] : []),
        ...(countWords(q.addNextTime) > MOCK_FEEDBACK_WORDS.point ? [`${q.position}.addNextTime`] : []),
      ]),
    ],
    exclamations: parts.filter((p) => p.includes("!")).length,
  };
}

/** True when the app may show this feedback: words only, no score and nothing about being ready. */
export function feedbackShowable(f: MockInterviewFeedback): boolean {
  const p = feedbackProblems(f, "");
  return p.scoreWords.length === 0 && p.ready.length === 0;
}

/**
 * The model's feedback matched to the answered positions: each answered position once, nothing for a question that
 * wasn't answered. Null when it misses one or adds one.
 */
export function matchFeedback(f: MockInterviewFeedback, answered: readonly number[]): MockInterviewFeedback | null {
  const want = [...answered].sort((a, b) => a - b);
  const got = [...f.questions].sort((a, b) => a.position - b.position);
  if (got.length !== want.length || got.some((q, i) => q.position !== want[i])) return null;
  return { summary: f.summary, questions: got };
}

export const MOCK_INTERVIEW_MESSAGES: Record<MockInterviewError, string> = {
  invalid: "That didn't work. Please refresh the page and try again.",
  not_elite: ELITE_NEEDED_MESSAGE,
  limit: `That's ${MOCK_SESSIONS_PER_DAY} mock interviews today, as many as we allow in a day. Try again tomorrow.`,
  no_questions: "Mock interview for this role is coming. The question bank is open now.",
  not_found: "We couldn't find that mock interview. Start a new one.",
  over: "Time is up for this mock interview. Your answers so far are in the feedback.",
};

/** What the feedback screen says when there is no feedback in words. */
export const MOCK_FEEDBACK_TEXT: Record<Exclude<MockFeedbackState, "ready">, string> = {
  none_answered: "Nothing answered this round, so there is no feedback. Try a quick round when you have ten quiet minutes.",
  unavailable_today: "Feedback isn't available today. Your answers are saved; the questions and what a strong answer covers are in the bank.",
  unavailable: "Feedback isn't available just now. Your answers are saved; the questions and what a strong answer covers are in the bank.",
};
