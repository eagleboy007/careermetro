import type { ReportReason } from "@/lib/schemas/inbox";

/*
 * The deadlines a report starts, as the Grievances page promises them (IT Rules 2021, rule 3(2)): every report is
 * acknowledged within 24 hours; sexual content or impersonation is acted on within 24 hours; a report asking us to
 * act on something that breaks the rules (money or OTP asks, harassment, fake jobs and spam) within 72 hours; anything
 * else gets a decision within 15 days. Decided by Development 2026-10-15 (docs/plans/reports-review-plan.md).
 */

const HOUR = 3_600_000;

export const DECIDE_WITHIN_HOURS: Record<ReportReason, number> = {
  intimate_or_impersonation: 24,
  money_or_otp: 72,
  harassment: 72,
  fake_or_spam: 72,
  other: 15 * 24,
};

export const ACKNOWLEDGE_WITHIN_HOURS = 24;

export function reportDeadlines(reason: ReportReason, reportedAt: Date): { acknowledgeBy: Date; decideBy: Date } {
  const at = reportedAt.getTime();
  return { acknowledgeBy: new Date(at + ACKNOWLEDGE_WITHIN_HOURS * HOUR), decideBy: new Date(at + DECIDE_WITHIN_HOURS[reason] * HOUR) };
}
