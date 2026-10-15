import type { Identity } from "@/lib/account/store";
import { testSignInEnabled } from "@/lib/auth/test-user";

/*
 * Who may open CareerMetro's own admin pages (/admin/companies). An account is an admin when its sign-in email is in
 * the ADMIN_EMAILS setting (comma-separated, trimmed, any case) and the sign-in proved that email (Google or an emailed
 * code). Nobody else, and nobody at all while ADMIN_EMAILS is unset in production: Milin adds it in Vercel, so his
 * address is never in the repository.
 *
 * Local and preview test mode only (the "Continue as test user" sign-in, never in production): with ADMIN_EMAILS unset,
 * the test user signed in as LOCAL_ADMIN_EMAIL is the admin, so the browser walk and local runs can use the page. Test
 * users' emails always end in ".test", so they can never match a real address.
 */

type Env = Record<string, string | undefined>;

/** The documented local admin (docs/local-setup.md). Only for the test sign-in, only while ADMIN_EMAILS is unset. */
export const LOCAL_ADMIN_EMAIL = "admin@careermetro.test";

/** ADMIN_EMAILS as a list: lowercase, trimmed, anything without an @ dropped. */
export function adminEmails(env: Env = process.env): string[] {
  return (env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter((e) => e.includes("@"));
}

/** True when this signed-in identity may use the admin pages. Fails closed. */
export function isAdmin(identity: Pick<Identity, "email" | "emailVerified" | "method"> | null | undefined, env: Env = process.env): boolean {
  if (!identity?.email) return false;
  const email = identity.email.trim().toLowerCase();
  const testUser = identity.method === "test";
  if (testUser) {
    // The test sign-in never runs in production; checked again here so a setting mistake can't open the page.
    if (env.VERCEL_ENV === "production" || !testSignInEnabled(env)) return false;
  } else if (!identity.emailVerified) {
    return false;
  }
  const listed = adminEmails(env);
  if (listed.length) return listed.includes(email);
  return testUser && email === LOCAL_ADMIN_EMAIL;
}

/**
 * True when a stored account's email belongs to an admin: listed in ADMIN_EMAILS, or the documented local admin. Only
 * for refusing to suspend an admin's account (FR-46), so it errs towards yes; it never opens anything.
 */
export function isAdminEmail(email: string | null | undefined, env: Env = process.env): boolean {
  if (!email) return false;
  const e = email.trim().toLowerCase();
  return e === LOCAL_ADMIN_EMAIL || adminEmails(env).includes(e);
}
