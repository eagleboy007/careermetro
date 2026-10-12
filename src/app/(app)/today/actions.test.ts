import { beforeEach, describe, expect, it, vi } from "vitest";

const account = vi.fn();
const submit = vi.fn();
const take = vi.fn();
const refresh = vi.fn();
const log = vi.fn();
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ refresh: () => refresh() }));
vi.mock("@/lib/auth/server", () => ({ currentAccount: () => account() }));
vi.mock("@/lib/goals/store", () => ({ submitCertificate: (...a: unknown[]) => submit(...a) }));
vi.mock("@/lib/shared-limit", () => ({ LIMITS: { certificateTriesPerUser: {} }, takeShared: () => take() }));
vi.mock("@/lib/account/store", () => ({ setWeeklyHours: vi.fn() }));
vi.mock("@/lib/ride/store", () => ({ tickTask: vi.fn() }));
vi.mock("@/lib/log", () => ({ logEvent: (...a: unknown[]) => log(...a), errorFields: () => ({}) }));

const { addCertificate } = await import("./actions");

const good = {
  goalId: "7d1c2f9e-3a4b-4c5d-8e6f-0a1b2c3d4e5f",
  certId: "aws-cloud-practitioner",
  credentialId: "SECRET-CRED-ID",
  issuedOn: "2025-03-01",
  expiresOn: null,
  nameOnCertificate: "Priya Sharma",
  url: "https://www.credly.com/badges/abc",
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
    submit.mockResolvedValueOnce({ status: "filled", label: "uploaded", skillId: "aws" });
    expect(await addCertificate(good)).toEqual({ status: "filled", label: "uploaded" });
    expect(refresh).toHaveBeenCalledTimes(1);
    submit.mockResolvedValueOnce({ status: "held", skillId: "aws" });
    expect((await addCertificate(good)).status).toBe("held");
    submit.mockResolvedValueOnce({ status: "refused", reason: "name" });
    expect(await addCertificate(good)).toMatchObject({ status: "refused", message: expect.stringMatching(/doesn't match your account/) });
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/SECRET-CRED-ID|Priya/);
  });
});
