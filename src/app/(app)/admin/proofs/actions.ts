"use server";

import { refresh } from "next/cache";
import { reviewHeldProof } from "@/lib/admin/proofs";
import { currentAdmin } from "@/lib/admin/server";
import type { ProofReviewDecision, ProofReviewResult } from "@/lib/schemas/admin";

/*
 * The held-proof review page's action (/admin/proofs, FR-44). It checks the person is an admin itself, as the page
 * does; the proxy has already answered not-found for anyone else. The store validates the input with Zod. Nothing here
 * logs input.
 */

const NOT_AVAILABLE: ProofReviewResult = { ok: false, message: "That isn't available." };

export async function reviewProofAction(proofId: string, decision: ProofReviewDecision): Promise<ProofReviewResult> {
  const admin = await currentAdmin();
  if (!admin) return NOT_AVAILABLE;
  const result = await reviewHeldProof(admin.userId, { proofId, decision });
  if (result.ok) refresh();
  return result;
}
