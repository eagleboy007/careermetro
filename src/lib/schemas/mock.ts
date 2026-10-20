import { z } from "zod";
import { MOCK_TABS, TIMED_TEST_QUESTIONS } from "./constants";

/*
 * Interview prep (`/mock`, FR-50 part 2, handoff 12l, docs/plans/elite-plan.md): the question bank and the timed test.
 * The bank is content (src/content/mock-bank.json), never written by the model; the timed test is picked and scored
 * by code. No billing anywhere.
 */

export { MOCK_BANK_FREE_OPEN, MOCK_TABS, TIMED_TEST_MINUTES, TIMED_TEST_QUESTIONS, TIMED_TESTS_PER_DAY } from "./constants";

const slug = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
const questionId = z.string().min(3).max(80).regex(slug);
const topic = z.string().min(1).max(40);
const text = (max: number) => z.string().min(3).max(max);

const common = {
  id: questionId,
  roleSlugs: z.array(z.string().regex(slug)).min(1).max(40),
  skillId: z.string().regex(slug),
  topic,
  question: text(300),
  level: z.literal("L1"),
};

/** An open question for the bank: the Practice bank's question, its "look for" as "a strong answer covers". */
export const mockOpenQuestion = z.strictObject({ ...common, kind: z.literal("open"), strongCovers: text(600) });

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
    if (q.kind !== "choice") return;
    if (q.answer >= q.options.length) ctx.addIssue({ code: "custom", path: ["answer"], message: "the answer is one of the options" });
    if (new Set(q.options).size !== q.options.length) ctx.addIssue({ code: "custom", path: ["options"], message: "options differ" });
  });
export type MockQuestion = z.infer<typeof mockQuestion>;
export type MockChoiceQuestion = z.infer<typeof mockChoiceQuestion>;

/** src/content/mock-bank.json: a note on where the content came from, and the questions with unique ids. */
export const mockBankFile = z
  .strictObject({ note: z.string().min(1).max(1000), questions: z.array(mockQuestion).min(1).max(2000) })
  .refine((b) => new Set(b.questions.map((q) => q.id)).size === b.questions.length, { message: "question ids are unique" });

export const mockTab = z.enum(MOCK_TABS);
export type MockTab = z.infer<typeof mockTab>;

/** A bank question as the screen gets it: open with its note and Practise link, or locked with neither. */
export const mockBankItem = z.union([
  z.strictObject({ open: z.literal(true), id: questionId, topic, question: text(300), strongCovers: text(600), practiceHref: z.string().startsWith("/practice") }),
  z.strictObject({ open: z.literal(false), id: questionId, topic, question: text(300) }),
]);
export type MockBankItem = z.infer<typeof mockBankItem>;

export const mockBankView = z.strictObject({
  topics: z.array(topic).max(40),
  items: z.array(mockBankItem).max(400),
});
export type MockBankView = z.infer<typeof mockBankView>;

/** A role in the picker, and whether it has enough multiple-choice questions for a timed test. */
export const mockRole = z.strictObject({ slug: z.string().regex(slug), title: z.string().min(1).max(120), hasTest: z.boolean() });
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

/** Everything /mock shows. `test` is the person's running test, if one is still within its 15 minutes. */
export const mockPageView = z.strictObject({
  elite: z.boolean(),
  role: mockRole,
  roles: z.array(mockRole).max(60),
  bank: mockBankView,
  test: timedTestView.nullable(),
});
export type MockPageView = z.infer<typeof mockPageView>;

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
