"use server";

import { refresh } from "next/cache";
import { currentAccount } from "@/lib/auth/server";
import {
  answerRequest,
  cancelInvite,
  CORPORATE_ERROR_TEXT,
  finishCompanySignup,
  finishJoin,
  inviteMember,
  removeMember,
  requestAccess,
  saveCompanyPage,
  startCompanySignup,
  startJoin,
  type Result,
} from "@/lib/corporate/store";
import type { CodeStep, CompanyPageDetails, OrgRole, SignupDetails } from "@/lib/corporate/types";

/*
 * Corporate's server actions (dev/corporate-plan.md, build steps 1 and 2). Each checks who is signed in; the store
 * validates the input with Zod and checks the person's live company role itself. Answers are words to show, never
 * anyone's email address. Nothing here logs input.
 */

const SIGN_IN = "Please sign in again.";

const words = (r: Result): string | null => (r.ok ? null : (r.message ?? CORPORATE_ERROR_TEXT[r.error]));

/** A mutation that changes what Corporate shows: on success the page reloads its data. */
const thenRefresh = (r: Result): string | null => {
  const message = words(r);
  if (!message) refresh();
  return message;
};

export async function startSignupAction(details: SignupDetails): Promise<CodeStep> {
  const account = await currentAccount();
  if (!account) return { ok: false, error: SIGN_IN };
  const r = await startCompanySignup(account.id, details);
  if (!r.ok) return { ok: false, error: words(r)!, ...(r.error === "taken" ? { taken: true } : {}) };
  return r.testCode ? { ok: true, testCode: r.testCode } : { ok: true };
}

/** Makes the company. No refresh: the sign-up form carries on to the company page step itself. */
export async function finishSignupAction(details: SignupDetails, code: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const account = await currentAccount();
  if (!account) return { ok: false, error: SIGN_IN };
  const r = await finishCompanySignup(account.id, { details, code });
  return r.ok ? { ok: true } : { ok: false, error: words(r)! };
}

export async function askForAccessAction(workEmail: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const account = await currentAccount();
  if (!account) return { ok: false, error: SIGN_IN };
  const r = await requestAccess(account.id, { workEmail });
  return r.ok ? { ok: true } : { ok: false, error: words(r)! };
}

export async function savePageAction(page: CompanyPageDetails): Promise<string | null> {
  const account = await currentAccount();
  if (!account) return SIGN_IN;
  return words(await saveCompanyPage(account.id, page));
}

/** The second-admin invite on the sign-up form. No refresh, which would swap the form for "You already have a role". */
export async function inviteSecondAdminAction(workEmail: string): Promise<string | null> {
  const account = await currentAccount();
  if (!account) return SIGN_IN;
  return words(await inviteMember(account.id, { workEmail, role: "admin" }));
}

export async function inviteAction(workEmail: string, role: OrgRole): Promise<string | null> {
  const account = await currentAccount();
  if (!account) return SIGN_IN;
  return thenRefresh(await inviteMember(account.id, { workEmail, role }));
}

export async function cancelInviteAction(inviteId: string): Promise<string | null> {
  const account = await currentAccount();
  if (!account) return SIGN_IN;
  return thenRefresh(await cancelInvite(account.id, { inviteId }));
}

export async function answerRequestAction(requestId: string, answer: OrgRole | "decline"): Promise<string | null> {
  const account = await currentAccount();
  if (!account) return SIGN_IN;
  return thenRefresh(await answerRequest(account.id, { requestId, answer }));
}

export async function removeMemberAction(memberId: string): Promise<string | null> {
  const account = await currentAccount();
  if (!account) return SIGN_IN;
  return thenRefresh(await removeMember(account.id, { memberId }));
}

export async function startJoinAction(workEmail: string): Promise<CodeStep> {
  const account = await currentAccount();
  if (!account) return { ok: false, error: SIGN_IN };
  const r = await startJoin(account.id, { workEmail });
  if (!r.ok) return { ok: false, error: words(r)! };
  return r.testCode ? { ok: true, testCode: r.testCode } : { ok: true };
}

export async function finishJoinAction(workEmail: string, code: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const account = await currentAccount();
  if (!account) return { ok: false, error: SIGN_IN };
  const r = await finishJoin(account.id, { workEmail, code });
  if (!r.ok) return { ok: false, error: words(r)! };
  // Corporate now shows the company.
  refresh();
  return { ok: true };
}
