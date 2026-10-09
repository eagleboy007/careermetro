import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies, headers } from "next/headers";
import { cache } from "react";
import { findAccount, type Account, type Identity } from "@/lib/account/store";
import { identityFromClaims } from "./claims";
import { authConfig, hasAuthCookie } from "./config";

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
  const jar = await cookies();
  if (!hasAuthCookie(jar.getAll().map((c) => c.name))) return null;
  const supabase = await client();
  if (!supabase) return null;
  const { data } = await supabase.auth.getClaims();
  return identityFromClaims(data?.claims);
});

/** Our user for the signed-in person, or null when signed out or before they finish sign-up. */
export const currentAccount = cache(async (): Promise<Account | null> => {
  const identity = await currentIdentity();
  return identity ? findAccount(identity.subject) : null;
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

/** Emails a 6-digit code (and a link to /auth/callback). Creates the provider's user on first use. */
export async function sendEmailCode(email: string, origin: string, next: string): Promise<AuthStep> {
  const supabase = await client();
  if (!supabase) return { ok: false, reason: "not_configured" };
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: true, emailRedirectTo: `${origin}/auth/callback?next=${encodeURIComponent(next)}` },
  });
  return error ? { ok: false, reason: "rejected" } : { ok: true };
}

/** Checks the emailed code and, when right, sets the session cookies. */
export async function verifyEmailCode(email: string, code: string): Promise<AuthStep> {
  const supabase = await client();
  if (!supabase) return { ok: false, reason: "not_configured" };
  const { error } = await supabase.auth.verifyOtp({ email, token: code, type: "email" });
  return error ? { ok: false, reason: "rejected" } : { ok: true };
}

/** Finishes a Google redirect (`code`) or an email link (`token_hash`). */
export async function completeRedirect(params: URLSearchParams): Promise<AuthStep> {
  const supabase = await client();
  if (!supabase) return { ok: false, reason: "not_configured" };
  const code = params.get("code");
  const tokenHash = params.get("token_hash");
  const type = params.get("type");
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    return error ? { ok: false, reason: "rejected" } : { ok: true };
  }
  if (tokenHash && (type === "email" || type === "magiclink" || type === "signup")) {
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
    return error ? { ok: false, reason: "rejected" } : { ok: true };
  }
  return { ok: false, reason: "rejected" };
}

/** Ends the session on this device and clears its cookies. */
export async function signOut(): Promise<void> {
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
