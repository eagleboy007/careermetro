import { APIError } from "@anthropic-ai/sdk";

/**
 * A log-safe summary of a failed model call: the error's name and, for API errors, the HTTP status,
 * error type and request id. Never the message, which could echo input.
 */
export function describeAiError(error: unknown): string {
  if (!(error instanceof Error)) return typeof error;
  // SDK errors keep the name "Error", so the class name is what tells them apart.
  const name = error.name === "Error" && error.constructor.name ? error.constructor.name : error.name;
  const parts = [name];
  if (error instanceof APIError) {
    if (error.status !== undefined) parts.push(`status=${error.status}`);
    if (error.type) parts.push(`type=${error.type}`);
    if (error.requestID) parts.push(`request_id=${error.requestID}`);
  }
  return parts.join(" ");
}
