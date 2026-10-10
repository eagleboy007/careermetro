/**
 * A small in-memory counter per key over a rolling window, for abuse that never reaches the database (a failed
 * file read, a waitlist post). It is per server instance, so it caps a flood from one place rather than counting
 * exactly; durable limits live in the database.
 */
export function windowLimiter(max: number, windowMs: number, maxKeys = 10_000) {
  const hits = new Map<string, number[]>();
  return {
    /** Counts one hit for `key` and says whether it is still within the limit. */
    take(key: string, now = Date.now()): boolean {
      const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
      const allowed = recent.length < max;
      if (allowed) recent.push(now);
      hits.delete(key);
      hits.set(key, recent);
      // Forget the oldest keys first, so memory stays bounded.
      while (hits.size > maxKeys) hits.delete(hits.keys().next().value!);
      return allowed;
    },
    /** Whether `key` has hits left, without counting one. */
    allows(key: string, now = Date.now()): boolean {
      return (hits.get(key) ?? []).filter((t) => now - t < windowMs).length < max;
    },
  };
}
