"use server";

import { refresh } from "next/cache";
import { setWeeklyHours } from "@/lib/account/store";
import { currentAccount } from "@/lib/auth/server";
import { submitCertificate } from "@/lib/goals/store";
import { errorFields, logEvent } from "@/lib/log";
import { checkCertificateWithCredly } from "@/lib/proofs/credly-store";
import {
  CERTIFICATE_REFUSAL_MESSAGES,
  CREDENTIAL_HELD_MESSAGE,
  CREDLY_EXPIRED_MESSAGE,
  CREDLY_HELD_MESSAGE,
  CREDLY_NOTE_MESSAGES,
  CREDLY_PENDING_MESSAGE,
  CREDLY_REFUSAL_MESSAGES,
} from "@/lib/proofs/messages";
import type { CertificateResult } from "@/lib/proofs/result";
import { tickTask } from "@/lib/ride/store";
import { certificateSubmission, type CredlyCheckOutcome } from "@/lib/schemas";
import { LIMITS, takeShared } from "@/lib/shared-limit";

/** The first field that is wrong, in the person's words. */
const FIELD_MESSAGES: Record<string, string> = {
  certId: "Pick the certificate from the list.",
  credentialId: "Add the credential ID printed on the certificate.",
  issuedOn: "Add the date the certificate was issued.",
  expiresOn: "The expiry date must be after the issue date.",
  nameOnCertificate: "Add your name as it is printed on the certificate.",
  url: "Add the certificate's verify link. It starts with https://",
  confirmed: "Tick the box to say this certificate is yours.",
};

/**
 * "Add a certificate" on Today and the Map (dev/proof-plan.md). Checked again here, whatever the browser sent. A Credly
 * badge link is then checked with Credly, after the save (dev/profile-certs-plan.md). The credential id, the printed
 * name and the link never reach a log: only the outcome does.
 */
export async function addCertificate(input: unknown): Promise<CertificateResult> {
  const account = await currentAccount();
  if (!account) return { status: "refused", message: "Please sign in to add a certificate." };
  const parsed = certificateSubmission.safeParse(input);
  if (!parsed.success) {
    const field = String(parsed.error.issues[0]?.path[0] ?? "");
    return FIELD_MESSAGES[field] ? { status: "invalid", message: FIELD_MESSAGES[field], field } : { status: "invalid", message: "Check the details and try again." };
  }
  if (!(await takeShared(LIMITS.certificateTriesPerUser, account.id))) return { status: "refused", message: CERTIFICATE_REFUSAL_MESSAGES.too_many };
  try {
    const outcome = await submitCertificate(account.id, parsed.data);
    logEvent("info", "certificate_added", { status: outcome.status, ...(outcome.status === "refused" ? { reason: outcome.reason } : {}) });
    if (outcome.status === "refused") return { status: "refused", message: CERTIFICATE_REFUSAL_MESSAGES[outcome.reason] };
    if (outcome.status === "held") {
      refresh();
      return { status: "held", message: outcome.reason === "badge" ? CREDLY_HELD_MESSAGE : CREDENTIAL_HELD_MESSAGE };
    }
    if (outcome.status === "filled") {
      refresh();
      return { status: "filled", label: outcome.label };
    }
    // A Credly badge fills the goal only once Credly confirms it (decision of 2026-10-13). Until then it is saved as
    // "Added by you, check pending", and the person can check it again from their profile.
    let check: CredlyCheckOutcome;
    try {
      check = await checkCertificateWithCredly(account.id, outcome.proofId);
    } catch (error) {
      logEvent("error", "certificate_check_failed", errorFields(error));
      check = { status: "pending", note: "unreachable" };
    }
    refresh();
    switch (check.status) {
      case "verified":
        return { status: "filled", label: "verified" };
      case "held":
        return { status: "held", message: CREDLY_HELD_MESSAGE };
      case "rejected":
        return { status: "refused", message: CERTIFICATE_REFUSAL_MESSAGES.name };
      case "added":
        return check.note === "expired" ? { status: "saved", message: CREDLY_EXPIRED_MESSAGE } : { status: "filled", label: "added", note: CREDLY_NOTE_MESSAGES[check.note] };
      case "pending":
        return { status: "saved", message: `${CREDLY_PENDING_MESSAGE} ${CREDLY_NOTE_MESSAGES[check.note]}` };
      case "refused":
        return check.reason === "too_many"
          ? { status: "saved", message: `${CREDLY_PENDING_MESSAGE} ${CREDLY_REFUSAL_MESSAGES.too_many}` }
          : { status: "refused", message: CREDLY_REFUSAL_MESSAGES[check.reason] };
    }
  } catch (error) {
    logEvent("error", "certificate_failed", errorFields(error));
    return { status: "refused", message: "Something went wrong saving that. Please try again." };
  }
}

/** Saves a tick or untick on one of the signed-in person's ride tasks for today. Example mode has nothing to save. */
export async function tickRideTask(taskId: string, on: boolean): Promise<boolean> {
  if (typeof taskId !== "string" || typeof on !== "boolean") return false;
  const account = await currentAccount();
  if (!account) return false;
  const saved = await tickTask(account.id, taskId, on, new Date());
  // The header's streak chip reads ride days too, so the page refreshes. refresh() re-renders only this person's view;
  // revalidatePath("/", "layout") used to throw away every cached page on the site, and static pages such as
  // /roles/[slug] then failed to rebuild on the next visit (500, NEXT_STATIC_GEN_BAILOUT).
  if (saved) refresh();
  return saved;
}

/** Saves the hours a week the signed-in person picked on Today. The Path page opens at these hours. */
export async function saveWeeklyHours(hours: number): Promise<boolean> {
  if (typeof hours !== "number") return false;
  const account = await currentAccount();
  if (!account) return false;
  return setWeeklyHours(account.id, hours);
}
