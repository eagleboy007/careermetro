/** Thrown by withinLimit when the work hasn't settled in time. */
export class TimeLimitError extends Error {
  constructor(ms: number) {
    super(`Did not finish within ${ms} ms.`);
    this.name = "TimeLimitError";
  }
}

/**
 * The work's answer, or a TimeLimitError once `ms` pass first (T122). The timer is always cleared. Work that settles
 * after the limit is ignored, so its late rejection is never unhandled. It is not cancelled: database reads raced here
 * carry their own statement_timeout, which ends them on the server.
 */
export async function withinLimit<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const limit = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new TimeLimitError(ms)), ms);
  });
  try {
    return await Promise.race([work, limit]);
  } finally {
    clearTimeout(timer);
    void work.catch(() => {});
  }
}

/**
 * Why a bounded read failed, as one log-safe word: "timeout" for withinLimit's own limit (waiting for a pooled
 * connection, say), "statement_timeout" (Postgres 57014) and "lock_timeout" (55P03) for the server's limits, "missing"
 * for an undefined table (42P01), otherwise "error". Drizzle wraps the driver's error, so the code may be on `cause`.
 */
export function failureReason(error: unknown): "timeout" | "statement_timeout" | "lock_timeout" | "missing" | "error" {
  if (error instanceof TimeLimitError) return "timeout";
  const e = error as { code?: unknown; cause?: { code?: unknown } } | null;
  const code = e?.code ?? e?.cause?.code;
  if (code === "57014") return "statement_timeout";
  if (code === "55P03") return "lock_timeout";
  if (code === "42P01") return "missing";
  return "error";
}
