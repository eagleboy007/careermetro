import { beforeEach, describe, expect, it, vi } from "vitest";

// Interviews' server actions: who is signed in, what reaches the store, and the words that come back.
const m = vi.hoisted(() => ({
  account: null as { id: string } | null,
  refresh: vi.fn(),
  ask: vi.fn(),
  schedule: vi.fn(),
  cancel: vi.fn(),
  feedback: vi.fn(),
}));
vi.mock("next/cache", () => ({ refresh: m.refresh }));
vi.mock("@/lib/auth/server", () => ({ currentAccount: async () => m.account }));
vi.mock("@/lib/corporate/interviews-store", () => ({
  askForTimes: m.ask,
  scheduleInterview: m.schedule,
  cancelInterview: m.cancel,
  submitFeedback: m.feedback,
  INTERVIEW_ERROR_TEXT: { read_only: "Interviewers see their candidates and write feedback.", busy: "One of the interviewers already has an interview then." },
}));

import { askTimesAction, cancelInterviewAction, feedbackAction, scheduleAction } from "./actions";

const ME = "0b8f8a52-6a1e-4b7f-9d6a-2f1d3c4b5a69";
const APP = "2d9f8a52-6a1e-4b7f-9d6a-2f1d3c4b5a71";
const IV = "3e9f8a52-6a1e-4b7f-9d6a-2f1d3c4b5a72";

beforeEach(() => {
  vi.clearAllMocks();
  m.account = { id: ME };
});

describe("interview actions", () => {
  it("ask a signed-out visitor to sign in and do nothing", async () => {
    m.account = null;
    expect(await askTimesAction(APP)).toBe("Please sign in again.");
    expect(await scheduleAction({ applicationId: APP, slotId: IV, minutes: 30, interviewers: [ME] })).toBe("Please sign in again.");
    expect(await cancelInterviewAction(IV)).toBe("Please sign in again.");
    expect(await feedbackAction(IV, "yes", "Clear on log triage and incident notes.")).toBe("Please sign in again.");
    for (const f of [m.ask, m.schedule, m.cancel, m.feedback]) expect(f).not.toHaveBeenCalled();
  });

  it("pass the signed-in person's id and the input, then refresh", async () => {
    for (const f of [m.ask, m.schedule, m.cancel, m.feedback]) f.mockResolvedValue({ ok: true });
    expect(await askTimesAction(APP)).toBeNull();
    expect(m.ask).toHaveBeenCalledWith(ME, { applicationId: APP });
    expect(await scheduleAction({ applicationId: APP, slotId: IV, minutes: 45, interviewers: [ME] })).toBeNull();
    expect(m.schedule).toHaveBeenCalledWith(ME, { applicationId: APP, slotId: IV, minutes: 45, interviewers: [ME], round: "team" });
    expect(await cancelInterviewAction(IV)).toBeNull();
    expect(m.cancel).toHaveBeenCalledWith(ME, { interviewId: IV });
    expect(await feedbackAction(IV, "not_sure", "Good on Linux, thin on cloud logs.")).toBeNull();
    expect(m.feedback).toHaveBeenCalledWith(ME, { interviewId: IV, recommendation: "not_sure", text: "Good on Linux, thin on cloud logs." });
    expect(m.refresh).toHaveBeenCalledTimes(4);
  });

  it("answer refusals in words, preferring the schema's own message, and don't refresh", async () => {
    m.ask.mockResolvedValue({ ok: false, error: "read_only" });
    expect(await askTimesAction(APP)).toBe("Interviewers see their candidates and write feedback.");
    m.feedback.mockResolvedValue({ ok: false, error: "invalid", message: "Write at least 20 characters." });
    expect(await feedbackAction(IV, "yes", "Good.")).toBe("Write at least 20 characters.");
    expect(m.refresh).not.toHaveBeenCalled();
  });
});
