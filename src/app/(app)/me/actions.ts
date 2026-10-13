"use server";

import { refresh } from "next/cache";
import type { CredlyCheckResult } from "@/lib/proofs/result";
import { currentAccount } from "@/lib/auth/server";
import { errorFields, logEvent } from "@/lib/log";
import { checkCertificateWithCredly } from "@/lib/proofs/credly-store";
import { CREDLY_HELD_MESSAGE, CREDLY_NOTE_MESSAGES, CREDLY_REFUSAL_MESSAGES } from "@/lib/proofs/messages";

/**
 * "Check with Credly" on the person's own profile (pending item 13, dev/profile-certs-plan.md). Checks one of their
 * accepted certificates against its Credly badge; the store keeps it to their own proofs and counts the daily limit.
 * The proof id is the only thing sent, and nothing about the badge reaches a log.
 */
export async function checkCertificateOnCredly(proofId: unknown): Promise<CredlyCheckResult> {
  if (typeof proofId !== "string") return { status: "refused", message: CREDLY_REFUSAL_MESSAGES.not_found };
  const account = await currentAccount();
  if (!account) return { status: "refused", message: "Please sign in to check a certificate." };
  try {
    const out = await checkCertificateWithCredly(account.id, proofId);
    if (out.status === "refused") return { status: "refused", message: CREDLY_REFUSAL_MESSAGES[out.reason] };
    refresh();
    if (out.status === "held") return { status: "held", message: CREDLY_HELD_MESSAGE };
    return out.status === "verified"
      ? { status: "verified", message: "Verified with Credly: the badge matches this certificate and your name." }
      : { status: "added", message: `Still Added by you. ${CREDLY_NOTE_MESSAGES[out.note]}` };
  } catch (error) {
    logEvent("error", "certificate_check_failed", errorFields(error));
    return { status: "refused", message: "Something went wrong checking that. Please try again." };
  }
}
