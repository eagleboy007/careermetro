/**
 * Log-safe facts about a sign-in provider refusal: its error code (such as `otp_expired` or
 * `over_email_send_rate_limit`) and HTTP status, never the message, the email or the code typed.
 */
export function refusalFields(error: unknown): { code: string; status?: number } {
  const e = (error ?? {}) as { code?: unknown; status?: unknown };
  const code = typeof e.code === "string" && /^[a-z0-9_]{1,60}$/.test(e.code) ? e.code : "unknown";
  return typeof e.status === "number" && Number.isInteger(e.status) ? { code, status: e.status } : { code };
}
