import "server-only";
import { logEvent } from "@/lib/log";

/*
 * The one place the app sends its own email (dev/corporate-plan.md, "Two more calls"; launch readiness item 11).
 * Sign-in codes go through Supabase Auth instead (src/lib/auth). Work-email codes (company sign-up, joining, the
 * 180-day re-check and the current-job check) go out here through Resend's HTTP API, once RESEND_API_KEY and
 * EMAIL_FROM are set (dev/email-sender-steps.md). Without them every message is refused as "not_configured" and
 * callers decide what to show. Never log the address, the subject or the body: they hold personal data and one-time
 * codes. Only the outcome and Resend's status code are logged.
 */

type Env = Record<string, string | undefined>;

export type EmailMessage = { to: string; subject: string; text: string };

export type SendResult = { ok: true } | { ok: false; reason: "not_configured" | "failed" };

const RESEND_URL = "https://api.resend.com/emails";
const SEND_TIMEOUT_MS = 10_000;

/** "CareerMetro <codes@careermetro.com>" or a bare address; anything else is treated as not set. */
const FROM = /^([^<>\r\n]{1,80} <)?[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+>?$/;

/** Whether this deployment can send email: a Resend key and a sender address. */
export function emailReady(env: Env = process.env): boolean {
  return !!env.RESEND_API_KEY?.trim() && FROM.test(env.EMAIL_FROM?.trim() ?? "");
}

/** Sends one plain-text email through Resend. Never throws: a network error or a refusal is { ok: false, "failed" }. */
export async function sendEmail(
  message: EmailMessage,
  env: Env = process.env,
  deps: { fetch?: typeof fetch; timeoutMs?: number } = {},
): Promise<SendResult> {
  if (!emailReady(env)) return { ok: false, reason: "not_configured" };
  const doFetch = deps.fetch ?? fetch;
  try {
    const res = await doFetch(RESEND_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY!.trim()}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: env.EMAIL_FROM!.trim(), to: [message.to], subject: message.subject, text: message.text }),
      signal: AbortSignal.timeout(deps.timeoutMs ?? SEND_TIMEOUT_MS),
      cache: "no-store",
    });
    if (res.ok) return { ok: true };
    logEvent("warn", "email_send_refused", { status: res.status });
    return { ok: false, reason: "failed" };
  } catch (error) {
    logEvent("warn", "email_send_failed", { kind: error instanceof Error ? error.name : "unknown" });
    return { ok: false, reason: "failed" };
  }
}
