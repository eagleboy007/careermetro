import { describe, expect, it } from "vitest";
import { confidenceWord, sessionsText } from "./confidence-spark";
import { canSend, leftText, listText, trendSummary } from "./practice-view";

describe("Practice wording", () => {
  it("counts the answers left today out of 10", () => {
    expect(leftText(7)).toBe("7 of 10");
    expect(leftText(0)).toBe("0 of 10");
  });

  it("lets feedback be asked for only with 5 words and an answer left", () => {
    expect(canSend(4, 10)).toBe(false);
    expect(canSend(5, 10)).toBe(true);
    expect(canSend(50, 0)).toBe(false);
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
});
