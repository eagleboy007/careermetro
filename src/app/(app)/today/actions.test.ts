import { beforeEach, describe, expect, it, vi } from "vitest";

const account = vi.fn();
const submit = vi.fn();
const take = vi.fn();
const refresh = vi.fn();
const log = vi.fn();
const credly = vi.fn();
const answer = vi.fn();
const track = vi.fn();
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ refresh: () => refresh() }));
vi.mock("@/lib/auth/server", () => ({ currentAccount: () => account() }));
vi.mock("@/lib/goals/store", () => ({ submitCertificate: (...a: unknown[]) => submit(...a) }));
vi.mock("@/lib/shared-limit", () => ({ LIMITS: { certificateTriesPerUser: {}, signalAnswersPerUserDay: {} }, takeShared: () => take() }));
vi.mock("@/lib/account/store", () => ({ setWeeklyHours: vi.fn() }));
vi.mock("@/lib/ride/store", () => ({ tickTask: vi.fn(), answerSignal: (...a: unknown[]) => answer(...a) }));
vi.mock("@/lib/tracks/store", () => ({
  setTrack: (...a: unknown[]) => track(...a),
  TRACK_MESSAGES: { invalid: "That didn't work. Please refresh the page and try again.", limit: "That's as many track changes as we allow in a day. Try again tomorrow." },
}));
vi.mock("@/lib/proofs/credly-store", () => ({ checkCertificateWithCredly: (...a: unknown[]) => credly(...a) }));
vi.mock("@/lib/log", () => ({ logEvent: (...a: unknown[]) => log(...a), errorFields: () => ({}) }));

const { addCertificate, answerSignalCheck, chooseTrack } = await import("./actions");

const good = {
  goalId: "7d1c2f9e-3a4b-4c5d-8e6f-0a1b2c3d4e5f",
  certId: "aws-cloud-practitioner",
  credentialId: "SECRET-CRED-ID",
  issuedOn: "2025-03-01",
  expiresOn: null,
  nameOnCertificate: "Priya Sharma",
  url: "https://www.credly.com/badges/c4ed1100-0000-4000-8000-000000000001",
  confirmed: true,
};

describe("addCertificate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    account.mockResolvedValue({ id: "u1" });
    take.mockResolvedValue(true);
  });

  it("asks a signed-out person to sign in, and saves nothing", async () => {
    account.mockResolvedValue(null);
    expect((await addCertificate(good)).status).toBe("refused");
    expect(submit).not.toHaveBeenCalled();
  });

  it("names the first wrong field in plain words", async () => {
    expect(await addCertificate({ ...good, confirmed: false })).toEqual({ status: "invalid", message: "Tick the box to say this certificate is yours.", field: "confirmed" });
    expect(await addCertificate({ ...good, url: "http://www.credly.com/badges/abc" })).toMatchObject({ status: "invalid", message: expect.stringMatching(/verify link/) });
    expect(submit).not.toHaveBeenCalled();
  });

  it("stops after the daily tries", async () => {
    take.mockResolvedValue(false);
    expect((await addCertificate(good)).status).toBe("refused");
    expect(submit).not.toHaveBeenCalled();
  });

  it("fills, holds or refuses, and never logs the credential id or the name", async () => {
    submit.mockResolvedValueOnce({ status: "pending", skillId: "aws", proofId: "p1" });
    credly.mockResolvedValueOnce({ status: "verified" });
    expect(await addCertificate(good)).toEqual({ status: "filled", label: "verified" });
    expect(credly).toHaveBeenCalledWith("u1", "p1");
    expect(refresh).toHaveBeenCalledTimes(1);
    submit.mockResolvedValueOnce({ status: "held", skillId: "aws", reason: "credential" });
    expect(await addCertificate(good)).toEqual({ status: "held", message: expect.stringMatching(/^This certificate is already on another account/) });
    submit.mockResolvedValueOnce({ status: "held", skillId: "aws", reason: "badge" });
    expect(await addCertificate(good)).toEqual({ status: "held", message: expect.stringMatching(/^This Credly badge is already on another account/) });
    submit.mockResolvedValueOnce({ status: "refused", reason: "name" });
    expect(await addCertificate(good)).toMatchObject({ status: "refused", message: expect.stringMatching(/doesn't match your account/) });
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/SECRET-CRED-ID|Priya/);
  });

  it("checks a Credly link after saving; only Credly's match fills the goal (T48)", async () => {
    // Another earner's name on Credly is refused like a typed name mismatch.
    submit.mockResolvedValueOnce({ status: "pending", skillId: "aws", proofId: "p1" });
    credly.mockResolvedValueOnce({ status: "rejected", reason: "name" });
    expect(await addCertificate(good)).toEqual({ status: "refused", message: expect.stringMatching(/doesn't match your account/) });
    // Over the check limit, or Credly not confirming it: saved, check pending, and the goal isn't proved.
    submit.mockResolvedValueOnce({ status: "pending", skillId: "aws", proofId: "p1" });
    credly.mockResolvedValueOnce({ status: "refused", reason: "too_many" });
    expect(await addCertificate(good)).toEqual({ status: "saved", message: expect.stringMatching(/check pending.*tomorrow/) });
    submit.mockResolvedValueOnce({ status: "pending", skillId: "aws", proofId: "p1" });
    credly.mockResolvedValueOnce({ status: "pending", note: "badge_name" });
    expect(await addCertificate(good)).toEqual({ status: "saved", message: expect.stringMatching(/check pending.*different certificate/) });
    // Expired on Credly: saved, and the goal moves to Renew.
    submit.mockResolvedValueOnce({ status: "pending", skillId: "aws", proofId: "p1" });
    credly.mockResolvedValueOnce({ status: "added", note: "expired" });
    expect(await addCertificate(good)).toEqual({ status: "saved", message: expect.stringMatching(/Renew/) });
    // Credly not answering about an older accepted row of the same credential: this goal's row still waits.
    submit.mockResolvedValueOnce({ status: "pending", skillId: "aws", proofId: "p1" });
    credly.mockResolvedValueOnce({ status: "added", note: "unreachable" });
    expect(await addCertificate(good)).toEqual({ status: "saved", message: expect.stringMatching(/check pending.*Credly didn't answer/) });
    // A badge already on another account is held for review.
    submit.mockResolvedValueOnce({ status: "pending", skillId: "aws", proofId: "p1" });
    credly.mockResolvedValueOnce({ status: "held" });
    expect(await addCertificate(good)).toEqual({ status: "held", message: expect.stringMatching(/review it/) });
  });

  it("doesn't check other links, and a failed check leaves the badge pending", async () => {
    submit.mockResolvedValueOnce({ status: "filled", label: "added", skillId: "aws", proofId: "p1" });
    expect(await addCertificate({ ...good, url: "https://learn.microsoft.com/api/credentials/share/en-us/PriyaSharma/ABC" })).toEqual({ status: "filled", label: "added" });
    expect(credly).not.toHaveBeenCalled();
    submit.mockResolvedValueOnce({ status: "pending", skillId: "aws", proofId: "p1" });
    credly.mockRejectedValueOnce(new Error("db down"));
    expect(await addCertificate(good)).toEqual({ status: "saved", message: expect.stringMatching(/check pending.*Credly didn't answer/) });
    // A certificate already verified isn't checked again.
    submit.mockResolvedValueOnce({ status: "filled", label: "verified", skillId: "aws", proofId: "p1" });
    expect(await addCertificate(good)).toEqual({ status: "filled", label: "verified" });
    expect(credly).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/c4ed1100|PriyaSharma|Priya/);
  });
});

describe("answerSignalCheck", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    account.mockResolvedValue({ id: "u1" });
    take.mockResolvedValue(true);
  });

  it("answers nothing signed out, and checks nothing that isn't text", async () => {
    account.mockResolvedValue(null);
    expect(await answerSignalCheck("sql-mc-1", "B")).toEqual({ ok: false, reason: "invalid" });
    account.mockResolvedValue({ id: "u1" });
    expect(await answerSignalCheck(1 as unknown as string, "B")).toEqual({ ok: false, reason: "invalid" });
    expect(answer).not.toHaveBeenCalled();
  });

  it("stops after the day's tries", async () => {
    take.mockResolvedValue(false);
    expect(await answerSignalCheck("sql-mc-1", "A")).toEqual({ ok: false, reason: "limit" });
    expect(answer).not.toHaveBeenCalled();
  });

  it("checks the answer for the session's person only, refreshes once it is saved, and says when the question changed", async () => {
    answer.mockResolvedValueOnce({ correctKey: "B", explanation: "Why." });
    expect(await answerSignalCheck("sql-mc-1", "A")).toEqual({ ok: true, answer: { correctKey: "B", explanation: "Why." } });
    expect(answer).toHaveBeenCalledWith("u1", "sql-mc-1", "A", expect.any(Date));
    expect(refresh).toHaveBeenCalledTimes(1);
    answer.mockResolvedValueOnce("stale");
    expect(await answerSignalCheck("old-question", "A")).toEqual({ ok: false, reason: "stale" });
    answer.mockResolvedValueOnce(null);
    expect(await answerSignalCheck("sql-mc-1", "Z")).toEqual({ ok: false, reason: "invalid" });
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(log).not.toHaveBeenCalled();
  });
});

describe("chooseTrack", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    account.mockResolvedValue({ id: "u1" });
  });

  it("asks a signed-out person to sign in, and saves nothing", async () => {
    account.mockResolvedValue(null);
    expect(await chooseTrack("bi-reporting")).toBe("Please sign in again.");
    expect(track).not.toHaveBeenCalled();
  });

  it("saves the person's own track and refreshes the page", async () => {
    track.mockResolvedValue({ ok: true, trackId: "bi-reporting" });
    expect(await chooseTrack("bi-reporting")).toBeNull();
    expect(track).toHaveBeenCalledWith("u1", "bi-reporting");
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("says why when the store refuses, and refreshes nothing", async () => {
    track.mockResolvedValue({ ok: false, error: "limit" });
    expect(await chooseTrack(null)).toMatch(/as many track changes/);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("logs a failure by event name only", async () => {
    track.mockRejectedValue(new Error("db down"));
    expect(await chooseTrack("bi-reporting")).toBe("That didn't work. Please try again.");
    expect(log).toHaveBeenCalledWith("error", "track_change_failed", {});
  });
});
