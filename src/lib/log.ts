import { APIConnectionError, APIConnectionTimeoutError, APIError, APIUserAbortError } from "@anthropic-ai/sdk";

/**
 * Structured server logs: one JSON line per event, which Vercel keeps and can search by field. Personal data can't
 * get in by accident: keys must be plain identifiers and a string value must look like an id, code or route
 * (letters, digits and `_ . : / [ ] ( ) = + -`, at most 120 characters). Anything else, such as a name, an email or
 * a sentence quoted from a resume, is written as "[redacted]". The charset is a backstop, not a guarantee: a one-word
 * name or a token passes it, so fields whose names say they hold a person's details or a secret (session, cookie,
 * token, secret, password, email, phone, name, username, handle, headline, pay, salary, lakh) are always
 * redacted, and ids that are logged must never be secrets.
 * Error messages are never logged; use errorFields.
 */
export type LogValue = string | number | boolean | null | undefined;
export type LogFields = Record<string, LogValue>;
type Level = "info" | "warn" | "error";

const SAFE_STRING = /^[A-Za-z0-9_.:/[\]()=+-]{0,120}$/;
const SAFE_KEY = /^[a-z][A-Za-z0-9_]{0,39}$/;
const RESERVED = new Set(["level", "event", "at"]);
const PERSONAL_KEY = /session|cookie|token|secret|password|email|phone|^name$|Name$|username|handle|headline|pay|salary|lakh/i;
export const REDACTED = "[redacted]";

function clean(value: LogValue): LogValue {
  if (typeof value === "string") return SAFE_STRING.test(value) ? value : REDACTED;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "boolean" || value === null || value === undefined) return value;
  return REDACTED;
}

/** The JSON line logEvent writes, without the timestamp; exported for tests. */
export function logLine(level: Level, event: string, fields: LogFields = {}, at = new Date()): string {
  const out: Record<string, LogValue> = { level, event: clean(event), at: at.toISOString() };
  for (const [key, value] of Object.entries(fields)) {
    if (!SAFE_KEY.test(key) || RESERVED.has(key) || value === undefined) continue;
    out[key] = PERSONAL_KEY.test(key) ? REDACTED : clean(value);
  }
  return JSON.stringify(out);
}

export function logEvent(level: Level, event: string, fields?: LogFields): void {
  const line = logLine(level, event, fields);
  if (level === "info") console.log(line);
  else if (level === "warn") console.warn(line);
  else console.error(line);
}

/**
 * Log-safe facts about a thrown value: a fixed label or the error's class name, a database or system code, the
 * Anthropic status, type and request id, and React's digest. Never the message, which can quote query parameters
 * or model input.
 */
export function errorFields(error: unknown): LogFields {
  // Fixed labels, because the production build minifies class names. The timeout class extends the connection one.
  if (error instanceof APIConnectionTimeoutError) return { error: "timeout" };
  if (error instanceof APIUserAbortError) return { error: "aborted" };
  if (error instanceof APIConnectionError) return { error: "connection" };
  if (error instanceof APIError) {
    return { error: "api_error", status: error.status, type: error.type ?? undefined, requestId: error.requestID ?? undefined };
  }
  if (!(error instanceof Error)) return { error: typeof error };
  const cause = error.cause as { code?: unknown } | undefined;
  const code = (error as { code?: unknown }).code ?? cause?.code;
  const digest = (error as { digest?: unknown }).digest;
  return {
    error: error.name,
    code: typeof code === "string" || typeof code === "number" ? String(code) : undefined,
    digest: typeof digest === "string" ? digest : undefined,
  };
}
