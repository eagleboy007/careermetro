import "server-only";
import { createHmac } from "node:crypto";
import { ipHashKey } from "@/lib/hash-keys";
import { and, eq, lt, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { rateLimits } from "@/db/schema";
import { errorFields, logEvent } from "@/lib/log";

type Db = ReturnType<typeof getDb>;

/** A limit every server shares (H11): at most `max` hits per key in each fixed window of `windowMs`. */
export type SharedLimit = { bucket: string; max: number; windowMs: number };

const HOUR = 60 * 60 * 1000;

export const LIMITS = {
  /** Sign-in codes emailed to one address. */
  signInCodePerEmail: { bucket: "signin-code-email", max: 5, windowMs: HOUR },
  /** Sign-in codes asked for from one network address, to any addresses. */
  signInCodePerIp: { bucket: "signin-code-ip", max: 20, windowMs: HOUR },
  /** Waitlist sign-ups from one network address: enough for a family on one connection, not for a script. */
  waitlistPerIp: { bucket: "waitlist", max: 10, windowMs: HOUR },
  /** Files that couldn't be read, per network address per day (T18). Generous: a college network shares one address. */
  failedReadsPerIp: { bucket: "failed-read", max: 30, windowMs: 24 * HOUR },
  /** New message requests one person sends to people who aren't connections (dev/inbox-plan.md). */
  inboxRequestsPerUser: { bucket: "inbox-request", max: 20, windowMs: 24 * HOUR },
  /** Reports one person files: each starts IT Rules deadlines, so the grievance queue can't be flooded. */
  inboxReportsPerUser: { bucket: "inbox-report", max: 20, windowMs: 24 * HOUR },
  /** Tries at adding a certificate, whatever the outcome, so names and credential ids can't be guessed at by script. */
  certificateTriesPerUser: { bucket: "certificate-try", max: 30, windowMs: 24 * HOUR },
  /** Work-email codes one person asks for (handoff 12d): 3 an hour and 10 a day. */
  workEmailCodePerUserHour: { bucket: "work-email-code-user-hour", max: 3, windowMs: HOUR },
  workEmailCodePerUserDay: { bucket: "work-email-code-user-day", max: 10, windowMs: 24 * HOUR },
  /** Work-email codes to one domain, from anyone, so the sender can't be used to flood a company's mail. */
  workEmailCodePerDomainDay: { bucket: "work-email-code-domain", max: 20, windowMs: 24 * HOUR },
  /** "Ask for access" requests one person sends to companies. */
  corporateRequestsPerUser: { bucket: "corporate-request", max: 5, windowMs: 24 * HOUR },
} satisfies Record<string, SharedLimit>;

/** Rows this much older than their window are deleted by the writes below, now and then. */
const KEEP_MS = 2 * 24 * HOUR;

/** A keyed hash of the email or IP, so the table never holds either. The key is the same one as the client hash. */
const keyHash = (bucket: string, key: string) => createHmac("sha256", ipHashKey()).update(`${bucket}|${key}`).digest("base64url");

const windowStart = (limit: SharedLimit, now: number) => new Date(Math.floor(now / limit.windowMs) * limit.windowMs);

/**
 * Counts one hit for `key` and says whether it is still within the limit. One statement adds the hit and returns the
 * new count, so two servers can't both pass the last free hit. Windows are fixed, so a burst across a boundary can
 * reach twice the limit; fine for abuse limits. If the database can't be reached the request is let through and
 * logged: a broken limiter must not lock everyone out.
 */
export async function takeShared(limit: SharedLimit, key: string, deps: { db?: Db; now?: number } = {}): Promise<boolean> {
  const now = deps.now ?? Date.now();
  try {
    const db = deps.db ?? getDb();
    const [row] = await db
      .insert(rateLimits)
      .values({ bucket: limit.bucket, keyHash: keyHash(limit.bucket, key), windowStart: windowStart(limit, now) })
      .onConflictDoUpdate({
        target: [rateLimits.bucket, rateLimits.keyHash, rateLimits.windowStart],
        set: { hits: sql`${rateLimits.hits} + 1` },
      })
      .returning({ hits: rateLimits.hits });
    // Cleanup failing must not turn this answer into a yes, so it is neither awaited nor allowed to throw here.
    if (Math.random() < 0.01)
      db.delete(rateLimits)
        .where(lt(rateLimits.windowStart, new Date(now - KEEP_MS)))
        .catch((error: unknown) => logEvent("error", "rate_limit_cleanup_failed", errorFields(error)));
    return row.hits <= limit.max;
  } catch (error) {
    logEvent("error", "rate_limit_unavailable", { bucket: limit.bucket, ...errorFields(error) });
    return true;
  }
}

/** Whether `key` has hits left in the current window, without counting one. Lets the request through on a database error. */
export async function allowsShared(limit: SharedLimit, key: string, deps: { db?: Db; now?: number } = {}): Promise<boolean> {
  const now = deps.now ?? Date.now();
  try {
    const [row] = await (deps.db ?? getDb())
      .select({ hits: rateLimits.hits })
      .from(rateLimits)
      .where(
        and(
          eq(rateLimits.bucket, limit.bucket),
          eq(rateLimits.keyHash, keyHash(limit.bucket, key)),
          eq(rateLimits.windowStart, windowStart(limit, now)),
        ),
      );
    return (row?.hits ?? 0) < limit.max;
  } catch (error) {
    logEvent("error", "rate_limit_unavailable", { bucket: limit.bucket, ...errorFields(error) });
    return true;
  }
}

/**
 * The key for a per-address limit. An IPv6 address counts by its /64, since one connection is usually given a whole
 * /64 and could step through it to dodge the limit. IPv4 addresses count as they are.
 */
export function addressKey(ip: string): string {
  if (!ip.includes(":")) return ip;
  const [head, tail = ""] = ip.toLowerCase().split("::");
  const front = head ? head.split(":") : [];
  const back = tail ? tail.split(":") : [];
  const groups = ip.includes("::") ? [...front, ...Array(Math.max(0, 8 - front.length - back.length)).fill("0"), ...back] : front;
  return groups.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, "")).join(":") + "::/64";
}
