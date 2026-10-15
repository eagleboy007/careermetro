import { beforeEach, describe, expect, it, vi } from "vitest";

const account = vi.fn();
const submit = vi.fn();
const rate = vi.fn();
const log = vi.fn();
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/server", () => ({ currentAccount: () => account() }));
vi.mock("@/lib/practice/store", () => ({ submitPracticeAnswer: (...a: unknown[]) => submit(...a), ratePracticeAnswer: (...a: unknown[]) => rate(...a) }));
vi.mock("@/lib/log", () => ({ logEvent: (...a: unknown[]) => log(...a), errorFields: () => ({}) }));

const { ratePracticeAction, submitPracticeAction } = await import("./actions");
const ANSWER = "Meera would explain that a tuple is fixed once it is made.";
const answerId = "00000000-0000-4000-8000-0000000a0001";

describe("practice actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    account.mockResolvedValue({ id: "u1" });
  });

  it("does nothing for a signed-out person", async () => {
    account.mockResolvedValue(null);
    expect((await submitPracticeAction("python-1", ANSWER)).ok).toBe(false);
    expect((await ratePracticeAction(answerId, 3)).ok).toBe(false);
    expect(submit).not.toHaveBeenCalled();
    expect(rate).not.toHaveBeenCalled();
  });

  it("passes the person's own id and the input to the store", async () => {
    submit.mockResolvedValueOnce({ ok: true, answerId, feedback: null, left: 10 });
    expect(await submitPracticeAction("python-1", ANSWER)).toEqual({ ok: true, answerId, feedback: null, left: 10 });
    expect(submit).toHaveBeenCalledWith("u1", { questionId: "python-1", answer: ANSWER });
    rate.mockResolvedValueOnce({ ok: true });
    expect(await ratePracticeAction(answerId, 3)).toEqual({ ok: true });
    expect(rate).toHaveBeenCalledWith("u1", { answerId, confidence: 3 });
  });

  it("says so when something breaks, and never logs the answer", async () => {
    submit.mockRejectedValueOnce(new Error(`insert failed: ${ANSWER}`));
    expect((await submitPracticeAction("python-1", ANSWER)).ok).toBe(false);
    rate.mockRejectedValueOnce(new Error("boom"));
    expect((await ratePracticeAction(answerId, 3)).ok).toBe(false);
    expect(log).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(log.mock.calls)).not.toContain("Meera");
  });
});
