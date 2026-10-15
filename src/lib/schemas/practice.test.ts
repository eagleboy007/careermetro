import { describe, expect, it } from "vitest";
import {
  countWords,
  practiceAnswerInput,
  practiceFeedback,
  practiceQuestion,
  practiceRateInput,
  practiceTrend,
  practiceView,
  type PracticeSkill,
} from "./practice";

const question = { id: "python-1", skillId: "python", question: "What is a list comprehension?", lookFor: "A short example and when not to use one.", level: "L1" };
const skill: PracticeSkill = {
  skillId: "python",
  name: "Python",
  tag: "current",
  questions: [{ id: "python-1", question: question.question, lookFor: question.lookFor }],
  ratings: [1, 2],
};

describe("practice question", () => {
  it("takes a bank entry whose id is its skill and a number", () => {
    expect(practiceQuestion.parse(question)).toEqual(question);
    for (const id of ["sql-1", "python", "python-0", "python-x", "Python-1"]) expect(practiceQuestion.safeParse({ ...question, id }).success).toBe(false);
  });

  it("is L1 only and refuses extra fields such as an answer key", () => {
    expect(practiceQuestion.safeParse({ ...question, level: "L2" }).success).toBe(false);
    expect(practiceQuestion.safeParse({ ...question, answer: "x" }).success).toBe(false);
  });
});

describe("practice answer", () => {
  it("counts words the way the answer box does", () => {
    expect(countWords("")).toBe(0);
    expect(countWords("   ")).toBe(0);
    expect(countWords(" one  two\nthree\tfour ")).toBe(4);
  });

  it("needs at least 5 words and at most 4,000 characters", () => {
    expect(practiceAnswerInput.safeParse({ questionId: "python-1", answer: "four words only here" }).success).toBe(false);
    expect(practiceAnswerInput.parse({ questionId: "python-1", answer: "  I would use a set here " }).answer).toBe("I would use a set here");
    expect(practiceAnswerInput.safeParse({ questionId: "python-1", answer: "word ".repeat(801) }).success).toBe(false);
    expect(practiceAnswerInput.safeParse({ questionId: "python-1", answer: "a b c d e", extra: 1 }).success).toBe(false);
  });

  it("rates 1 to 4 on an answer id", () => {
    const answerId = "00000000-0000-4000-8000-000000000001";
    for (const confidence of [1, 2, 3, 4]) expect(practiceRateInput.safeParse({ answerId, confidence }).success).toBe(true);
    for (const confidence of [0, 5, 2.5, "3"]) expect(practiceRateInput.safeParse({ answerId, confidence }).success).toBe(false);
    expect(practiceRateInput.safeParse({ answerId: "x", confidence: 2 }).success).toBe(false);
  });
});

describe("practice feedback (model output)", () => {
  const ok = { structure: "Clear order.", specificity: "Add one real example.", correctness: "Right idea.", strongerAnswer: "First I would..." };

  it("is words on three points and a stronger sample, with no score", () => {
    expect(practiceFeedback.parse(ok)).toEqual(ok);
    expect(practiceFeedback.safeParse({ ...ok, strongerAnswer: "" }).success).toBe(false);
    expect(practiceFeedback.safeParse({ ...ok, structure: "x".repeat(601) }).success).toBe(false);
    expect(practiceFeedback.safeParse({ structure: ok.structure, specificity: ok.specificity, strongerAnswer: ok.strongerAnswer }).success).toBe(false);
  });
});

describe("practice view and trend", () => {
  it("lists a skill once, with one current goal at most", () => {
    expect(practiceView.parse({ skills: [skill], left: 10, noQuestions: ["Statistics"] }).skills).toHaveLength(1);
    expect(practiceView.safeParse({ skills: [skill, skill], left: 10, noQuestions: [] }).success).toBe(false);
    expect(practiceView.safeParse({ skills: [skill, { ...skill, skillId: "sql" }], left: 10, noQuestions: [] }).success).toBe(false);
    expect(practiceView.safeParse({ skills: [], left: 11, noQuestions: [] }).success).toBe(false);
  });

  it("has a trend only for a rated skill", () => {
    expect(practiceTrend.safeParse({ skillId: "python", name: "Python", ratings: [] }).success).toBe(false);
    expect(practiceTrend.parse({ skillId: "python", name: "Python", ratings: [2, 3] }).ratings).toEqual([2, 3]);
  });
});
