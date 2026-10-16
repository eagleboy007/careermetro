import { testSignInEnabled } from "@/lib/auth/test-user";
import { emailReady } from "@/lib/email/send";
import { workEmailReady } from "./codes";
import type { CodeDelivery } from "./types";

type Env = Record<string, string | undefined>;

/**
 * How a work-email code reaches the person (dev/corporate-plan.md, "Two more calls"; launch readiness item 11):
 * - with the test sign-in on (previews without Supabase keys) or on a local copy, the code shows on screen, marked
 *   "Test mode";
 * - elsewhere, production included, by email once the sender is set up (RESEND_API_KEY and EMAIL_FROM,
 *   src/lib/email/send.ts);
 * - otherwise "off": company sign-up says "Company sign-up opens soon." and nothing is sent.
 * Without the work-email key (NAME_HASH_KEY in production) codes can't be hashed, so it is always "off".
 */
export function codeDelivery(env: Env = process.env): CodeDelivery {
  if (!workEmailReady(env)) return "off";
  const local = !env.VERCEL_ENV && env.NODE_ENV !== "production";
  if (env.VERCEL_ENV !== "production" && (testSignInEnabled(env) || local)) return "test";
  return emailReady(env) ? "email" : "off";
}
