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

/**
 * One email. `html` goes with the plain text, never instead of it; `headers` adds headers such as List-Unsubscribe;
 * `from` replaces EMAIL_FROM (the weekly email comes from hello@ on the same domain, weeklyFrom).
 */
export type EmailMessage = { to: string; subject: string; text: string; html?: string; headers?: Record<string, string>; from?: string };

/** "limited" is Resend saying no more for now (429: its rate or daily limit), so a batch should stop rather than go on. */
export type SendResult = { ok: true } | { ok: false; reason: "not_configured" | "failed" | "limited" };

const RESEND_URL = "https://api.resend.com/emails";
const SEND_TIMEOUT_MS = 10_000;

/** "CareerMetro <codes@careermetro.com>" or a bare address; anything else is treated as not set. */
const FROM = /^([^<>\r\n]{1,80} <)?[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+>?$/;

/** Whether this deployment can send email: a Resend key and a sender address. */
export function emailReady(env: Env = process.env): boolean {
  return !!env.RESEND_API_KEY?.trim() && FROM.test(env.EMAIL_FROM?.trim() ?? "");
}

/**
 * The weekly My jobs email's sender (C22): "CareerMetro <hello@…>" on EMAIL_FROM's own domain, which Resend already
 * verified, so no new key or setting is needed. Null when EMAIL_FROM isn't set.
 */
export function weeklyFrom(env: Env = process.env): string | null {
  if (!emailReady(env)) return null;
  const domain = env.EMAIL_FROM!.trim().match(/@([^\s@<>]+)>?$/)?.[1];
  return domain ? `CareerMetro <hello@${domain}>` : null;
}

/** Sends one email through Resend: plain text, with HTML too when given. Never throws: a network error or a refusal is { ok: false, "failed" }. */
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
      body: JSON.stringify({
        from: message.from ?? env.EMAIL_FROM!.trim(),
        to: [message.to],
        subject: message.subject,
        text: message.text,
        ...(message.html ? { html: message.html } : {}),
        ...(message.headers ? { headers: message.headers } : {}),
      }),
      signal: AbortSignal.timeout(deps.timeoutMs ?? SEND_TIMEOUT_MS),
      cache: "no-store",
    });
    if (res.ok) return { ok: true };
    logEvent("warn", "email_send_refused", { status: res.status });
    return { ok: false, reason: res.status === 429 ? "limited" : "failed" };
  } catch (error) {
    logEvent("warn", "email_send_failed", { kind: error instanceof Error ? error.name : "unknown" });
    return { ok: false, reason: "failed" };
  }
}
