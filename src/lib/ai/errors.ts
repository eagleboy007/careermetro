import { APIConnectionError, APIConnectionTimeoutError, APIError, APIUserAbortError } from "@anthropic-ai/sdk";

/**
 * A log-safe summary of a failed model call: a fixed label and, for API errors, the HTTP status,
 * error type and request id. Never the message, which could echo input.
 * Labels are fixed strings because the production build minifies the SDK's class names.
 */
export function describeAiError(error: unknown): string {
  if (error instanceof APIConnectionTimeoutError) return "timeout";
  if (error instanceof APIUserAbortError) return "aborted";
  if (error instanceof APIConnectionError) return "connection";
  if (error instanceof APIError) {
    const parts = ["api_error"];
    if (error.status !== undefined) parts.push(`status=${error.status}`);
    if (error.type) parts.push(`type=${error.type}`);
    if (error.requestID) parts.push(`request_id=${error.requestID}`);
    return parts.join(" ");
  }
  return error instanceof Error ? error.name : typeof error;
}
