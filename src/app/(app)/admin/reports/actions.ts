"use server";

import { refresh } from "next/cache";
import { reviewReport } from "@/lib/admin/reports";
import { currentAdmin } from "@/lib/admin/server";
import type { ReportDecision, ReportReviewResult } from "@/lib/schemas/admin";

/*
 * The report review page's action (/admin/reports, FR-45). It checks the person is an admin itself, as the page does;
 * the proxy has already answered not-found for anyone else. The store validates the input with Zod. Nothing here logs
 * input.
 */

const NOT_AVAILABLE: ReportReviewResult = { ok: false, message: "That isn't available." };

export async function reviewReportAction(reportId: string, decision: ReportDecision): Promise<ReportReviewResult> {
  const admin = await currentAdmin();
  if (!admin) return NOT_AVAILABLE;
  const result = await reviewReport(admin.userId, { reportId, decision });
  if (result.ok) refresh();
  return result;
}
