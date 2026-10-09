import type { Identity } from "@/lib/account/store";

/** The provider's claims, reduced to what we keep. Null without a subject or an email. */
export function identityFromClaims(claims: { sub?: unknown; email?: unknown; user_metadata?: Record<string, unknown> } | null | undefined): Identity | null {
  if (!claims || typeof claims.sub !== "string" || !claims.sub || typeof claims.email !== "string" || !claims.email) return null;
  const meta = claims.user_metadata ?? {};
  const raw = [meta.full_name, meta.name].find((v): v is string => typeof v === "string" && v.trim().length > 0);
  // Supabase sets email_verified once Google vouches for the email or the emailed code is used.
  return { subject: claims.sub, email: claims.email, emailVerified: meta.email_verified === true, name: raw ? raw.trim().slice(0, 80) : null };
}
