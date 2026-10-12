import { testSignInEnabled } from "@/lib/auth/test-user";
import type { CodeDelivery } from "./types";

type Env = Record<string, string | undefined>;

/**
 * How a work-email code reaches the person (dev/corporate-plan.md, "Two more calls"). There is no email sender yet
 * (pending item 21), so:
 * - with the test sign-in on (previews without Supabase keys) or on a local copy, the code shows on screen, marked
 *   "Test mode";
 * - everywhere else, production included, company sign-up says "Company sign-up opens soon." and nothing is sent.
 * When src/lib/email/send.ts gets a provider, "email" goes here for the deployments that have it.
 */
export function codeDelivery(env: Env = process.env): CodeDelivery {
  if (env.VERCEL_ENV === "production") return "off";
  const local = !env.VERCEL_ENV && env.NODE_ENV !== "production";
  return testSignInEnabled(env) || local ? "test" : "off";
}
