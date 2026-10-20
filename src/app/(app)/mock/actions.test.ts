import { beforeEach, describe, expect, it, vi } from "vitest";

const account = vi.fn();
const start = vi.fn();
const pick = vi.fn();
const finish = vi.fn();
const log = vi.fn();
const startMock = vi.fn();
const saveAnswer = vi.fn();
const endMock = vi.fn();
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/server", () => ({ currentAccount: () => account() }));
vi.mock("@/lib/log", () => ({ logEvent: (...a: unknown[]) => log(...a), errorFields: () => ({}) }));
vi.mock("@/lib/mock/store", () => ({
  startTimedTest: (...a: unknown[]) => start(...a),
  pickTimedTest: (...a: unknown[]) => pick(...a),
  finishTimedTest: (...a: unknown[]) => finish(...a),
}));

vi.mock("@/lib/mock/interview-store", () => ({
  startMockInterview: (...a: unknown[]) => startMock(...a),
  saveMockAnswer: (...a: unknown[]) => saveAnswer(...a),
  endMockInterview: (...a: unknown[]) => endMock(...a),
}));

const { endMockInterviewAction, finishTimedTestAction, pickTimedTestAction, saveMockAnswerAction, startMockInterviewAction, startTimedTestAction } = await import("./actions");
const TEST = "6f1c2a9e-5b7d-4c3e-9a1b-2d3e4f5a6b7c";

describe("timed test actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    account.mockResolvedValue({ id: "u1", name: "Asha Example", email: "asha@example.com" });
  });

  it("does nothing for a signed-out person", async () => {
    account.mockResolvedValue(null);
    expect(await startTimedTestAction("data-analyst")).toEqual({ ok: false, message: "Please sign in again." });
    expect(await pickTimedTestAction(TEST, "sql-mc-1", 1)).toEqual({ ok: false, message: "Please sign in again.", over: false });
    expect(await finishTimedTestAction(TEST)).toEqual({ ok: false, message: "Please sign in again." });
    expect(start).not.toHaveBeenCalled();
    expect(pick).not.toHaveBeenCalled();
    expect(finish).not.toHaveBeenCalled();
  });

  it("acts for the signed-in person only, with what the screen sent", async () => {
    start.mockResolvedValueOnce({ ok: true, test: { id: TEST } });
    expect(await startTimedTestAction("data-analyst")).toEqual({ ok: true, test: { id: TEST } });
    expect(start).toHaveBeenCalledWith("u1", { roleSlug: "data-analyst" });
    pick.mockResolvedValueOnce({ ok: true });
    expect(await pickTimedTestAction(TEST, "sql-mc-1", 1)).toEqual({ ok: true });
    expect(pick).toHaveBeenCalledWith("u1", { testId: TEST, questionId: "sql-mc-1", pick: 1 });
    finish.mockResolvedValueOnce({ ok: true, review: { right: 3 } });
    expect(await finishTimedTestAction(TEST)).toEqual({ ok: true, review: { right: 3 } });
    expect(finish).toHaveBeenCalledWith("u1", { testId: TEST });
  });

  it("words each refusal, and says when the time is up", async () => {
    start.mockResolvedValueOnce({ ok: false, error: "not_elite" });
    expect(await startTimedTestAction("data-analyst")).toEqual({ ok: false, message: "Turn on Elite to use this." });
    start.mockResolvedValueOnce({ ok: false, error: "no_test" });
    expect(await startTimedTestAction("grc-manager")).toEqual({ ok: false, message: "Timed test for this role is coming." });
    pick.mockResolvedValueOnce({ ok: false, error: "over" });
    expect(await pickTimedTestAction(TEST, "sql-mc-1", 1)).toMatchObject({ ok: false, over: true });
    pick.mockResolvedValueOnce({ ok: false, error: "invalid" });
    expect(await pickTimedTestAction(TEST, "sql-mc-1", 1)).toMatchObject({ ok: false, over: false });
  });

  it("says so when something breaks, and logs no name or email", async () => {
    start.mockRejectedValueOnce(new Error("asha@example.com"));
    expect(await startTimedTestAction("data-analyst")).toEqual({ ok: false, message: "That didn't work. Please try again." });
    finish.mockRejectedValueOnce(new Error("asha@example.com"));
    expect(await finishTimedTestAction(TEST)).toEqual({ ok: false, message: "That didn't work. Please try again." });
    expect(JSON.stringify(log.mock.calls)).not.toContain("asha");
  });
});

describe("mock interview actions", () => {
  const SESSION = "00000000-0000-4000-8000-000000000038";
  beforeEach(() => {
    vi.clearAllMocks();
    account.mockResolvedValue({ id: "u1", name: "Asha Example", email: "asha@example.com" });
  });

  it("does nothing for a signed-out person", async () => {
    account.mockResolvedValue(null);
    expect(await startMockInterviewAction("data-analyst", "quick", "mix")).toEqual({ ok: false, message: "Please sign in again." });
    expect(await saveMockAnswerAction(SESSION, 1, "An answer")).toEqual({ ok: false, message: "Please sign in again.", over: false });
    expect(await endMockInterviewAction(SESSION, [])).toEqual({ ok: false, message: "Please sign in again." });
    expect(startMock).not.toHaveBeenCalled();
    expect(saveAnswer).not.toHaveBeenCalled();
    expect(endMock).not.toHaveBeenCalled();
  });

  it("acts for the signed-in person with what the screen sent, and words each refusal", async () => {
    startMock.mockResolvedValueOnce({ ok: true, session: { id: SESSION } });
    expect(await startMockInterviewAction("data-analyst", "full", "gaps")).toEqual({ ok: true, session: { id: SESSION } });
    expect(startMock).toHaveBeenCalledWith("u1", { roleSlug: "data-analyst", length: "full", focus: "gaps" });
    saveAnswer.mockResolvedValueOnce({ ok: false, error: "over" });
    expect(await saveMockAnswerAction(SESSION, 2, "An answer")).toMatchObject({ ok: false, over: true });
    expect(saveAnswer).toHaveBeenCalledWith("u1", { sessionId: SESSION, position: 2, answer: "An answer" });
    endMock.mockResolvedValueOnce({ ok: false, error: "not_elite" });
    expect(await endMockInterviewAction(SESSION, [{ position: 1, answer: "x" }])).toEqual({ ok: false, message: "Turn on Elite to use this." });
    expect(endMock).toHaveBeenCalledWith("u1", { sessionId: SESSION, answers: [{ position: 1, answer: "x" }] });
    startMock.mockResolvedValueOnce({ ok: false, error: "limit" });
    expect((await startMockInterviewAction("data-analyst", "quick", "mix")).ok).toBe(false);
  });

  it("says so when something breaks, and logs no answer, name or email", async () => {
    saveAnswer.mockRejectedValueOnce(new Error("my secret answer asha@example.com"));
    expect(await saveMockAnswerAction(SESSION, 1, "my secret answer")).toMatchObject({ ok: false, over: false });
    endMock.mockRejectedValueOnce(new Error("asha@example.com"));
    expect(await endMockInterviewAction(SESSION, [])).toEqual({ ok: false, message: "That didn't work. Please try again." });
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/asha|secret answer/);
  });
});
