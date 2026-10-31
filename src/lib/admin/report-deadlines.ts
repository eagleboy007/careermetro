import type { ReportReason } from "@/lib/schemas/inbox";
import { ACKNOWLEDGE_WITHIN_HOURS, DECIDE_WITHIN_HOURS, deadlinesFor, ORDER_DEADLINE_HOURS, orderDecideBy } from "@/lib/schemas/legal-timings";

/*
 * The deadlines a report starts, as the Grievances page promises them (IT Rules 2021, rule 3(2)): every report is
 * acknowledged within 24 hours; sexual content or impersonation, and anything harmful to a child, is acted on within
 * 24 hours; a report asking us to act on something that breaks the rules within 72 hours; anything else gets a decision
 * within 15 days. Decided by Development 2026-10-15 (docs/plans/reports-review-plan.md); Junction's reasons added
 * 2026-10-31 (docs/plans/junction-plan.md section 2.3). The hours themselves live in src/lib/schemas/legal-timings.ts.
 *
 * From migration 0059 a report stores its decide-by time when it is filed (reports.decide_by), so a logged court order's
 * shorter clock and a later change to these numbers don't move old reports. Older rows have none and use these.
 */

export { ACKNOWLEDGE_WITHIN_HOURS, DECIDE_WITHIN_HOURS, ORDER_DEADLINE_HOURS, orderDecideBy };

export function reportDeadlines(reason: ReportReason, reportedAt: Date, storedDecideBy?: Date | null): { acknowledgeBy: Date; decideBy: Date } {
  const d = deadlinesFor(reason, reportedAt);
  return { acknowledgeBy: d.acknowledgeBy, decideBy: storedDecideBy ?? d.decideBy };
}
