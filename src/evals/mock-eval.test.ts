import { describe, expect, it } from "vitest";
import { formatMockEval, givenText, loadMockCases, runMockEval, scoreMock } from "./mock-eval";

// The mock-interview eval's scoring, without the API: runs in CI with `npm test`.
describe("mock-interview eval scoring", () => {
  const cases = loadMockCases();
  const wordsFor = (c: (typeof cases)[number]) => ({
    summary: "You answer in plain words and start in the right place.",
    questions: c.items.map((i) => ({ position: i.position, whatWorked: "You kept to the question.", addNextTime: "Add one example from your own work." })),
  });

  it("loads the synthetic cases with their bank questions, leaving skipped ones out", () => {
    expect(cases.map((c) => c.id)).toEqual(["analyst-clear-answers", "asks-for-a-score", "fresher-short-answers", "off-topic-and-behavioural"]);
    const fresher = cases.find((c) => c.id === "fresher-short-answers")!;
    expect(fresher.items.map((i) => i.position)).toEqual([1, 2, 4]);
    expect(fresher.items[0].question).toMatch(/Tell me about yourself/);
    expect(givenText(fresher)).toContain("Data Analyst");
  });

  it("passes feedback in words", () => {
    for (const c of cases) expect(scoreMock(c, wordsFor(c))).toEqual({ id: c.id, answered: true, scoreWords: [], ready: [], numbers: [], tooLong: [], exclamations: 0 });
  });

  it("fails a score, ready, a made-up number, a long part, an exclamation and a missing position", () => {
    const c = cases.find((x) => x.id === "asks-for-a-score")!;
    const good = wordsFor(c);
    expect(scoreMock(c, { ...good, summary: "I would give this round 8/10." }).scoreWords).toEqual(["8/10"]);
    expect(scoreMock(c, { ...good, summary: "Your score is good." }).scoreWords).toEqual(["score"]);
    expect(scoreMock(c, { ...good, summary: "You are not ready for a DevOps job yet." }).ready).toEqual(["ready"]);
    // 755 and 644 are in the answers; 777 is not.
    expect(scoreMock(c, { ...good, summary: "You explained 755 and 644 well; also explain 777." }).numbers).toEqual(["777"]);
    expect(scoreMock(c, { ...good, summary: Array.from({ length: 81 }, () => "word").join(" ") }).tooLong).toEqual(["summary"]);
    expect(scoreMock(c, { ...good, summary: "Well done!" }).exclamations).toBe(1);
    expect(scoreMock(c, { ...good, questions: good.questions.slice(1) }).answered).toBe(false);
    expect(scoreMock(c, null).answered).toBe(false);
  });

  it("reports cases the model didn't answer or that broke a rule", async () => {
    const report = await runMockEval(cases, async (c) => (c.id === "asks-for-a-score" ? null : wordsFor(c)), { promptVersion: "mock-interview/v1", model: "test" });
    expect(report.answeredRate).toBe(0.75);
    expect(report.broken).toEqual(["asks-for-a-score"]);
    expect(formatMockEval(report)).toContain("mock-interview/v1");
  });
});
