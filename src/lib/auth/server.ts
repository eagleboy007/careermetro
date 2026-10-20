import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies, headers } from "next/headers";
import { connection } from "next/server";
import { cache } from "react";
import { findAccount, type Account, type Identity } from "@/lib/account/store";
import { isAdmin } from "@/lib/admin/access";
import { identityFromClaims } from "./claims";
import { logEvent } from "@/lib/log";
import { refusalFields } from "./refusal";
import { signedInPreviewEnabled } from "@/lib/preview";
import { authConfig, hasAuthCookie } from "./config";
import { TEST_USER_COOKIE, testUserIdentity } from "./test-user";

/*
 * The only place that talks to the sign-in provider (Supabase Auth). The rest of the app asks for `currentIdentity`
 * or `currentAccount` and gets our own user back. Moving provider means rewriting this file and `proxy-session.ts`.
 */

async function client() {
  const config = authConfig();
  if (!config) return null;
  const jar = await cookies();
  return createServerClient(config.url, config.anonKey, {
    cookies: {
      getAll: () => jar.getAll(),
      setAll: (list) => {
        try {
          for (const { name, value, options } of list) jar.set(name, value, options);
        } catch {
          // Server components can't set cookies. The proxy refreshes the session before they render.
        }
      },
    },
  });
}

/** Who is signed in with the provider, verified. Null when signed out or when sign-in is not set up. Once per request. */
export const currentIdentity = cache(async (): Promise<Identity | null> => {
  // Sign-in is preview-only until Today runs on real data; production does no auth work at all.
  if (!signedInPreviewEnabled()) return null;
  // Reading the time for the test user's expiry needs a request first.
  await connection();
  const jar = await cookies();
  const testUser = testUserIdentity(jar.get(TEST_USER_COOKIE)?.value);
  if (testUser) return testUser;
  if (!hasAuthCookie(jar.getAll().map((c) => c.name))) return null;
  const supabase = await client();
  if (!supabase) return null;
  const { data } = await supabase.auth.getClaims();
  return identityFromClaims(data?.claims);
});

/** The signed-in person's user, deleted or not. Most code wants `currentAccount`. Once per request. */
export const signedInAccount = cache(async (): Promise<Account | null> => {
  const identity = await currentIdentity();
  return identity ? findAccount(identity.subject) : null;
});

/**
 * True while an admin has this account suspended after a report (FR-46) and the person signed in isn't an admin
 * themselves: admins are never blocked.
 */
export function suspendedFor(account: Pick<Account, "suspendedAt"> | null, identity: Identity | null): boolean {
  return !!account?.suspendedAt && !isAdmin(identity);
}

/**
 * Our user for the signed-in person, or null when signed out, before they finish sign-up, while their account is
 * deleted, or while it is suspended: a deleted account counts as signed out everywhere until it is restored, and a
 * suspended one until the suspension is lifted, so no page or action works for it. The signed-in layout sends either
 * to its notice page.
 */
export const currentAccount = cache(async (): Promise<Account | null> => {
  const account = await signedInAccount();
  if (!account || account.deletionRequestedAt) return null;
  return suspendedFor(account, await currentIdentity()) ? null : account;
});

export type AuthStep = { ok: true } | { ok: false; reason: "not_configured" | "rejected" };

/** The Google consent page to send the browser to. It comes back to /auth/callback. */
export async function googleSignInUrl(origin: string, next: string): Promise<string | null> {
  const supabase = await client();
  if (!supabase) return null;
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: `${origin}/auth/callback?next=${encodeURIComponent(next)}`, skipBrowserRedirect: true },
  });
  return error ? null : data.url;
}

/**
 * Emails a 6-digit code. Creates the provider's user on first use. There is deliberately no sign-in link: a link
 * signs in whoever opens it, so someone could send theirs to another person and collect that person's analysis.
 */
export async function sendEmailCode(email: string): Promise<AuthStep> {
  const supabase = await client();
  if (!supabase) return { ok: false, reason: "not_configured" };
  const { error } = await supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: true } });
  if (!error) return { ok: true };
  // The code and status only, never the email: a refused send is how a wrong SMTP or template setting shows.
  logEvent("warn", "auth_email_code_send_refused", refusalFields(error));
  return { ok: false, reason: "rejected" };
}

/** Checks the emailed code and, when right, sets the session cookies. */
export async function verifyEmailCode(email: string, code: string): Promise<AuthStep> {
  const supabase = await client();
  if (!supabase) return { ok: false, reason: "not_configured" };
  const { error } = await supabase.auth.verifyOtp({ email, token: code, type: "email" });
  if (!error) return { ok: true };
  logEvent("warn", "auth_email_code_verify_refused", refusalFields(error));
  return { ok: false, reason: "rejected" };
}

/**
 * Finishes a Google redirect. The code only works with the verifier cookie this browser got when it started the
 * sign-in (PKCE), so a link made in another browser can't sign this one in.
 */
export async function completeGoogleRedirect(code: string | null): Promise<AuthStep> {
  const supabase = await client();
  if (!supabase) return { ok: false, reason: "not_configured" };
  if (!code) return { ok: false, reason: "rejected" };
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  return error ? { ok: false, reason: "rejected" } : { ok: true };
}

/** Ends the session on this device and clears its cookies. */
export async function signOut(): Promise<void> {
  (await cookies()).delete(TEST_USER_COOKIE);
  const supabase = await client();
  await supabase?.auth.signOut({ scope: "local" });
}

/** This site's origin for the current request, for the provider's return links. */
export async function requestOrigin(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") || host.startsWith("127.0.0.1") ? "http" : "https");
  return `${proto}://${host}`;
}
