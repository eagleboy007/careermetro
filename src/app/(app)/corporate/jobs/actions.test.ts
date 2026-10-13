import { beforeEach, describe, expect, it, vi } from "vitest";

// Jobs' server actions: who is signed in, what reaches the store, and the words that come back.
const m = vi.hoisted(() => ({
  account: null as { id: string } | null,
  refresh: vi.fn(),
  store: { saveJob: vi.fn(), setJobStatus: vi.fn(), reportJob: vi.fn() },
  apps: { openCandidate: vi.fn(), moveApplication: vi.fn() },
}));
vi.mock("@/lib/corporate/applications-store", () => ({
  ...m.apps,
  APPLICATION_ERROR_TEXT: { not_allowed: "Only Recruiter admins, and Hiring HR on this job, can move candidates.", ai_off: "The L1 AI interview is off for this job." },
}));
vi.mock("next/cache", () => ({ refresh: m.refresh }));
vi.mock("@/lib/auth/server", () => ({ currentAccount: async () => m.account }));
vi.mock("@/lib/corporate/jobs-store", async () => {
  const { JOBS_BLOCKED_TEXT } = await import("@/lib/schemas/constants");
  return { ...m.store, JOB_ERROR_TEXT: { ...JOBS_BLOCKED_TEXT, not_allowed: "Only Recruiter admins, and Hiring HR on this job, can change it.", limit: "Too many." } };
});

import { moveApplicationAction, openCandidateAction, reportJobAction, saveJobAction, setJobStatusAction } from "./actions";

const ME = "0b8f8a52-6a1e-4b7f-9d6a-2f1d3c4b5a69";
const JOB = "1c9f8a52-6a1e-4b7f-9d6a-2f1d3c4b5a70";
const values = {
  jobId: null,
  status: "draft" as const,
  roleSlug: "cyber-security-analyst",
  title: "SOC Analyst L1",
  workType: "full_time" as const,
  city: "Pune",
  requirements: { required: ["siem"], oneOf: [], nice: [] },
  hiring: [],
  interviewers: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  m.account = { id: ME };
});

describe("jobs actions", () => {
  it("ask a signed-out visitor to sign in, and touch nothing", async () => {
    m.account = null;
    expect(await saveJobAction(values, null)).toEqual({ ok: false, error: "Please sign in again." });
    expect(await setJobStatusAction(JOB, "paused")).toBe("Please sign in again.");
    expect(await reportJobAction(JOB, "fake_or_spam", "")).toBe("Please sign in again.");
    for (const fn of Object.values(m.store)) expect(fn).not.toHaveBeenCalled();
  });

  it("pass the signed-in person's id and the raw form, with the ticks only when opening", async () => {
    m.store.saveJob.mockResolvedValue({ ok: true, jobId: JOB, status: "draft" });
    expect(await saveJobAction(values, null)).toEqual({ ok: true, jobId: JOB });
    expect(m.store.saveJob).toHaveBeenLastCalledWith(ME, expect.objectContaining({ jobId: undefined, roleSlug: "cyber-security-analyst" }));
    expect(m.store.saveJob.mock.lastCall![1]).not.toHaveProperty("open");
    const ticks = { real: true, noFee: true, fair: false };
    await saveJobAction({ ...values, jobId: JOB }, ticks);
    expect(m.store.saveJob).toHaveBeenLastCalledWith(ME, expect.objectContaining({ jobId: JOB, open: ticks }));
    // No refresh: the form goes back to Corporate itself.
    expect(m.refresh).not.toHaveBeenCalled();
  });

  it("say why a job can't open, in words", async () => {
    m.store.saveJob.mockResolvedValue({ ok: false, error: "pending" });
    const r = await saveJobAction(values, { real: true, noFee: true, fair: true });
    expect(r).toEqual({ ok: false, error: expect.stringMatching(/verified your company/) });
    m.store.saveJob.mockResolvedValue({ ok: false, error: "invalid", message: "Add the job title." });
    expect(await saveJobAction(values, null)).toEqual({ ok: false, error: "Add the job title." });
  });

  it("refresh Corporate after a status change, and not after a refusal", async () => {
    m.store.setJobStatus.mockResolvedValue({ ok: true });
    expect(await setJobStatusAction(JOB, "closed")).toBeNull();
    expect(m.store.setJobStatus).toHaveBeenLastCalledWith(ME, { jobId: JOB, to: "closed" });
    expect(m.refresh).toHaveBeenCalledTimes(1);
    m.store.setJobStatus.mockResolvedValue({ ok: false, error: "not_allowed" });
    expect(await setJobStatusAction(JOB, "closed")).toMatch(/Only Recruiter admins/);
    expect(m.refresh).toHaveBeenCalledTimes(1);
  });

  it("file a report with the reason and note", async () => {
    m.store.reportJob.mockResolvedValue({ ok: true });
    expect(await reportJobAction(JOB, "money_or_otp", "Asked for a deposit")).toBeNull();
    expect(m.store.reportJob).toHaveBeenLastCalledWith(ME, { jobId: JOB, reason: "money_or_otp", note: "Asked for a deposit" });
    m.store.reportJob.mockResolvedValue({ ok: false, error: "limit" });
    expect(await reportJobAction(JOB, "other", "")).toBe("Too many.");
  });

  it("open a candidate and move them, with the note, refreshing the board only after a move", async () => {
    m.account = null;
    expect(await openCandidateAction("a")).toEqual({ ok: false, error: "Please sign in again." });
    expect(await moveApplicationAction("a", "shortlisted", "")).toBe("Please sign in again.");
    expect(m.apps.openCandidate).not.toHaveBeenCalled();
    m.account = { id: ME };
    m.apps.openCandidate.mockResolvedValue({ ok: true, candidate: { applicationId: "a" } });
    expect(await openCandidateAction("a")).toEqual({ ok: true, candidate: { applicationId: "a" } });
    expect(m.apps.openCandidate).toHaveBeenLastCalledWith(ME, { applicationId: "a" });
    m.apps.moveApplication.mockResolvedValue({ ok: true });
    expect(await moveApplicationAction("a", "not_this_time", "We need SIEM.")).toBeNull();
    expect(m.apps.moveApplication).toHaveBeenLastCalledWith(ME, { applicationId: "a", to: "not_this_time", note: "We need SIEM." });
    expect(m.refresh).toHaveBeenCalledTimes(1);
    m.apps.moveApplication.mockResolvedValue({ ok: false, error: "ai_off" });
    expect(await moveApplicationAction("a", "ai", "")).toMatch(/L1 AI interview is off/);
    m.apps.openCandidate.mockResolvedValue({ ok: false, error: "not_allowed" });
    expect(await openCandidateAction("a")).toEqual({ ok: false, error: expect.stringMatching(/Only Recruiter admins/) });
    expect(m.refresh).toHaveBeenCalledTimes(1);
  });
});
