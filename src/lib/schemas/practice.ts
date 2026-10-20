import { z } from "zod";
import { countWords } from "@/lib/practice/words";
import { PRACTICE_CONFIDENCE_WORDS, PRACTICE_DAILY_ANSWERS, PRACTICE_MAX_CHARS, PRACTICE_MIN_WORDS } from "./constants";
export { PRACTICE_CONFIDENCE_WORDS, PRACTICE_DAILY_ANSWERS, PRACTICE_KEEP_DAYS, PRACTICE_MAX_CHARS, PRACTICE_MIN_WORDS } from "./constants";

const slug = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);

export { countWords };

/**
 * One question of the practice bank (src/content/practice-questions.json, handoff 12h). Content, never written by the
 * model. `lookFor` is a guide for the person; nothing scores an answer against it. The id ("python-3") stays the same
 * when the wording is edited, so a saved answer keeps pointing at its question.
 */
export const practiceQuestion = z
  .strictObject({
    id: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*-[1-9][0-9]*$/),
    skillId: z.string().regex(slug),
    question: z.string().min(10).max(300),
    lookFor: z.string().min(10).max(300),
    level: z.literal("L1"),
  })
  .refine((q) => q.id.startsWith(`${q.skillId}-`) && /^[1-9][0-9]*$/.test(q.id.slice(q.skillId.length + 1)), { message: "the id is the skill id and a number" });

/** The self-rating after feedback: 1 Not yet, 2 A little, 3 Fairly, 4 Very. */
export const practiceConfidence = z.number().int().min(1).max(PRACTICE_CONFIDENCE_WORDS.length);

/** "Get feedback": a bank question and the person's answer, at least 5 words. */
export const practiceAnswerInput = z.strictObject({
  questionId: z.string().min(1).max(80),
  answer: z
    .string()
    .trim()
    .max(PRACTICE_MAX_CHARS)
    .refine((t) => countWords(t) >= PRACTICE_MIN_WORDS, { message: `at least ${PRACTICE_MIN_WORDS} words` }),
});

/** "How sure do you feel about this now?" on one of the person's own answers. */
export const practiceRateInput = z.strictObject({ answerId: uuid, confidence: practiceConfidence });

const point = z.string().min(1).max(600);

/**
 * What the practice-feedback prompt must return (prompts/practice-feedback/v1.md): feedback in words on structure,
 * specificity and correctness, and a stronger sample answer to learn from. No score or marks of any kind.
 */
export const practiceFeedback = z.object({
  structure: point,
  specificity: point,
  correctness: point,
  strongerAnswer: z.string().min(1).max(2000),
});

/** How a goal skill sits on the person's line: the goal the train is on, one ahead of it, or one already met. */
export const PRACTICE_TAGS = ["current", "ahead", "met"] as const;

/**
 * Ratings one skill can hold: answers are kept 30 days, and feedback calls stop at 20 a person a day
 * (PRACTICE_LIMITS.callsPerPersonPerDay), which bounds Elite too, since Elite has no cap of 10 (FR-50).
 */
const PRACTICE_RATINGS_MAX = 20 * 31;

/** One skill in the picker: a goal of the person's with questions in the bank, and their own ratings for it, oldest first. */
export const practiceSkill = z.strictObject({
  skillId: z.string().regex(slug),
  name: z.string().min(1).max(120),
  tag: z.enum(PRACTICE_TAGS),
  questions: z
    .array(z.strictObject({ id: z.string().min(1).max(80), question: z.string().min(1).max(300), lookFor: z.string().min(1).max(300) }))
    .min(1)
    .max(20),
  ratings: z.array(practiceConfidence).max(PRACTICE_RATINGS_MAX),
});

/** The Practice page: the picker's skills, the answers left today, and goals the bank has no questions for yet. */
export const practiceView = z
  .strictObject({
    skills: z.array(practiceSkill).max(60),
    /** Answers with feedback left today on Free; null on Elite, which has no daily cap (FR-50). */
    left: z.number().int().min(0).max(PRACTICE_DAILY_ANSWERS).nullable(),
    /** Names of the person's goals with no questions yet. */
    noQuestions: z.array(z.string().min(1).max(120)).max(60),
  })
  .refine((v) => new Set(v.skills.map((s) => s.skillId)).size === v.skills.length, { message: "a skill is listed once" })
  .refine((v) => v.skills.filter((s) => s.tag === "current").length <= 1, { message: "one current goal at most" });

/** "Practice confidence" on Me: one row per skill the person has rated, ratings oldest first. Private to them. */
export const practiceTrend = z.strictObject({
  skillId: z.string().regex(slug),
  name: z.string().min(1).max(120),
  ratings: z.array(practiceConfidence).min(1).max(PRACTICE_RATINGS_MAX),
});

/** What "Get feedback" answers. `feedback` null: saved, but feedback isn't available now, and it used no daily answer. */
export type PracticeAnswerResult =
  | { ok: true; answerId: string; feedback: PracticeFeedback | null; left: number | null }
  | { ok: false; message: string; left?: number };
export type PracticeRateResult = { ok: true } | { ok: false; message: string };

export type PracticeQuestion = z.infer<typeof practiceQuestion>;
export type PracticeAnswerInput = z.infer<typeof practiceAnswerInput>;
export type PracticeRateInput = z.infer<typeof practiceRateInput>;
export type PracticeFeedback = z.infer<typeof practiceFeedback>;
export type PracticeTag = (typeof PRACTICE_TAGS)[number];
export type PracticeSkill = z.infer<typeof practiceSkill>;
export type PracticeView = z.infer<typeof practiceView>;
export type PracticeTrend = z.infer<typeof practiceTrend>;
