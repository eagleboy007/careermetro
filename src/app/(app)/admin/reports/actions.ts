"use server";

import { refresh } from "next/cache";
import { applyRemoval } from "@/lib/admin/removals";
import { reviewReport } from "@/lib/admin/reports";
import { currentAdmin } from "@/lib/admin/server";
import type { ReportDecision, ReportRemovalInput, ReportReviewResult } from "@/lib/schemas/admin";

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

/** Hide or show again a reported message, or suspend or lift a reported account (FR-46). */
export async function reportRemovalAction(input: ReportRemovalInput): Promise<ReportReviewResult> {
  const admin = await currentAdmin();
  if (!admin) return NOT_AVAILABLE;
  const result = await applyRemoval(admin.userId, input);
  if (result.ok) refresh();
  return result;
}
