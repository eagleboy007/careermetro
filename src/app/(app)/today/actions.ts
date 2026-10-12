"use server";

import { refresh } from "next/cache";
import { setWeeklyHours } from "@/lib/account/store";
import { currentAccount } from "@/lib/auth/server";
import { submitCertificate } from "@/lib/goals/store";
import { errorFields, logEvent } from "@/lib/log";
import { CERTIFICATE_REFUSAL_MESSAGES } from "@/lib/proofs/messages";
import type { CertificateResult } from "@/lib/proofs/result";
import { tickTask } from "@/lib/ride/store";
import { certificateSubmission } from "@/lib/schemas";
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
 * "Add a certificate" on Today and the Map (dev/proof-plan.md). Checked again here, whatever the browser sent. The
 * credential id and the printed name never reach a log: only the outcome does.
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
    refresh();
    if (outcome.status === "held") {
      return { status: "held", message: "This certificate is already on another account, so we'll check it first. It doesn't fill the goal until then." };
    }
    return { status: "filled", label: outcome.label };
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
