import { beforeEach, describe, expect, it, vi } from "vitest";

const account = vi.fn();
const submit = vi.fn();
const take = vi.fn();
const refresh = vi.fn();
const log = vi.fn();
const credly = vi.fn();
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ refresh: () => refresh() }));
vi.mock("@/lib/auth/server", () => ({ currentAccount: () => account() }));
vi.mock("@/lib/goals/store", () => ({ submitCertificate: (...a: unknown[]) => submit(...a) }));
vi.mock("@/lib/shared-limit", () => ({ LIMITS: { certificateTriesPerUser: {} }, takeShared: () => take() }));
vi.mock("@/lib/account/store", () => ({ setWeeklyHours: vi.fn() }));
vi.mock("@/lib/ride/store", () => ({ tickTask: vi.fn() }));
vi.mock("@/lib/proofs/credly-store", () => ({ checkCertificateWithCredly: (...a: unknown[]) => credly(...a) }));
vi.mock("@/lib/log", () => ({ logEvent: (...a: unknown[]) => log(...a), errorFields: () => ({}) }));

const { addCertificate } = await import("./actions");

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
    submit.mockResolvedValueOnce({ status: "filled", label: "added", skillId: "aws", proofId: "p1" });
    credly.mockResolvedValueOnce({ status: "verified" });
    expect(await addCertificate(good)).toEqual({ status: "filled", label: "verified" });
    expect(credly).toHaveBeenCalledWith("u1", "p1");
    expect(refresh).toHaveBeenCalledTimes(1);
    submit.mockResolvedValueOnce({ status: "held", skillId: "aws" });
    expect((await addCertificate(good)).status).toBe("held");
    submit.mockResolvedValueOnce({ status: "refused", reason: "name" });
    expect(await addCertificate(good)).toMatchObject({ status: "refused", message: expect.stringMatching(/doesn't match your account/) });
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/SECRET-CRED-ID|Priya/);
  });

  it("checks a Credly link after saving: a mismatch is Added by you with the reason, and the goal is still filled", async () => {
    submit.mockResolvedValueOnce({ status: "filled", label: "added", skillId: "aws", proofId: "p1" });
    credly.mockResolvedValueOnce({ status: "added", note: "earner_name" });
    expect(await addCertificate(good)).toEqual({ status: "filled", label: "added", note: "The name on the Credly badge doesn't match your account." });
    submit.mockResolvedValueOnce({ status: "filled", label: "added", skillId: "aws", proofId: "p1" });
    credly.mockResolvedValueOnce({ status: "refused", reason: "too_many" });
    expect(await addCertificate(good)).toMatchObject({ status: "filled", label: "added", note: expect.stringMatching(/tomorrow/) });
    // A badge already verified on another account is held for review, so the goal is no longer filled.
    submit.mockResolvedValueOnce({ status: "filled", label: "added", skillId: "aws", proofId: "p1" });
    credly.mockResolvedValueOnce({ status: "held" });
    expect(await addCertificate(good)).toEqual({ status: "held", message: expect.stringMatching(/review it/) });
  });

  it("doesn't check other links, and a failed check never fails the save", async () => {
    submit.mockResolvedValueOnce({ status: "filled", label: "added", skillId: "aws", proofId: "p1" });
    expect(await addCertificate({ ...good, url: "https://learn.microsoft.com/api/credentials/share/en-us/PriyaSharma/ABC" })).toEqual({ status: "filled", label: "added" });
    expect(credly).not.toHaveBeenCalled();
    submit.mockResolvedValueOnce({ status: "filled", label: "added", skillId: "aws", proofId: "p1" });
    credly.mockRejectedValueOnce(new Error("db down"));
    expect(await addCertificate(good)).toMatchObject({ status: "filled", label: "added", note: expect.stringMatching(/Credly didn't answer/) });
    // A certificate already verified isn't checked again.
    submit.mockResolvedValueOnce({ status: "filled", label: "verified", skillId: "aws", proofId: "p1" });
    expect(await addCertificate(good)).toEqual({ status: "filled", label: "verified" });
    expect(credly).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/c4ed1100|PriyaSharma|Priya/);
  });
});
