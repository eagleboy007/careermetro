import { describe, expect, it } from "vitest";
import { confidenceWord, sessionsText } from "./confidence-spark";
import { canSend, leftText, listText, startAt, trendSummary } from "./practice-view";

describe("Practice wording", () => {
  it("counts the answers left today out of 10, and none on Elite", () => {
    expect(leftText(7)).toBe("7 of 10 answers left today");
    expect(leftText(0)).toBe("0 of 10 answers left today");
    expect(leftText(null)).toBe("No daily cap with Elite");
  });

  it("lets feedback be asked for only with 5 words and an answer left", () => {
    expect(canSend(4, 10)).toBe(false);
    expect(canSend(5, 10)).toBe(true);
    expect(canSend(50, 0)).toBe(false);
    expect(canSend(5, null)).toBe(true);
    expect(canSend(4, null)).toBe(false);
  });

  it("names the four ratings and the sessions, never as a score", () => {
    expect([1, 2, 3, 4].map(confidenceWord)).toEqual(["Not yet", "A little", "Fairly", "Very"]);
    expect(sessionsText(1)).toBe("1 session");
    expect(sessionsText(4)).toBe("4 sessions");
    expect(trendSummary([1, 2, 3])).toBe('Last 3 sessions: from "Not yet" to "Fairly". Your own rating, not a score.');
    expect(trendSummary([])).toBe("");
  });

  it("lists skills with no questions in plain words", () => {
    expect(listText(["Statistics"])).toBe("Statistics");
    expect(listText(["Statistics", "Excel"])).toBe("Statistics and Excel");
    expect(listText(["A", "B", "C"])).toBe("A, B and C");
  });

  it("opens on the question asked for from the interview prep bank, else the current goal's first", () => {
    const q = (id: string) => ({ id, question: `Question ${id}`, lookFor: "What to look for" });
    const skills = [
      { tag: "met" as const, questions: [q("sql-1"), q("sql-2")] },
      { tag: "current" as const, questions: [q("excel-1"), q("excel-2"), q("excel-3")] },
    ];
    expect(startAt(skills, "excel-3")).toEqual({ skill: 1, question: 2 });
    expect(startAt(skills, "sql-2")).toEqual({ skill: 0, question: 1 });
    expect(startAt(skills, "python-1")).toEqual({ skill: 1, question: 0 });
    expect(startAt(skills, null)).toEqual({ skill: 1, question: 0 });
    expect(startAt([{ tag: "ahead" as const, questions: [q("git-1")] }], null)).toEqual({ skill: 0, question: 0 });
    // Set to one job, it opens on the job's first skill, its first still-open goal.
    expect(startAt(skills, null, true)).toEqual({ skill: 0, question: 0 });
    expect(startAt(skills, "excel-2", true)).toEqual({ skill: 1, question: 1 });
  });
});
