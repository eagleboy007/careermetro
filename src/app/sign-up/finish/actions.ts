"use server";

import { redirect } from "next/navigation";
import { fullName } from "@/lib/account/name";
import { createAccount, findAccount, NAME_PART_MAX } from "@/lib/account/store";
import { RESTORE_PATH, withNameNotice } from "@/lib/auth/after-sign-in";
import { safeNext } from "@/lib/auth/config";
import { syncCurrentGoals } from "@/lib/goals/store";
import { hasUsableName } from "@/lib/resume/name-match";
import { currentIdentity } from "@/lib/auth/server";
import { readSessionId } from "@/lib/session";

export type FinishState = { error: string | null };

/** Creates the account once the person has ticked the age box. Their anonymous analysis moves with them. */
export async function finishSignUp(_: FinishState, formData: FormData): Promise<FinishState> {
  const next = safeNext(String(formData.get("next") ?? ""));
  const identity = await currentIdentity();
  if (!identity) redirect(`/sign-in?next=${encodeURIComponent(next)}`);
  if ((await findAccount(identity.subject))?.deletionRequestedAt) redirect(RESTORE_PATH);
  if (formData.get("age") !== "yes") return { error: "Please confirm you are 18 or older to create an account." };
  const firstName = fullName(String(formData.get("firstName") ?? ""), null).slice(0, NAME_PART_MAX);
  const lastName = fullName(String(formData.get("lastName") ?? ""), null).slice(0, NAME_PART_MAX);
  const name = fullName(firstName, lastName);
  // The name is how we check a resume is the person's own before it joins the account.
  if (!hasUsableName(firstName)) return { error: "Please add your name as it appears on your resume." };
  const result = await createAccount(identity, { name, firstName, lastName: lastName || null, sessionId: await readSessionId() });
  if (!result.ok) {
    return {
      error:
        result.reason === "email_taken"
          ? "This email already has an account that signs in another way. Please use that way to sign in."
          : "Please sign in with Google or an emailed code to confirm this email first.",
    };
  }
  await syncCurrentGoals(result.account.id);
  redirect(result.refused ? withNameNotice(next) : next);
}
