import { beforeEach, describe, expect, it, vi } from "vitest";

// The candidate's application actions: who is signed in, what reaches the store, and the words that come back.
const m = vi.hoisted(() => ({
  account: null as { id: string } | null,
  refresh: vi.fn(),
  store: { applyToJob: vi.fn(), withdrawApplication: vi.fn() },
  interviews: { respondToInterview: vi.fn(), stopSharingPhone: vi.fn() },
}));
vi.mock("next/cache", () => ({ refresh: m.refresh }));
vi.mock("@/lib/auth/server", () => ({ currentAccount: async () => m.account }));
vi.mock("@/lib/corporate/applications-store", () => ({
  ...m.store,
  APPLICATION_ERROR_TEXT: { not_open: "This job isn't taking applications now.", already: "Already applied.", not_found: "Gone." },
}));

vi.mock("@/lib/corporate/interviews-store", () => ({
  ...m.interviews,
  INTERVIEW_ERROR_TEXT: { paused: "This company's interviews are paused while we review it.", answered: "This has already been answered." },
}));

import { applyAction, respondAction, stopSharingAction, withdrawAction } from "./actions";

const ME = "0b8f8a52-6a1e-4b7f-9d6a-2f1d3c4b5a69";
const JOB = "1c9f8a52-6a1e-4b7f-9d6a-2f1d3c4b5a70";

beforeEach(() => {
  vi.clearAllMocks();
  m.account = { id: ME };
});

describe("application actions", () => {
  it("ask a signed-out visitor to sign in, and touch nothing", async () => {
    m.account = null;
    expect(await applyAction(JOB, "30", true)).toBe("Please sign in again.");
    expect(await withdrawAction(JOB)).toBe("Please sign in again.");
    for (const fn of Object.values(m.store)) expect(fn).not.toHaveBeenCalled();
  });

  it("apply with the signed-in person's id and the consent as given, and reload on success only", async () => {
    m.store.applyToJob.mockResolvedValue({ ok: true, applicationId: "a" });
    expect(await applyAction(JOB, "now", true)).toBeNull();
    expect(m.store.applyToJob).toHaveBeenLastCalledWith(ME, { jobId: JOB, canJoin: "now", consent: true });
    expect(m.refresh).toHaveBeenCalledTimes(1);
    m.store.applyToJob.mockResolvedValue({ ok: false, error: "invalid", message: "Tick the box to share these with the company." });
    expect(await applyAction(JOB, "now", false)).toMatch(/Tick the box/);
    m.store.applyToJob.mockResolvedValue({ ok: false, error: "not_open" });
    expect(await applyAction(JOB, "now", true)).toMatch(/isn't taking applications/);
    expect(m.refresh).toHaveBeenCalledTimes(1);
  });

  it("withdraw the person's own application", async () => {
    m.store.withdrawApplication.mockResolvedValue({ ok: true });
    expect(await withdrawAction("app-1")).toBeNull();
    expect(m.store.withdrawApplication).toHaveBeenLastCalledWith(ME, { applicationId: "app-1" });
    m.store.withdrawApplication.mockResolvedValue({ ok: false, error: "not_found" });
    expect(await withdrawAction("app-1")).toBe("Gone.");
  });

  it("send a phone only when the person chose to share it, and answer refusals in words", async () => {
    const IV = "3e9f8a52-6a1e-4b7f-9d6a-2f1d3c4b5a72";
    m.interviews.respondToInterview.mockResolvedValue({ ok: true });
    expect(await respondAction({ interviewId: IV, answer: "accept", sharePhone: false, phone: "98765 43210" })).toBeNull();
    expect(m.interviews.respondToInterview).toHaveBeenLastCalledWith(ME, { interviewId: IV, answer: "accept", sharePhone: false });
    expect(await respondAction({ interviewId: IV, answer: "accept", sharePhone: true, phone: "98765 43210" })).toBeNull();
    expect(m.interviews.respondToInterview).toHaveBeenLastCalledWith(ME, { interviewId: IV, answer: "accept", sharePhone: true, phone: "98765 43210" });
    expect(await respondAction({ interviewId: IV, answer: "decline", sharePhone: true, phone: "98765 43210" })).toBeNull();
    expect(m.interviews.respondToInterview).toHaveBeenLastCalledWith(ME, { interviewId: IV, answer: "decline" });
    m.interviews.respondToInterview.mockResolvedValue({ ok: false, error: "paused" });
    expect(await respondAction({ interviewId: IV, answer: "accept", sharePhone: false, phone: "" })).toBe("This company's interviews are paused while we review it.");
    m.interviews.stopSharingPhone.mockResolvedValue({ ok: true });
    expect(await stopSharingAction(JOB)).toBeNull();
    expect(m.interviews.stopSharingPhone).toHaveBeenCalledWith(ME, { applicationId: JOB });
    m.account = null;
    expect(await stopSharingAction(JOB)).toBe("Please sign in again.");
  });
});
