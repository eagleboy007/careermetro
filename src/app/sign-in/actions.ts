"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { afterSignIn } from "@/lib/auth/after-sign-in";
import { safeNext } from "@/lib/auth/config";
import { googleSignInUrl, requestOrigin, sendEmailCode, verifyEmailCode } from "@/lib/auth/server";

export type EmailStep = { stage: "email" | "code"; email: string; error: string | null };

const emailSchema = z.email().max(254);
// Supabase codes are 6 digits by default and can be set up to 10.
const codeSchema = z.string().regex(/^\d{6,10}$/);

/** "Continue with Google": off to Google's consent page. */
export async function continueWithGoogle(formData: FormData): Promise<void> {
  const next = safeNext(String(formData.get("next") ?? ""));
  const url = await googleSignInUrl(await requestOrigin(), next);
  redirect(url ?? `/sign-in?error=google&next=${encodeURIComponent(next)}`);
}

/** The email form: the first submit sends a code, the second checks it. Wrong input never says whether an account exists. */
export async function emailStep(state: EmailStep, formData: FormData): Promise<EmailStep> {
  const next = safeNext(String(formData.get("next") ?? ""));
  if (formData.get("intent") === "restart") return { stage: "email", email: state.email, error: null };

  if (state.stage === "email" || formData.get("intent") === "resend") {
    const parsed = emailSchema.safeParse(String(formData.get("email") ?? state.email).trim().toLowerCase());
    if (!parsed.success) return { stage: "email", email: String(formData.get("email") ?? ""), error: "Please enter a valid email address." };
    const sent = await sendEmailCode(parsed.data);
    if (!sent.ok) {
      return {
        stage: "email",
        email: parsed.data,
        error: sent.reason === "not_configured" ? "Sign-in isn't switched on yet." : "We couldn't send a code just now. Please wait a minute and try again.",
      };
    }
    return { stage: "code", email: parsed.data, error: null };
  }

  const code = codeSchema.safeParse(String(formData.get("code") ?? "").replace(/\s/g, ""));
  if (!code.success) return { ...state, error: "Enter the code from the email, digits only." };
  const verified = await verifyEmailCode(state.email, code.data);
  if (!verified.ok) return { ...state, error: "That code didn't work. It may have expired: ask for a new one." };
  redirect(await afterSignIn(next));
}
