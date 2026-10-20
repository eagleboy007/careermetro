import { describe, expect, it } from "vitest";
import {
  MOCK_BANK_FREE_OPEN,
  mockBankFile,
  mockBankItem,
  mockQuestion,
  mockTab,
  TIMED_TEST_MINUTES,
  TIMED_TEST_QUESTIONS,
  TIMED_TESTS_PER_DAY,
  timedTestFinishInput,
  timedTestPickInput,
  timedTestStartInput,
  timedTestView,
} from "./index";

const open = { id: "sql-1", kind: "open", roleSlugs: ["data-analyst"], skillId: "sql", topic: "SQL", question: "Explain a join.", strongCovers: "Inner and left joins.", level: "L1" };
const choice = {
  id: "sql-mc-1",
  kind: "choice",
  roleSlugs: ["data-analyst"],
  skillId: "sql",
  topic: "SQL",
  question: "Which clause filters groups?",
  options: ["WHERE", "HAVING", "LIMIT"],
  answer: 1,
  explanation: "HAVING filters groups.",
  level: "L1",
  reviewed: false,
};
const TEST = "6f1c2a9e-5b7d-4c3e-9a1b-2d3e4f5a6b7c";

describe("interview prep schemas (FR-50 part 2)", () => {
  it("reads open and multiple-choice questions, and nothing else", () => {
    expect(mockQuestion.parse(open)).toEqual(open);
    expect(mockQuestion.parse(choice)).toEqual(choice);
    expect(mockQuestion.safeParse({ ...open, kind: "essay" }).success).toBe(false);
    expect(mockQuestion.safeParse({ ...open, options: ["a", "b"] }).success).toBe(false);
    expect(mockQuestion.safeParse({ ...choice, reviewed: undefined }).success).toBe(false);
    expect(mockQuestion.safeParse({ ...open, roleSlugs: [] }).success).toBe(false);
  });

  it("needs the answer to be one of the options, and options that differ", () => {
    expect(mockQuestion.safeParse({ ...choice, answer: 3 }).success).toBe(false);
    expect(mockQuestion.safeParse({ ...choice, options: ["WHERE", "WHERE"], answer: 0 }).success).toBe(false);
    expect(mockQuestion.safeParse({ ...choice, options: ["WHERE"], answer: 0 }).success).toBe(false);
  });

  it("refuses a bank with two questions of one id", () => {
    expect(mockBankFile.safeParse({ note: "n", questions: [open, choice] }).success).toBe(true);
    expect(mockBankFile.safeParse({ note: "n", questions: [open, open] }).success).toBe(false);
  });

  it("sends a locked bank question without its note or Practise link", () => {
    expect(mockBankItem.safeParse({ open: false, id: "sql-1", topic: "SQL", question: "Explain a join." }).success).toBe(true);
    expect(mockBankItem.safeParse({ open: false, id: "sql-1", topic: "SQL", question: "Explain a join.", strongCovers: "x y z" }).success).toBe(false);
    expect(mockBankItem.safeParse({ open: true, id: "sql-1", topic: "SQL", question: "Explain a join.", strongCovers: "Inner joins.", practiceHref: "/practice?q=sql-1" }).success).toBe(true);
  });

  it("takes only a test of its own shape from the screen", () => {
    expect(timedTestStartInput.safeParse({ roleSlug: "data-analyst" }).success).toBe(true);
    expect(timedTestStartInput.safeParse({ roleSlug: "Data Analyst" }).success).toBe(false);
    expect(timedTestPickInput.safeParse({ testId: TEST, questionId: "sql-mc-1", pick: 2 }).success).toBe(true);
    expect(timedTestPickInput.safeParse({ testId: TEST, questionId: "sql-mc-1", pick: 5 }).success).toBe(false);
    expect(timedTestPickInput.safeParse({ testId: TEST, questionId: "sql-mc-1", pick: -1 }).success).toBe(false);
    expect(timedTestPickInput.safeParse({ testId: "x", questionId: "sql-mc-1", pick: 1 }).success).toBe(false);
    expect(timedTestFinishInput.safeParse({ testId: TEST, right: 12 }).success).toBe(false);
    expect(mockTab.safeParse("bank").success).toBe(true);
    expect(mockTab.safeParse("score").success).toBe(false);
  });

  it("never sends the answers with a running test", () => {
    const q = { id: "sql-mc-1", topic: "SQL", question: "Which clause filters groups?", options: ["WHERE", "HAVING"] };
    const view = { id: TEST, roleTitle: "Data Analyst", questions: Array(12).fill(q), picks: Array(12).fill(null), secondsLeft: 900 };
    expect(timedTestView.safeParse(view).success).toBe(true);
    expect(timedTestView.safeParse({ ...view, questions: [{ ...q, answer: 1 }, ...Array(11).fill(q)] }).success).toBe(false);
    expect(timedTestView.safeParse({ ...view, picks: Array(11).fill(null) }).success).toBe(false);
  });

  it("keeps the numbers 12l sets", () => {
    expect([TIMED_TEST_QUESTIONS, TIMED_TEST_MINUTES, MOCK_BANK_FREE_OPEN, TIMED_TESTS_PER_DAY]).toEqual([12, 15, 5, 10]);
  });
});
