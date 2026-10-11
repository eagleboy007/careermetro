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

/**
 * True for a failure worth one more try: rate limited (429), overloaded (529), a server error (5xx), or a dropped
 * connection. Not a timeout, which already spent its time, nor a 4xx the request itself caused.
 */
export function isTransient(error: unknown): boolean {
  if (error instanceof APIConnectionTimeoutError || error instanceof APIUserAbortError) return false;
  if (error instanceof APIConnectionError) return true;
  if (error instanceof APIError) return error.status === 408 || error.status === 429 || (error.status ?? 0) >= 500;
  return false;
}

/** Waits before a retry: 300 to 900 ms, spread so callers that failed together don't retry together. */
export const retryPause = (random = Math.random) => 300 + Math.floor(random() * 600);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Runs a model call with at most one retry, and only for a transient failure with at least minRetryMs of the budget
 * left after the pause. Each attempt gets what is left of budgetMs as its timeout. onError sees every failed attempt
 * (for the ai_calls log); the last error is thrown if no attempt succeeds.
 */
export async function withOneRetry<T>(
  run: (timeoutMs: number) => Promise<T>,
  { budgetMs, minRetryMs, onError, pause = sleep }: {
    budgetMs: number;
    minRetryMs: number;
    onError: (error: unknown, latencyMs: number) => void;
    pause?: (ms: number) => Promise<unknown>;
  },
): Promise<T> {
  const deadline = Date.now() + budgetMs;
  for (let attempt = 1; ; attempt++) {
    const started = Date.now();
    try {
      return await run(Math.max(1_000, deadline - started));
    } catch (error) {
      onError(error, Date.now() - started);
      const wait = retryPause();
      if (attempt > 1 || !isTransient(error) || deadline - Date.now() - wait < minRetryMs) throw error;
      await pause(wait);
    }
  }
}
