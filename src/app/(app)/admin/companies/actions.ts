"use server";

import { refresh } from "next/cache";
import { reviewCompany } from "@/lib/admin/companies";
import { currentAdmin } from "@/lib/admin/server";
import { reviewJobCheck, type JobCheckReviewResult } from "@/lib/me/job-email-check";
import type { ReviewDecision, ReviewResult } from "@/lib/corporate/types";

/*
 * The company review page's action (/admin/companies). It checks the person is an admin itself, as the page does; the
 * proxy has already answered not-found for anyone else. The store validates the input with Zod. Nothing here logs input.
 */

const NOT_AVAILABLE: ReviewResult = { ok: false, message: "That isn't available." };

export async function reviewCompanyAction(orgId: string, decision: ReviewDecision): Promise<ReviewResult> {
  const admin = await currentAdmin();
  if (!admin) return NOT_AVAILABLE;
  const result = await reviewCompany(admin.userId, { orgId, decision });
  if (result.ok) refresh();
  return result;
}

/** A work-email check of someone's current job whose domain isn't a verified company's under the employer's name (FR-47). */
export async function reviewJobCheckAction(id: string, decision: "verify" | "refuse"): Promise<JobCheckReviewResult> {
  const admin = await currentAdmin();
  if (!admin) return NOT_AVAILABLE;
  const result = await reviewJobCheck(admin.userId, { id, decision });
  if (result.ok) refresh();
  return result;
}
