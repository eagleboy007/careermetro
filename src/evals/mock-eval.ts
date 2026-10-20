import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { mockQuestions, roleProfiles } from "@/content";
import { feedbackProblems } from "@/lib/mock/interview";
import { MOCK_ANSWER_MAX_CHARS, MOCK_MAX_QUESTIONS, type MockInterviewFeedback } from "@/lib/schemas";

/*
 * The mock-interview eval (FR-50 part 3): synthetic answers in fixtures/evals/mock, sent as one round each to the real
 * prompt by `npm run eval:mock` (never in CI). Scoring is pure and tested in CI without the API: the model must answer
 * every case, with feedback for each answered position, and never a number it wasn't given, a score word or shape,
 * anything saying ready or not ready, a part over its word cap, or an exclamation mark.
 */

/** One answered question as the model gets it (the shape of MockFeedbackItem in src/lib/mock/interview-feedback.ts). */
export type MockEvalItem = { position: number; topic: string; question: string; strongCovers: string; answer: string };
export type MockCase = { id: string; roleTitle: string; items: MockEvalItem[] };

const caseFile = z.strictObject({
  id: z.string().regex(/^[a-z0-9-]+$/),
  note: z.string().min(1),
  roleSlug: z.string().min(1),
  answers: z.array(z.strictObject({ questionId: z.string().min(1), answer: z.string().max(MOCK_ANSWER_MAX_CHARS) })).min(1).max(MOCK_MAX_QUESTIONS),
});

const byId = new Map(mockQuestions.map((q) => [q.id, q]));

/** The cases, each with its bank questions in order; an empty answer is a skipped question and isn't sent. */
export function loadMockCases(dir = path.join(process.cwd(), "fixtures/evals/mock")): MockCase[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => {
      const raw = caseFile.parse(JSON.parse(readFileSync(path.join(dir, f), "utf8")));
      const role = roleProfiles.find((r) => r.slug === raw.roleSlug);
      if (!role) throw new Error(`${f}: no role ${raw.roleSlug}`);
      const items = raw.answers.flatMap((a, i) => {
        const q = byId.get(a.questionId);
        if (q?.kind !== "open") throw new Error(`${f}: ${a.questionId} is not an open bank question`);
        return a.answer.trim() ? [{ position: i + 1, topic: q.topic, question: q.question, strongCovers: q.strongCovers, answer: a.answer.trim() }] : [];
      });
      return { id: raw.id, roleTitle: role.title, items };
    });
}

/** Everything the model was given, so a number it repeats from there doesn't count as made up. */
export const givenText = (c: MockCase): string => [c.roleTitle, ...c.items.flatMap((i) => [i.topic, i.question, i.strongCovers, i.answer])].join("\n");

export type MockCaseScore = {
  id: string;
  /** The model answered with output that passed the schema and covered every answered position. */
  answered: boolean;
  scoreWords: string[];
  ready: string[];
  numbers: string[];
  tooLong: string[];
  exclamations: number;
};

export function scoreMock(c: MockCase, reply: MockInterviewFeedback | null): MockCaseScore {
  if (!reply) return { id: c.id, answered: false, scoreWords: [], ready: [], numbers: [], tooLong: [], exclamations: 0 };
  const covered = reply.questions.map((q) => q.position).sort((a, b) => a - b).join() === c.items.map((i) => i.position).join();
  return { id: c.id, answered: covered, ...feedbackProblems(reply, givenText(c)) };
}

export type MockReport = { promptVersion: string; model: string; cases: MockCaseScore[]; answeredRate: number; broken: string[] };

/** The cases that break a rule: any score word, "ready", made-up number, long part or exclamation mark. */
const breaks = (s: MockCaseScore) => !s.answered || s.scoreWords.length + s.ready.length + s.numbers.length + s.tooLong.length + s.exclamations > 0;

export async function runMockEval(cases: MockCase[], feedback: (c: MockCase) => Promise<MockInterviewFeedback | null>, meta: { promptVersion: string; model: string }): Promise<MockReport> {
  const scores: MockCaseScore[] = [];
  for (const c of cases) scores.push(scoreMock(c, await feedback(c)));
  return {
    ...meta,
    cases: scores,
    answeredRate: scores.length ? scores.filter((s) => s.answered).length / scores.length : 0,
    broken: scores.filter(breaks).map((s) => s.id),
  };
}

export function formatMockEval(r: MockReport): string {
  const list = (xs: string[]) => xs.join(", ") || "none";
  const rows = r.cases.map(
    (c) => `| ${c.id} | ${c.answered ? "yes" : "no"} | ${list(c.scoreWords)} | ${list(c.ready)} | ${list(c.numbers)} | ${list(c.tooLong)} | ${c.exclamations} |`,
  );
  return [
    `## mock-interview eval (${r.promptVersion}, ${r.model})`,
    "",
    `Answered ${Math.round(r.answeredRate * 100)}% of cases; ${r.broken.length} broke a rule.`,
    "",
    "| Case | Answered | Score words | Ready | Made-up numbers | Too long | Exclamations |",
    "|---|---|---|---|---|---|---|",
    ...rows,
  ].join("\n");
}
