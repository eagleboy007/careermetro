import "server-only";

/*
 * The one place the app sends its own email (dev/corporate-plan.md, "Two more calls"). Sign-in codes go through
 * Supabase Auth instead (src/lib/auth). No sender is set up yet (pending item 21), so every message is refused as
 * "not_configured" and callers decide what to show. Never log the address or the body: they hold personal data and
 * one-time codes.
 */

type Env = Record<string, string | undefined>;

export type EmailMessage = { to: string; subject: string; text: string };

export type SendResult = { ok: true } | { ok: false; reason: "not_configured" };

/** Sends one plain-text email. Until a provider is wired in here, nothing is sent. */
export async function sendEmail(message: EmailMessage, env: Env = process.env): Promise<SendResult> {
  void message;
  void env;
  return { ok: false, reason: "not_configured" };
}
