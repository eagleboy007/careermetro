import { describe, expect, it } from "vitest";
import { REPORT_REASONS } from "@/lib/schemas/inbox";
import { DECIDE_WITHIN_HOURS, orderDecideBy, reportDeadlines } from "./report-deadlines";

describe("reportDeadlines", () => {
  const at = new Date("2026-10-15T10:00:00Z");

  it("asks for an acknowledgement within 24 hours of every report", () => {
    for (const reason of REPORT_REASONS) expect(reportDeadlines(reason, at).acknowledgeBy.toISOString()).toBe("2026-10-16T10:00:00.000Z");
  });

  it("acts on sexual content or impersonation within 24 hours, rule breaks within 72 hours, anything else within 15 days", () => {
    expect(reportDeadlines("intimate_or_impersonation", at).decideBy.toISOString()).toBe("2026-10-16T10:00:00.000Z");
    for (const reason of ["money_or_otp", "harassment", "fake_or_spam"] as const) expect(reportDeadlines(reason, at).decideBy.toISOString()).toBe("2026-10-18T10:00:00.000Z");
    expect(reportDeadlines("other", at).decideBy.toISOString()).toBe("2026-10-30T10:00:00.000Z");
  });

  it("has a deadline for every reason", () => {
    expect(Object.keys(DECIDE_WITHIN_HOURS).sort()).toEqual([...REPORT_REASONS].sort());
  });

  it("acts on Junction's new reasons as the plan says: a child within 24 hours, the other rule breaks within 72", () => {
    expect(reportDeadlines("child_safety", at).decideBy.toISOString()).toBe("2026-10-16T10:00:00.000Z");
    for (const reason of ["hate", "privacy", "misleading", "copyright"] as const) expect(reportDeadlines(reason, at).decideBy.toISOString()).toBe("2026-10-18T10:00:00.000Z");
  });

  it("keeps a decide-by time stored at filing, so an order's clock or a later rule change doesn't move it", () => {
    const stored = new Date("2026-10-16T22:00:00Z");
    expect(reportDeadlines("other", at, stored).decideBy).toBe(stored);
    expect(reportDeadlines("other", at, null).decideBy.toISOString()).toBe("2026-10-30T10:00:00.000Z");
    expect(orderDecideBy(at).toISOString()).toBe("2026-10-16T22:00:00.000Z");
  });
});
