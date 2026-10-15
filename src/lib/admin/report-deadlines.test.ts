import { describe, expect, it } from "vitest";
import { REPORT_REASONS } from "@/lib/schemas/inbox";
import { DECIDE_WITHIN_HOURS, reportDeadlines } from "./report-deadlines";

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
});
