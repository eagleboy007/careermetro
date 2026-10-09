"use server";

import { redirect } from "next/navigation";
import { createAccount } from "@/lib/account/store";
import { safeNext } from "@/lib/auth/config";
import { currentIdentity } from "@/lib/auth/server";
import { readSessionId } from "@/lib/session";

export type FinishState = { error: string | null };

/** Creates the account once the person has ticked the age box. Their anonymous analysis moves with them. */
export async function finishSignUp(_: FinishState, formData: FormData): Promise<FinishState> {
  const next = safeNext(String(formData.get("next") ?? ""));
  const identity = await currentIdentity();
  if (!identity) redirect(`/sign-in?next=${encodeURIComponent(next)}`);
  if (formData.get("age") !== "yes") return { error: "Please confirm you are 18 or older to create an account." };
  const name = String(formData.get("name") ?? "").trim().slice(0, 80) || null;
  const result = await createAccount(identity, { name, sessionId: await readSessionId() });
  if (!result.ok) {
    return {
      error:
        result.reason === "email_taken"
          ? "This email already has an account that signs in another way. Please use that way to sign in."
          : "Please sign in with Google or an emailed code to confirm this email first.",
    };
  }
  redirect(next);
}
