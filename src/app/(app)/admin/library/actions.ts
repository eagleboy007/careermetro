"use server";

import { refresh } from "next/cache";
import { decideResource, decideSuggestion } from "@/lib/admin/library";
import { currentAdmin } from "@/lib/admin/server";
import type { ProofReviewResult } from "@/lib/schemas/admin";

/*
 * The Library review page's actions (/admin/library, docs/plans/library-part-2-plan.md). Each checks the person is an
 * admin itself, as the page does; the proxy has already answered not-found for anyone else. The admin's id comes from
 * the session, never the browser. The store validates the input with Zod. Nothing here logs input.
 */

const NOT_AVAILABLE: ProofReviewResult = { ok: false, message: "That isn't available." };

/** Hide link, Show again or Dismiss reports. */
export async function decideResourceAction(resourceId: string, decision: string): Promise<ProofReviewResult> {
  const admin = await currentAdmin();
  if (!admin) return NOT_AVAILABLE;
  const result = await decideResource(admin.userId, { resourceId, decision });
  if (result.ok) refresh();
  return result;
}

/** Accept, Already in the Library, or Decline with its reason (null for the other two). */
export async function decideSuggestionAction(suggestionId: string, decision: string, declineReason: string | null): Promise<ProofReviewResult> {
  const admin = await currentAdmin();
  if (!admin) return NOT_AVAILABLE;
  const result = await decideSuggestion(admin.userId, { suggestionId, decision, declineReason });
  if (result.ok) refresh();
  return result;
}
