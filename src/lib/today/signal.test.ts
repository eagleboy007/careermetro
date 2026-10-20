import { describe, expect, it } from "vitest";
import { mockQuestions } from "@/content";
import type { SignalGoal } from "@/lib/ride/build";
import { signalLive, type MockChoiceQuestion, type MockQuestion } from "@/lib/schemas";
import { isSignalKey, pickSignal, signalAnswerOf, signalLiveOf, signalPool } from "./signal";

const choice = (id: string, skillId: string, p: Partial<MockChoiceQuestion> = {}): MockChoiceQuestion => ({
  id,
  kind: "choice",
  roleSlugs: ["data-analyst"],
  skillId,
  topic: "Topic",
  question: `Which one is right for ${id}?`,
  options: ["One", "Two", "Three", "Four"],
  answer: 1,
  explanation: `Two is right for ${id}.`,
  level: "L1",
  reviewed: true,
  ...p,
});
const bank: MockQuestion[] = [
  choice("sql-1", "sql"),
  choice("sql-2", "sql"),
  choice("sql-3", "sql"),
  choice("sql-draft", "sql", { reviewed: false }),
  choice("sql-five", "sql", { options: ["A", "B", "C", "D", "E"], answer: 4 }),
  choice("sql-long", "sql", { options: ["x".repeat(121), "y"], answer: 0 }),
  choice("py-1", "python"),
];
const goal = (skillId: string, p: Partial<SignalGoal> = {}): SignalGoal => ({
  goalId: `g-${skillId}`,
  skillId,
  learnSkillId: skillId,
  name: skillId.toUpperCase(),
  status: "missing",
  provePitstop: 2,
  ...p,
});

describe("signalPool", () => {
  it("takes reviewed multiple-choice questions for the skill that fit the card", () => {
    expect(signalPool(bank, "sql", false).map((q) => q.id)).toEqual(["sql-1", "sql-2", "sql-3"]);
    // Unreviewed questions only on local and preview deployments.
    expect(signalPool(bank, "sql", true).map((q) => q.id)).toEqual(["sql-1", "sql-2", "sql-3", "sql-draft"]);
    expect(signalPool(bank, "excel", true)).toEqual([]);
  });

  it("never takes an open question", () => {
    const open = mockQuestions.find((q) => q.kind === "open")!;
    expect(signalPool([open], open.skillId, true)).toEqual([]);
  });

  it("finds questions the real bank can show, every one valid on the card", () => {
    const skills = [...new Set(mockQuestions.filter((q) => q.kind === "choice").map((q) => q.skillId))];
    expect(skills.length).toBeGreaterThan(0);
    for (const skillId of skills) {
      for (const q of signalPool(mockQuestions, skillId, true)) {
        expect(signalLive.safeParse(signalLiveOf({ question: q, goal: goal(skillId) }, true)).success).toBe(true);
      }
    }
  });
});

describe("pickSignal", () => {
  it("keeps one question all day and changes it on other days, for each person", () => {
    const pick = (user: string, day: string) => pickSignal(bank, [goal("sql")], user, day, false)!.question.id;
    expect(pick("u1", "2026-10-20")).toBe(pick("u1", "2026-10-20"));
    const days = Array.from({ length: 10 }, (_, i) => `2026-10-${String(10 + i).padStart(2, "0")}`);
    expect(new Set(days.map((d) => pick("u1", d))).size).toBeGreaterThan(1);
    expect(new Set(["u1", "u2", "u3", "u4", "u5", "u6"].map((u) => pick(u, "2026-10-20"))).size).toBeGreaterThan(1);
  });

  it("asks about the next goal when today's has no question, and asks nothing when neither has one", () => {
    expect(pickSignal(bank, [goal("excel"), goal("python")], "u1", "2026-10-20", false)).toMatchObject({ question: { id: "py-1" }, goal: { skillId: "python" } });
    expect(pickSignal(bank, [goal("excel"), goal("docker"), goal("python")], "u1", "2026-10-20", false)).toBeNull();
    expect(pickSignal(bank, [], "u1", "2026-10-20", false)).toBeNull();
  });

  it("asks about the skill a swapped goal learns", () => {
    expect(pickSignal(bank, [goal("r-lang", { learnSkillId: "python" })], "u1", "2026-10-20", false)?.question.id).toBe("py-1");
  });
});

describe("signalLiveOf", () => {
  const q = choice("sql-1", "sql");
  const g = goal("sql", { name: "SQL", status: "weak", provePitstop: 6 });

  it("sends the question without the answer until it is answered", () => {
    const live = signalLiveOf({ question: q, goal: g }, false);
    expect(live).toEqual({
      id: "sql-1",
      shown: {
        skillName: "SQL",
        status: "weak",
        question: q.question,
        options: [
          { key: "A", label: "One" },
          { key: "B", label: "Two" },
          { key: "C", label: "Three" },
          { key: "D", label: "Four" },
        ],
        from: "From your SQL goal · warms you up for Pitstop 6",
      },
      answer: null,
    });
    expect(JSON.stringify(live)).not.toContain(q.explanation);
    expect(signalLiveOf({ question: q, goal: g }, true).answer).toEqual({ correctKey: "B", explanation: q.explanation });
  });

  it("checks keys against the question's options", () => {
    const two = choice("two", "sql", { options: ["Yes", "No"], answer: 0 });
    expect(isSignalKey(two, "A")).toBe(true);
    expect(isSignalKey(two, "B")).toBe(true);
    expect(isSignalKey(two, "C")).toBe(false);
    expect(isSignalKey(two, "a")).toBe(false);
    expect(isSignalKey(two, 1)).toBe(false);
    expect(signalAnswerOf(two)).toEqual({ correctKey: "A", explanation: two.explanation });
  });
});
