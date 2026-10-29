import { z } from "zod";
import { jobPrepView, myJobRef } from "./my-jobs";
import {
  JOB_COMPANY_SHOWN,
  JOB_TITLE_SHOWN,
  MOCK_ANSWER_MAX_CHARS,
  MOCK_FEEDBACK_STATES,
  MOCK_FOCUSES,
  MOCK_FOLLOW_UP_MAX_CHARS,
  MOCK_FOLLOW_UP_SKIP_WORDS,
  MOCK_FOLLOW_UP_STATES,
  MOCK_FOLLOW_UPS_PER_QUESTION,
  MOCK_LENGTHS,
  MOCK_MAX_QUESTIONS,
  MOCK_TABS,
  ROLE_PREP_QUESTIONS,
  TIMED_TEST_QUESTIONS,
} from "./constants";

/*
 * Interview prep (`/mock`, FR-50 part 2, handoff 12l, docs/plans/elite-plan.md): the question bank and the timed test.
 * The bank is content (src/content/mock-bank.json), never written by the model; the timed test is picked and scored
 * by code. No billing anywhere.
 */

export {
  MOCK_ANSWER_MAX_CHARS,
  MOCK_BANK_FREE_OPEN,
  MOCK_FEEDBACK_PER_DAY,
  MOCK_FEEDBACK_STATES,
  MOCK_FOCUSES,
  MOCK_FOLLOW_UP_MAX_CHARS,
  MOCK_FOLLOW_UP_MIN_WORDS,
  MOCK_FOLLOW_UP_SKIP_WORDS,
  MOCK_FOLLOW_UP_STATES,
  MOCK_FOLLOW_UPS_PER_QUESTION,
  MOCK_FOLLOW_UPS_PER_ROUND,
  MOCK_LENGTH_MINUTES,
  MOCK_LENGTH_QUESTIONS,
  MOCK_LENGTHS,
  MOCK_MAX_QUESTIONS,
  MOCK_SESSIONS_PER_DAY,
  MOCK_TABS,
  ROLE_PREP_FREE_OPEN,
  ROLE_PREP_QUESTIONS,
  TIMED_TEST_MINUTES,
  TIMED_TEST_QUESTIONS,
  TIMED_TESTS_PER_DAY,
} from "./constants";

const slug = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
const questionId = z.string().min(3).max(80).regex(slug);
const topic = z.string().min(1).max(40);
const text = (max: number) => z.string().min(3).max(max);

const common = {
  id: questionId,
  roleSlugs: z.array(z.string().regex(slug)).min(1).max(200), // A shared question can file under every role (74 on 29 Oct), with room to grow.
  skillId: z.string().regex(slug),
  topic,
  question: text(300),
  level: z.literal("L1"),
};

/**
 * A follow-up the mock interview may ask after an answer to its question (docs/plans/mock-followups-plan.md): written
 * by people, picked by code, never by the model. `skipIf` holds words or phrases that mean the answer already covers
 * the point, so it isn't asked.
 */
export const mockFollowUp = z.strictObject({
  id: questionId,
  text: text(MOCK_FOLLOW_UP_MAX_CHARS),
  skipIf: z.array(z.string().trim().min(2).max(40)).max(MOCK_FOLLOW_UP_SKIP_WORDS),
});
export type MockFollowUp = z.infer<typeof mockFollowUp>;

/**
 * An open question for the bank: the Practice bank's question, its "look for" as "a strong answer covers", and up to
 * two follow-ups. `followUpsReviewed` is true once someone who works in the role has checked them; production asks
 * only reviewed ones.
 */
export const mockOpenQuestion = z.strictObject({
  ...common,
  kind: z.literal("open"),
  strongCovers: text(600),
  followUps: z.array(mockFollowUp).max(MOCK_FOLLOW_UPS_PER_QUESTION).optional(),
  followUpsReviewed: z.boolean().optional(),
});

/**
 * A multiple-choice question for the timed test: 2 to 5 options, the index of the right one and why it is right.
 * `reviewed` is true once someone who works in the role has checked it; production uses only reviewed questions.
 */
export const mockChoiceQuestion = z.strictObject({
  ...common,
  kind: z.literal("choice"),
  options: z.array(z.string().min(1).max(200)).min(2).max(5),
  answer: z.number().int().min(0).max(4),
  explanation: text(600),
  reviewed: z.boolean(),
});

/** One question of the interview prep bank (handoff 12l). */
export const mockQuestion = z
  .discriminatedUnion("kind", [mockOpenQuestion, mockChoiceQuestion])
  .superRefine((q, ctx) => {
    if (q.kind === "open") {
      const ups = q.followUps ?? [];
      if (ups.length && q.followUpsReviewed === undefined) ctx.addIssue({ code: "custom", path: ["followUpsReviewed"], message: "follow-ups say whether they are reviewed" });
      // The second is asked only when the answer covers the first, so the first needs words that say so.
      if (ups.length > 1 && ups[0].skipIf.length === 0) ctx.addIssue({ code: "custom", path: ["followUps", 0, "skipIf"], message: "the first of two follow-ups has skip words" });
      return;
    }
    if (q.answer >= q.options.length) ctx.addIssue({ code: "custom", path: ["answer"], message: "the answer is one of the options" });
    if (new Set(q.options).size !== q.options.length) ctx.addIssue({ code: "custom", path: ["options"], message: "options differ" });
  });
export type MockQuestion = z.infer<typeof mockQuestion>;
export type MockChoiceQuestion = z.infer<typeof mockChoiceQuestion>;

/** src/content/mock-bank.json: a note on where the content came from, and the questions with unique ids. */
export const mockBankFile = z
  .strictObject({ note: z.string().min(1).max(1000), questions: z.array(mockQuestion).min(1).max(2000) })
  .refine((b) => new Set(b.questions.map((q) => q.id)).size === b.questions.length, { message: "question ids are unique" })
  .refine(
    (b) => {
      const ids = b.questions.flatMap((q) => (q.kind === "open" ? (q.followUps ?? []).map((f) => f.id) : []));
      return new Set(ids).size === ids.length;
    },
    { message: "follow-up ids are unique" },
  );

export const mockTab = z.enum(MOCK_TABS);
export type MockTab = z.infer<typeof mockTab>;

/** A bank question as the screen gets it: open with its note and Practise link, or locked with neither. */
export const mockBankItem = z.union([
  z.strictObject({
    open: z.literal(true),
    id: questionId,
    topic,
    question: text(300),
    strongCovers: text(600),
    /** The follow-ups a mock interview may ask after it, to study. */
    followUps: z.array(text(MOCK_FOLLOW_UP_MAX_CHARS)).max(MOCK_FOLLOW_UPS_PER_QUESTION).optional(),
    practiceHref: z.string().startsWith("/practice"),
  }),
  z.strictObject({ open: z.literal(false), id: questionId, topic, question: text(300) }),
]);
export type MockBankItem = z.infer<typeof mockBankItem>;

export const mockBankView = z.strictObject({
  topics: z.array(topic).max(40),
  items: z.array(mockBankItem).max(400),
});
export type MockBankView = z.infer<typeof mockBankView>;

/**
 * "Interview prep for this role" on a Departures role (FR-50, handoff 12l): five of the role's bank questions. A
 * locked question carries no text at all, so nothing of it reaches the browser.
 */
export const rolePrepItem = z.union([z.strictObject({ open: z.literal(true), id: questionId, question: text(300) }), z.strictObject({ open: z.literal(false), id: questionId })]);
export type RolePrepItem = z.infer<typeof rolePrepItem>;

export const rolePrepView = z.strictObject({
  roleSlug: z.string().regex(slug),
  elite: z.boolean(),
  questions: z.array(rolePrepItem).length(ROLE_PREP_QUESTIONS),
});
export type RolePrepView = z.infer<typeof rolePrepView>;

export const mockFollowUpState = z.enum(MOCK_FOLLOW_UP_STATES);
export type MockFollowUpState = z.infer<typeof mockFollowUpState>;

/**
 * A role in the picker: whether it has enough multiple-choice questions for a timed test, and whether its mock
 * interview can ask follow-ups (none, only ones still waiting for review, or checked ones).
 */
export const mockRole = z.strictObject({ slug: z.string().regex(slug), title: z.string().min(1).max(120), hasTest: z.boolean(), followUps: mockFollowUpState });
export type MockRole = z.infer<typeof mockRole>;

const option = z.string().min(1).max(200);
const pick = z.number().int().min(0).max(4);

/** A running test as the screen gets it: never the answers. `picks` holds null where nothing is picked yet. */
export const timedTestView = z.strictObject({
  id: uuid,
  roleTitle: z.string().min(1).max(120),
  questions: z
    .array(z.strictObject({ id: questionId, topic, question: text(300), options: z.array(option).min(2).max(5) }))
    .length(TIMED_TEST_QUESTIONS),
  picks: z.array(pick.nullable()).length(TIMED_TEST_QUESTIONS),
  secondsLeft: z.number().int().min(0),
});
export type TimedTestView = z.infer<typeof timedTestView>;

/** The review after a test: every question with the pick, the right answer and why, and the count right. */
export const timedTestReview = z.strictObject({
  id: uuid,
  roleTitle: z.string().min(1).max(120),
  right: z.number().int().min(0).max(TIMED_TEST_QUESTIONS),
  total: z.number().int().min(1).max(TIMED_TEST_QUESTIONS),
  secondsUsed: z.number().int().min(0),
  items: z
    .array(z.strictObject({ id: questionId, topic, question: text(300), options: z.array(option).min(2).max(5), pick: pick.nullable(), answer: pick, explanation: text(600) }))
    .max(TIMED_TEST_QUESTIONS),
});
export type TimedTestReview = z.infer<typeof timedTestReview>;


/** "Start the test" for a role. */
export const timedTestStartInput = z.strictObject({ roleSlug: z.string().min(1).max(80).regex(slug) });
/** One pick: the test, one of its questions and the option's index. */
export const timedTestPickInput = z.strictObject({ testId: uuid, questionId, pick });
/** "Finish test", or the timer running out. */
export const timedTestFinishInput = z.strictObject({ testId: uuid });

export const TIMED_TEST_ERRORS = ["invalid", "not_elite", "limit", "no_test", "not_found", "over"] as const;
export type TimedTestError = (typeof TIMED_TEST_ERRORS)[number];

/** What the actions give the screen: the words to show when something is refused. */
export type TimedTestStartResult = { ok: true; test: TimedTestView } | { ok: false; message: string };
export type TimedTestPickResult = { ok: true } | { ok: false; message: string; over: boolean };
export type TimedTestFinishResult = { ok: true; review: TimedTestReview } | { ok: false; message: string };

/*
 * The mock interview (FR-50 part 3, handoff 12l, prompts/mock-interview): bank questions picked by code for a role,
 * length and focus; the person's typed (or spoken, turned to text on their device) answers; and one model call when
 * the session ends, for feedback in words. Never a score, grade, rating or "ready".
 */

export const mockLength = z.enum(MOCK_LENGTHS);
export type MockLength = z.infer<typeof mockLength>;
export const mockFocus = z.enum(MOCK_FOCUSES);
export type MockFocus = z.infer<typeof mockFocus>;
const position = z.number().int().min(1).max(MOCK_MAX_QUESTIONS);
/** An answer as typed: trimmed, at most 4,000 characters. Empty means the question was skipped. */
const answerText = z.string().trim().max(MOCK_ANSWER_MAX_CHARS);

/** "Start mock interview": the role, Quick or Full, and the focus; "This job's skills" names the job in My jobs. */
export const mockInterviewStartInput = z
  .strictObject({ roleSlug: z.string().min(1).max(80).regex(slug), length: mockLength, focus: mockFocus, job: myJobRef.optional() })
  .refine((v) => (v.focus === "job") === (v.job !== undefined), { message: "a job round names its job, and only a job round does" });
/** "Next": the answer to one question of the person's running session (empty clears a saved one). */
export const mockInterviewAnswerInput = z.strictObject({ sessionId: uuid, position, answer: answerText });
/** The reply to the follow-up asked at one position of the person's running session: 1 to 4,000 characters. */
export const saveFollowUpAnswerInput = z.strictObject({ sessionId: uuid, position, answer: answerText.min(1) });
/** "End and get feedback", or the time running out: any answers and an open follow-up's reply not saved yet go with it. */
export const mockInterviewEndInput = z.strictObject({
  sessionId: uuid,
  answers: z.array(z.strictObject({ position, answer: answerText })).max(MOCK_MAX_QUESTIONS),
  followUps: z.array(z.strictObject({ position, answer: answerText })).max(MOCK_MAX_QUESTIONS).optional(),
});

/**
 * What prompts/mock-interview must return: a summary in words and, for each answered question by its position, what
 * worked and what to add next time. Positions are checked against the answers in code (src/lib/mock/interview-feedback.ts).
 */
export const mockInterviewFeedback = z.object({
  summary: z.string().trim().min(1).max(800),
  questions: z
    .array(z.object({ position: z.number().int(), whatWorked: z.string().trim().min(1).max(500), addNextTime: z.string().trim().min(1).max(500) }))
    .min(1)
    .max(MOCK_MAX_QUESTIONS),
});
export type MockInterviewFeedback = z.infer<typeof mockInterviewFeedback>;
/** What mock_sessions.feedback keeps: the summary only; per-question words sit with the answers. */
export type MockSessionFeedback = { summary: string };

const roleTitle = z.string().min(1).max(120);
/** The job in My jobs a round is for: "Mock interview for <company>, <title>". Null for a round for the role. */
const roundJob = z.strictObject({ company: z.string().min(1).max(JOB_COMPANY_SHOWN), title: z.string().min(1).max(JOB_TITLE_SHOWN) }).nullable();
export const mockInterviewQuestion = z.strictObject({ position, id: questionId, topic, question: text(300) });
export type MockInterviewQuestion = z.infer<typeof mockInterviewQuestion>;

/** A running session as the screen gets it: its questions, the answers saved so far ("" for none) and time left. */
export const mockSessionView = z.strictObject({
  id: uuid,
  roleSlug: z.string().regex(slug),
  roleTitle,
  length: mockLength,
  focus: mockFocus,
  job: roundJob,
  questions: z.array(mockInterviewQuestion).min(1).max(MOCK_MAX_QUESTIONS),
  answers: z.array(z.string().max(MOCK_ANSWER_MAX_CHARS)).max(MOCK_MAX_QUESTIONS),
  secondsLeft: z.number().int().min(0),
});
export type MockSessionView = z.infer<typeof mockSessionView>;

export const mockFeedbackState = z.enum(MOCK_FEEDBACK_STATES);
export type MockFeedbackState = z.infer<typeof mockFeedbackState>;

/** The feedback screen: the summary in words, then each question with the answer, what worked and what to add. */
export const mockSessionResult = z.strictObject({
  id: uuid,
  roleTitle,
  job: roundJob,
  length: mockLength,
  answered: z.number().int().min(0).max(MOCK_MAX_QUESTIONS),
  total: z.number().int().min(1).max(MOCK_MAX_QUESTIONS),
  feedback: mockFeedbackState,
  summary: z.string().max(800).nullable(),
  items: z
    .array(
      z.strictObject({
        position,
        id: questionId,
        topic,
        question: text(300),
        answer: z.string().max(MOCK_ANSWER_MAX_CHARS).nullable(),
        whatWorked: z.string().max(500).nullable(),
        addNextTime: z.string().max(500).nullable(),
        /** The follow-up asked after the answer and the reply, null when none was asked; a null answer was skipped. */
        followUp: z.strictObject({ question: text(MOCK_FOLLOW_UP_MAX_CHARS), answer: z.string().max(MOCK_ANSWER_MAX_CHARS).nullable() }).nullable(),
        bankHref: z.string().startsWith("/mock"),
      }),
    )
    .max(MOCK_MAX_QUESTIONS),
});
export type MockSessionResult = z.infer<typeof mockSessionResult>;

export const MOCK_INTERVIEW_ERRORS = ["invalid", "not_elite", "limit", "no_questions", "not_found", "over", "no_job"] as const;
export type MockInterviewError = (typeof MOCK_INTERVIEW_ERRORS)[number];

export type MockInterviewStartResult = { ok: true; session: MockSessionView } | { ok: false; message: string };
/** A follow-up the interviewer asks after an answer: its position (the question's), the question's topic and its text. */
export type MockFollowUpAsked = { position: number; topic: string; text: string };
export type MockInterviewAnswerResult = { ok: true; followUp?: MockFollowUpAsked } | { ok: false; message: string; over: boolean };
export type MockFollowUpAnswerResult = { ok: true } | { ok: false; message: string; over: boolean };
export type MockInterviewEndResult = { ok: true; result: MockSessionResult } | { ok: false; message: string };

/** Everything /mock shows. `test` and `interview` are the person's running test and session, if still within time. */
export const mockPageView = z.strictObject({
  elite: z.boolean(),
  role: mockRole,
  roles: z.array(mockRole).max(60),
  bank: mockBankView,
  test: timedTestView.nullable(),
  interview: mockSessionView.nullable(),
  /** `/mock?job=`: the job in My jobs the set-up is for, when it is the person's own. */
  job: jobPrepView.nullable(),
});
export type MockPageView = z.infer<typeof mockPageView>;
