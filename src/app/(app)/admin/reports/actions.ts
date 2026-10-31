"use server";

import { refresh } from "next/cache";
import { applyRemoval } from "@/lib/admin/removals";
import { reviewReport } from "@/lib/admin/reports";
import { currentAdmin } from "@/lib/admin/server";
import { decideAppeal, logIntake, setLegalHold } from "@/lib/junction/moderation";
import type { ReportDecision, ReportRemovalInput, ReportReviewResult } from "@/lib/schemas/admin";
import type { AppealDecisionInput, IntakeInput, LegalHoldInput } from "@/lib/schemas/junction";

/*
 * The report review page's actions (/admin/reports, FR-45 and FR-46). Each checks the person is an admin itself, as the
 * page does; the proxy has already answered not-found for anyone else. The stores validate the input with Zod. Nothing
 * here logs input: a removal's reason is never logged.
 */

const NOT_AVAILABLE: ReportReviewResult = { ok: false, message: "That isn't available." };

export async function reviewReportAction(reportId: string, decision: ReportDecision): Promise<ReportReviewResult> {
  const admin = await currentAdmin();
  if (!admin) return NOT_AVAILABLE;
  const result = await reviewReport(admin.userId, { reportId, decision });
  if (result.ok) refresh();
  return result;
}

/** Hide or show again a reported message, post or comment, or suspend or lift a reported account (FR-46, FR-61). */
export async function reportRemovalAction(input: ReportRemovalInput): Promise<ReportReviewResult> {
  const admin = await currentAdmin();
  if (!admin) return NOT_AVAILABLE;
  const result = await applyRemoval(admin.userId, input);
  if (result.ok) refresh();
  return result;
}

/** Decide an open Junction appeal: keep hidden or show again, with a reason (FR-61). */
export async function decideAppealAction(input: AppealDecisionInput): Promise<ReportReviewResult> {
  const admin = await currentAdmin();
  if (!admin) return NOT_AVAILABLE;
  const result = await decideAppeal(admin.userId, input);
  if (result.ok) refresh();
  return result;
}

/** Log an emailed complaint, a court order or a government notice into the queue (FR-61). Who sent it is never logged. */
export async function logIntakeAction(input: IntakeInput): Promise<ReportReviewResult> {
  const admin = await currentAdmin();
  if (!admin) return NOT_AVAILABLE;
  const result = await logIntake(admin.userId, input);
  if (result.ok) refresh();
  return result;
}

/** Set or lift the legal hold on a Junction removal record (FR-61). */
export async function setLegalHoldAction(input: LegalHoldInput): Promise<ReportReviewResult> {
  const admin = await currentAdmin();
  if (!admin) return NOT_AVAILABLE;
  const result = await setLegalHold(admin.userId, input);
  if (result.ok) refresh();
  return result;
}
