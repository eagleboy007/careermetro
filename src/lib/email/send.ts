import "server-only";
import { logEvent } from "@/lib/log";

/*
 * The one place the app sends its own email (dev/corporate-plan.md, "Two more calls"; launch readiness item 11).
 * Sign-in codes go through Supabase Auth instead (src/lib/auth). Work-email codes (company sign-up, joining, the
 * 180-day re-check and the current-job check) go out here through Resend's HTTP API, once RESEND_API_KEY and
 * EMAIL_FROM are set (dev/email-sender-steps.md). Without them every message is refused as "not_configured" and
 * callers decide what to show. Never log the address, the subject or the body: they hold personal data and one-time
 * codes. Only the outcome, Resend's status code and its error name (a fixed code such as rate_limit_exceeded) are logged.
 */

type Env = Record<string, string | undefined>;

/**
 * One email. `html` goes with the plain text, never instead of it; `headers` adds headers such as List-Unsubscribe;
 * `from` replaces EMAIL_FROM (the weekly email comes from hello@ on the same domain, weeklyFrom).
 */
export type EmailMessage = {
  to: string;
  subject: string;
  text: string;
  html?: string;
  headers?: Record<string, string>;
  from?: string;
  /** Resend's Idempotency-Key request header: the same key within 24 hours sends at most once (the weekly email's weekly-<userId>-<week>). */
  idempotencyKey?: string;
};

/**
 * Why a send didn't go (T151):
 * - "limited": Resend's per-second rate limit (429 rate_limit_exceeded) still held after a few short waits; this one
 *   email didn't go, and a batch may go on.
 * - "quota": Resend's daily or monthly quota is spent (429 daily_quota_exceeded or monthly_quota_exceeded); a batch
 *   stops, and the next day picks up.
 * - "failed": anything else. `maybeSent` when Resend may have sent it anyway (a timeout, a network error, a 5xx, or a
 *   409 about the idempotency key), so a caller must not send it again without the same idempotency key.
 */
export type SendResult = { ok: true } | { ok: false; reason: "not_configured" | "failed" | "limited" | "quota"; maybeSent?: true };

const RESEND_URL = "https://api.resend.com/emails";
const SEND_TIMEOUT_MS = 10_000;
/** Tries in all when Resend answers 429 for its per-second rate limit, with a short wait between. */
const RATE_TRIES = 3;
const RATE_PAUSE_MS = 1_000;
const MAX_PAUSE_MS = 2_000;
/** Resend's 429 error names for a spent quota (resend.com/docs/api-reference/errors); any other 429 is its rate limit. */
const QUOTA_ERRORS = new Set(["daily_quota_exceeded", "monthly_quota_exceeded"]);

/** Resend's error name from a refusal's JSON body ({ statusCode, message, name }), when it is a plain error code. */
async function errorName(res: Response): Promise<string | null> {
  try {
    const body = (await res.json()) as { name?: unknown } | null;
    return typeof body?.name === "string" && /^[a-z_]{1,64}$/.test(body.name) ? body.name : null;
  } catch {
    return null;
  }
}

/** The wait before trying again after a rate-limit 429: its retry-after seconds when given, at most MAX_PAUSE_MS. */
function pauseAfter(res: Response): number {
  const seconds = Number(res.headers.get("retry-after"));
  return Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds * 1000, MAX_PAUSE_MS) : RATE_PAUSE_MS;
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

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

/**
 * Sends one email through Resend: plain text, with HTML too when given. Never throws. A 429 for Resend's per-second
 * rate limit is tried again after a short wait, up to RATE_TRIES in all, with the same idempotency key; a spent daily
 * or monthly quota is "quota" at once. Logs only the outcome, Resend's status code and its error name.
 */
export async function sendEmail(
  message: EmailMessage,
  env: Env = process.env,
  deps: { fetch?: typeof fetch; timeoutMs?: number; sleep?: (ms: number) => Promise<void> } = {},
): Promise<SendResult> {
  if (!emailReady(env)) return { ok: false, reason: "not_configured" };
  const doFetch = deps.fetch ?? fetch;
  const sleep = deps.sleep ?? wait;
  const body = JSON.stringify({
    from: message.from ?? env.EMAIL_FROM!.trim(),
    to: [message.to],
    subject: message.subject,
    text: message.text,
    ...(message.html ? { html: message.html } : {}),
    ...(message.headers ? { headers: message.headers } : {}),
  });
  const headers: Record<string, string> = { Authorization: `Bearer ${env.RESEND_API_KEY!.trim()}`, "Content-Type": "application/json" };
  if (message.idempotencyKey) headers["Idempotency-Key"] = message.idempotencyKey;
  for (let attempt = 1; ; attempt++) {
    let res: Response;
    try {
      res = await doFetch(RESEND_URL, { method: "POST", headers, body, signal: AbortSignal.timeout(deps.timeoutMs ?? SEND_TIMEOUT_MS), cache: "no-store" });
    } catch (error) {
      logEvent("warn", "email_send_failed", { kind: error instanceof Error ? error.name : "unknown" });
      // A timeout can come after Resend accepted the email.
      return { ok: false, reason: "failed", maybeSent: true };
    }
    if (res.ok) return { ok: true };
    const name = await errorName(res);
    logEvent("warn", "email_send_refused", { status: res.status, ...(name ? { error: name } : {}), attempt });
    if (res.status === 429) {
      if (name && QUOTA_ERRORS.has(name)) return { ok: false, reason: "quota" };
      if (attempt < RATE_TRIES) {
        await sleep(pauseAfter(res));
        continue;
      }
      return { ok: false, reason: "limited" };
    }
    // A server error, or a 409 about the idempotency key (the same key still in flight, or used for other content).
    if (res.status >= 500 || res.status === 409) return { ok: false, reason: "failed", maybeSent: true };
    return { ok: false, reason: "failed" };
  }
}
