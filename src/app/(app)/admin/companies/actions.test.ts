import { beforeEach, describe, expect, it, vi } from "vitest";

// The review page's server action: only an admin gets through, the admin's id comes from the session, never the
// browser, and the page reloads its list after a change.
const m = vi.hoisted(() => ({
  admin: null as { userId: string } | null,
  refresh: vi.fn(),
  reviewCompany: vi.fn(),
}));
vi.mock("next/cache", () => ({ refresh: m.refresh }));
vi.mock("@/lib/admin/server", () => ({ currentAdmin: async () => m.admin }));
vi.mock("@/lib/admin/companies", () => ({ reviewCompany: m.reviewCompany }));

import { reviewCompanyAction } from "./actions";

const ME = "0b8f8a52-6a1e-4b7f-9d6a-2f1d3c4b5a69";
const ORG = "6f1d2c3b-4a59-4e6f-8a7b-9c0d1e2f3a4b";

beforeEach(() => {
  vi.clearAllMocks();
  m.admin = { userId: ME };
});

describe("reviewCompanyAction", () => {
  it("does nothing for anyone who isn't an admin, and says nothing about the page", async () => {
    m.admin = null;
    expect(await reviewCompanyAction(ORG, "verify")).toEqual({ ok: false, message: "That isn't available." });
    expect(m.reviewCompany).not.toHaveBeenCalled();
    expect(m.refresh).not.toHaveBeenCalled();
  });

  it("passes the admin's own id with the raw input, and reloads the list on success", async () => {
    m.reviewCompany.mockResolvedValue({ ok: true, message: "Example Labs is verified." });
    expect(await reviewCompanyAction(ORG, "verify")).toEqual({ ok: true, message: "Example Labs is verified." });
    expect(m.reviewCompany).toHaveBeenCalledWith(ME, { orgId: ORG, decision: "verify" });
    expect(m.refresh).toHaveBeenCalledOnce();
  });

  it("announces a refusal without reloading", async () => {
    m.reviewCompany.mockResolvedValue({ ok: false, message: "That company isn't on the list any more. Reload the page to see the latest." });
    expect((await reviewCompanyAction(ORG, "suspend")).ok).toBe(false);
    expect(m.refresh).not.toHaveBeenCalled();
  });
});
