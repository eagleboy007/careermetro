import { beforeEach, describe, expect, it, vi } from "vitest";

// The report review actions: only an admin gets through, the admin's id comes from the session, never the browser,
// and the page reloads its list after a change.
const m = vi.hoisted(() => ({
  admin: null as { userId: string } | null,
  refresh: vi.fn(),
  reviewReport: vi.fn(),
  applyRemoval: vi.fn(),
}));
vi.mock("next/cache", () => ({ refresh: m.refresh }));
vi.mock("@/lib/admin/server", () => ({ currentAdmin: async () => m.admin }));
vi.mock("@/lib/admin/reports", () => ({ reviewReport: m.reviewReport }));
vi.mock("@/lib/admin/removals", () => ({ applyRemoval: m.applyRemoval }));

import { reportRemovalAction, reviewReportAction } from "./actions";

const ME = "0b8f8a52-6a1e-4b7f-9d6a-2f1d3c4b5a69";
const REPORT = "6f1d2c3b-4a59-4e6f-8a7b-9c0d1e2f3a4b";
const MESSAGE = "7a2e3d4c-5b6a-4f7e-9b8c-0d1e2f3a4b5c";

beforeEach(() => {
  vi.clearAllMocks();
  m.admin = { userId: ME };
});

describe("reviewReportAction", () => {
  it("does nothing for anyone who isn't an admin, and says nothing about the page", async () => {
    m.admin = null;
    for (const d of ["acknowledge", "actioned", "dismissed"] as const) expect(await reviewReportAction(REPORT, d)).toEqual({ ok: false, message: "That isn't available." });
    expect(m.reviewReport).not.toHaveBeenCalled();
    expect(m.refresh).not.toHaveBeenCalled();
  });

  it("passes the admin's own id with the raw input, and reloads the list on success", async () => {
    m.reviewReport.mockResolvedValue({ ok: true, message: "Dismissed. It leaves the list." });
    expect(await reviewReportAction(REPORT, "dismissed")).toEqual({ ok: true, message: "Dismissed. It leaves the list." });
    expect(m.reviewReport).toHaveBeenCalledWith(ME, { reportId: REPORT, decision: "dismissed" });
    expect(m.refresh).toHaveBeenCalledOnce();
  });

  it("announces a refusal without reloading", async () => {
    m.reviewReport.mockResolvedValue({ ok: false, message: "That report isn't open any more. Reload the page to see the latest." });
    expect((await reviewReportAction(REPORT, "actioned")).ok).toBe(false);
    expect(m.refresh).not.toHaveBeenCalled();
  });
});

describe("reportRemovalAction", () => {
  it("does nothing for anyone who isn't an admin", async () => {
    m.admin = null;
    expect(await reportRemovalAction({ action: "hide_message", reportId: REPORT, reason: "Asked for money." })).toEqual({ ok: false, message: "That isn't available." });
    expect(await reportRemovalAction({ action: "lift_suspension", userId: ME })).toEqual({ ok: false, message: "That isn't available." });
    expect(m.applyRemoval).not.toHaveBeenCalled();
    expect(m.refresh).not.toHaveBeenCalled();
  });

  it("passes the admin's own id with the raw input, and reloads the page on success", async () => {
    m.applyRemoval.mockResolvedValue({ ok: true, message: "Message hidden. Everyone in the chat now sees a notice in its place." });
    const input = { action: "hide_message", reportId: REPORT, reason: "Asked for money." } as const;
    expect((await reportRemovalAction(input)).ok).toBe(true);
    expect(m.applyRemoval).toHaveBeenCalledWith(ME, input);
    expect(m.refresh).toHaveBeenCalledOnce();
  });

  it("announces a refusal without reloading", async () => {
    m.applyRemoval.mockResolvedValue({ ok: false, message: "An admin's account can't be suspended." });
    expect(await reportRemovalAction({ action: "unhide_message", messageId: MESSAGE })).toEqual({ ok: false, message: "An admin's account can't be suspended." });
    expect(m.refresh).not.toHaveBeenCalled();
  });
});
