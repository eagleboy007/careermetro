"use server";

import { refresh } from "next/cache";
import type { CredlyCheckResult } from "@/lib/proofs/result";
import { currentAccount } from "@/lib/auth/server";
import { errorFields, logEvent } from "@/lib/log";
import {
  addInterest,
  deleteMeEducation,
  deleteMeRole,
  deleteStory,
  ME_EDIT_MESSAGES,
  removeInterest,
  saveMeEducation,
  saveMeRole,
  saveStory,
  type MeEditResult,
} from "@/lib/me/edit-store";
import { finishJobCheck, startJobCheck } from "@/lib/me/job-email-check";
import { checkCertificateWithCredly } from "@/lib/proofs/credly-store";
import { CERTIFICATE_REFUSAL_MESSAGES, CREDLY_EXPIRED_MESSAGE, CREDLY_HELD_MESSAGE, CREDLY_NOTE_MESSAGES, CREDLY_REFUSAL_MESSAGES } from "@/lib/proofs/messages";

/**
 * "Check with Credly" on the person's own profile (pending item 13, dev/profile-certs-plan.md). Checks one of their
 * certificates against its Credly badge; the store keeps it to their own proofs and counts the daily limit. The proof
 * id is the only thing sent, and nothing about the badge reaches a log.
 */
export async function checkCertificateOnCredly(proofId: unknown): Promise<CredlyCheckResult> {
  if (typeof proofId !== "string") return { status: "refused", message: CREDLY_REFUSAL_MESSAGES.not_found };
  const account = await currentAccount();
  if (!account) return { status: "refused", message: "Please sign in to check a certificate." };
  try {
    const out = await checkCertificateWithCredly(account.id, proofId);
    if (out.status === "refused") return { status: "refused", message: CREDLY_REFUSAL_MESSAGES[out.reason] };
    refresh();
    switch (out.status) {
      case "held":
        return { status: "held", message: CREDLY_HELD_MESSAGE };
      case "rejected":
        return { status: "refused", message: CERTIFICATE_REFUSAL_MESSAGES.name };
      case "verified":
        return { status: "verified", message: "Verified with Credly: the badge matches this certificate and your name." };
      case "pending":
        return { status: "pending", message: `Check pending, so it doesn't fill the goal yet. ${CREDLY_NOTE_MESSAGES[out.note]}` };
      case "added":
        return { status: "added", message: out.note === "expired" ? CREDLY_EXPIRED_MESSAGE : `Still Added by you. ${CREDLY_NOTE_MESSAGES[out.note]}` };
    }
  } catch (error) {
    logEvent("error", "certificate_check_failed", errorFields(error));
    return { status: "refused", message: "Something went wrong checking that. Please try again." };
  }
}

/**
 * "Verify with your work email" on the current job (FR-47): send a code, then confirm it. The store checks the
 * address, keeps the code to this person and counts the limits. Nothing typed reaches a log.
 */
export async function sendJobCheckCode(workEmail: string): Promise<{ ok: true; testCode?: string } | { ok: false; error: string }> {
  const account = await currentAccount();
  if (!account) return { ok: false, error: "Please sign in to verify your job." };
  try {
    return await startJobCheck(account.id, { workEmail });
  } catch (error) {
    logEvent("error", "job_check_send_failed", errorFields(error));
    return { ok: false, error: "Something went wrong sending the code. Please try again." };
  }
}

export async function confirmJobCheckCode(workEmail: string, code: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const account = await currentAccount();
  if (!account) return { ok: false, error: "Please sign in to verify your job." };
  try {
    const out = await finishJobCheck(account.id, { workEmail, code });
    if (!out.ok) return out;
    refresh();
    return { ok: true };
  } catch (error) {
    logEvent("error", "job_check_confirm_failed", errorFields(error));
    return { ok: false, error: "Something went wrong checking the code. Please try again." };
  }
}

/*
 * Me editing (docs/plans/me-editing-plan.md): add, edit and delete roles, education and stories, and add or remove
 * interests. Each checks the account itself; the store checks the input with Zod, matches the row to this account and
 * counts the daily limit. Nothing typed reaches a log: event names and error codes only.
 */

/** null when it worked, or the words to show, with the field they belong to when there is one. */
export type MeEditActionResult = { error: string | null; field?: string };

async function edit(name: string, work: (userId: string) => Promise<MeEditResult>): Promise<MeEditActionResult> {
  const account = await currentAccount();
  if (!account) return { error: "Please sign in again." };
  try {
    const out = await work(account.id);
    if (!out.ok) return { error: out.message ?? ME_EDIT_MESSAGES[out.error], field: out.field };
    refresh();
    return { error: null };
  } catch (error) {
    logEvent("error", name, errorFields(error));
    return { error: "That didn't work. Please try again." };
  }
}

/** "+ Add role" with `id` null, or Edit on a role the person added. */
export async function saveMeRoleAction(id: string | null, input: unknown): Promise<MeEditActionResult> {
  return edit("me_role_save_failed", (userId) => saveMeRole(userId, id, input));
}

export async function deleteMeRoleAction(id: string): Promise<MeEditActionResult> {
  return edit("me_role_delete_failed", (userId) => deleteMeRole(userId, id));
}

/** "+ Add" under Education with `id` null, or Edit on one the person added. */
export async function saveMeEducationAction(id: string | null, input: unknown): Promise<MeEditActionResult> {
  return edit("me_education_save_failed", (userId) => saveMeEducation(userId, id, input));
}

export async function deleteMeEducationAction(id: string): Promise<MeEditActionResult> {
  return edit("me_education_delete_failed", (userId) => deleteMeEducation(userId, id));
}

/** "+ Add story" with `id` null, or Edit on a story. */
export async function saveStoryAction(id: string | null, input: unknown): Promise<MeEditActionResult> {
  return edit("story_save_failed", (userId) => saveStory(userId, id, input));
}

export async function deleteStoryAction(id: string): Promise<MeEditActionResult> {
  return edit("story_delete_failed", (userId) => deleteStory(userId, id));
}

/** Interests' Add. */
export async function addInterestAction(name: string): Promise<MeEditActionResult> {
  return edit("interest_add_failed", (userId) => addInterest(userId, { name }));
}

/** An interest chip's remove ×. */
export async function removeInterestAction(name: string): Promise<MeEditActionResult> {
  return edit("interest_remove_failed", (userId) => removeInterest(userId, { name }));
}
