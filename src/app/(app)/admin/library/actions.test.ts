import { beforeEach, describe, expect, it, vi } from "vitest";

// The Library review actions: only an admin gets through, the admin's id comes from the session, never the browser,
// and the page reloads its lists after a change.
const m = vi.hoisted(() => ({
  admin: null as { userId: string } | null,
  refresh: vi.fn(),
  decideResource: vi.fn(),
  decideSuggestion: vi.fn(),
}));
vi.mock("next/cache", () => ({ refresh: m.refresh }));
vi.mock("@/lib/admin/server", () => ({ currentAdmin: async () => m.admin }));
vi.mock("@/lib/admin/library", () => ({ decideResource: m.decideResource, decideSuggestion: m.decideSuggestion }));

import { decideResourceAction, decideSuggestionAction } from "./actions";

const ME = "0b8f8a52-6a1e-4b7f-9d6a-2f1d3c4b5a69";
const ID = "6f1d2c3b-4a59-4e6f-8a7b-9c0d1e2f3a4b";

beforeEach(() => {
  vi.clearAllMocks();
  m.admin = { userId: ME };
});

describe("Library review actions", () => {
  it("do nothing for anyone who isn't an admin", async () => {
    m.admin = null;
    expect(await decideResourceAction(ID, "hide")).toEqual({ ok: false, message: "That isn't available." });
    expect(await decideSuggestionAction(ID, "declined", "affiliate")).toEqual({ ok: false, message: "That isn't available." });
    expect(m.decideResource).not.toHaveBeenCalled();
    expect(m.decideSuggestion).not.toHaveBeenCalled();
    expect(m.refresh).not.toHaveBeenCalled();
  });

  it("pass the admin's own id with the raw input, and reload on success only", async () => {
    m.decideResource.mockResolvedValue({ ok: true, message: "Hidden." });
    expect((await decideResourceAction(ID, "hide")).ok).toBe(true);
    expect(m.decideResource).toHaveBeenCalledWith(ME, { resourceId: ID, decision: "hide" });
    expect(m.refresh).toHaveBeenCalledOnce();
    m.decideSuggestion.mockResolvedValue({ ok: false, message: "That isn't available. Refresh the page to see the latest." });
    expect((await decideSuggestionAction(ID, "accepted", null)).ok).toBe(false);
    expect(m.decideSuggestion).toHaveBeenCalledWith(ME, { suggestionId: ID, decision: "accepted", declineReason: null });
    expect(m.refresh).toHaveBeenCalledOnce();
  });
});
