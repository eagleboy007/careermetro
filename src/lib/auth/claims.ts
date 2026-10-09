import type { Identity } from "@/lib/account/store";

/** Sign-in methods that prove the person controls the email: Google, or the emailed code. A password does not. */
const PROVING_METHODS = new Set(["oauth", "otp"]);

type Claims = { sub?: unknown; email?: unknown; amr?: unknown; user_metadata?: Record<string, unknown> };

/**
 * The provider's claims, reduced to what we keep. Null without a subject or an email. `emailVerified` comes from
 * `amr`, which the provider signs; `user_metadata` is editable by the user, so it is used only for the display name.
 */
export function identityFromClaims(claims: Claims | null | undefined): Identity | null {
  if (!claims || typeof claims.sub !== "string" || !claims.sub || typeof claims.email !== "string" || !claims.email) return null;
  const methods = Array.isArray(claims.amr) ? claims.amr.map((a) => (typeof a === "string" ? a : (a as { method?: unknown })?.method)) : [];
  const meta = claims.user_metadata ?? {};
  const raw = [meta.full_name, meta.name].find((v): v is string => typeof v === "string" && v.trim().length > 0);
  return {
    subject: claims.sub,
    email: claims.email,
    emailVerified: methods.some((m) => typeof m === "string" && PROVING_METHODS.has(m)),
    name: raw ? raw.trim().slice(0, 80) : null,
  };
}
