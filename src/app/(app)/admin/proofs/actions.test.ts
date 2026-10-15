import { beforeEach, describe, expect, it, vi } from "vitest";

// The held-proof review action: only an admin gets through, the admin's id comes from the session, never the browser,
// and the page reloads its list after a change.
const m = vi.hoisted(() => ({
  admin: null as { userId: string } | null,
  refresh: vi.fn(),
  reviewHeldProof: vi.fn(),
}));
vi.mock("next/cache", () => ({ refresh: m.refresh }));
vi.mock("@/lib/admin/server", () => ({ currentAdmin: async () => m.admin }));
vi.mock("@/lib/admin/proofs", () => ({ reviewHeldProof: m.reviewHeldProof }));

import { reviewProofAction } from "./actions";

const ME = "0b8f8a52-6a1e-4b7f-9d6a-2f1d3c4b5a69";
const PROOF = "6f1d2c3b-4a59-4e6f-8a7b-9c0d1e2f3a4b";

beforeEach(() => {
  vi.clearAllMocks();
  m.admin = { userId: ME };
});

describe("reviewProofAction", () => {
  it("does nothing for anyone who isn't an admin, and says nothing about the page", async () => {
    m.admin = null;
    expect(await reviewProofAction(PROOF, "accept")).toEqual({ ok: false, message: "That isn't available." });
    expect(await reviewProofAction(PROOF, "reject")).toEqual({ ok: false, message: "That isn't available." });
    expect(m.reviewHeldProof).not.toHaveBeenCalled();
    expect(m.refresh).not.toHaveBeenCalled();
  });

  it("passes the admin's own id with the raw input, and reloads the list on success", async () => {
    m.reviewHeldProof.mockResolvedValue({ ok: true, message: "Accepted for Priya S." });
    expect(await reviewProofAction(PROOF, "accept")).toEqual({ ok: true, message: "Accepted for Priya S." });
    expect(m.reviewHeldProof).toHaveBeenCalledWith(ME, { proofId: PROOF, decision: "accept" });
    expect(m.refresh).toHaveBeenCalledOnce();
  });

  it("announces a refusal without reloading", async () => {
    m.reviewHeldProof.mockResolvedValue({ ok: false, message: "That proof isn't waiting for review any more. Reload the page to see the latest." });
    expect((await reviewProofAction(PROOF, "reject")).ok).toBe(false);
    expect(m.refresh).not.toHaveBeenCalled();
  });
});
