import { beforeEach, describe, expect, it, vi } from "vitest";

const account = vi.fn();
const check = vi.fn();
const refresh = vi.fn();
const log = vi.fn();
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ refresh: () => refresh() }));
vi.mock("@/lib/auth/server", () => ({ currentAccount: () => account() }));
vi.mock("@/lib/proofs/credly-store", () => ({ checkCertificateWithCredly: (...a: unknown[]) => check(...a) }));
vi.mock("@/lib/log", () => ({ logEvent: (...a: unknown[]) => log(...a), errorFields: () => ({}) }));

const { checkCertificateOnCredly } = await import("./actions");
const id = "00000000-0000-4000-8000-0000000c0001";

describe("checkCertificateOnCredly", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    account.mockResolvedValue({ id: "u1" });
  });

  it("checks nothing for a signed-out person or a bad id", async () => {
    account.mockResolvedValue(null);
    expect((await checkCertificateOnCredly(id)).status).toBe("refused");
    account.mockResolvedValue({ id: "u1" });
    expect((await checkCertificateOnCredly({ id })).status).toBe("refused");
    expect(check).not.toHaveBeenCalled();
  });

  it("checks the person's own proof and says what came of it in plain words", async () => {
    check.mockResolvedValueOnce({ status: "verified" });
    expect(await checkCertificateOnCredly(id)).toEqual({ status: "verified", message: expect.stringMatching(/^Verified with Credly/) });
    expect(check).toHaveBeenCalledWith("u1", id);
    expect(refresh).toHaveBeenCalledTimes(1);
    check.mockResolvedValueOnce({ status: "added", note: "issuer" });
    expect(await checkCertificateOnCredly(id)).toEqual({ status: "added", message: "Still Added by you. The Credly badge is from a different issuer." });
    check.mockResolvedValueOnce({ status: "held" });
    expect(await checkCertificateOnCredly(id)).toEqual({ status: "held", message: expect.stringMatching(/review it/) });
    check.mockResolvedValueOnce({ status: "refused", reason: "too_many" });
    expect(await checkCertificateOnCredly(id)).toMatchObject({ status: "refused", message: expect.stringMatching(/tomorrow/) });
    expect(refresh).toHaveBeenCalledTimes(3);
  });

  it("says a badge Credly hasn't confirmed is still pending, an expired one moves to Renew, and another name is refused", async () => {
    check.mockResolvedValueOnce({ status: "pending", note: "unreachable" });
    expect(await checkCertificateOnCredly(id)).toEqual({ status: "pending", message: expect.stringMatching(/^Check pending, so it doesn't fill the goal yet\. Credly didn't answer/) });
    check.mockResolvedValueOnce({ status: "added", note: "expired" });
    expect(await checkCertificateOnCredly(id)).toEqual({ status: "added", message: expect.stringMatching(/Renew/) });
    check.mockResolvedValueOnce({ status: "rejected", reason: "name" });
    expect(await checkCertificateOnCredly(id)).toEqual({ status: "refused", message: expect.stringMatching(/doesn't match your account/) });
    expect(refresh).toHaveBeenCalledTimes(3);
  });

  it("says so when something breaks, logging no id", async () => {
    check.mockRejectedValueOnce(new Error("boom"));
    expect((await checkCertificateOnCredly(id)).status).toBe("refused");
    expect(JSON.stringify(log.mock.calls)).not.toContain(id);
  });
});
