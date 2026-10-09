import { and, eq, gt, isNull, type SQL } from "drizzle-orm";
import { resumes } from "@/db/schema";

/** Anonymous resumes are hidden after this long and deleted by the daily cleanup (FR-2). */
export const ANONYMOUS_TTL_HOURS = 24;

/**
 * Who is asking for a resume and everything made from it: a signed-in user, or an anonymous browser session.
 * A signed-in visitor is always the user, never their old session, so signing out on a shared computer hides
 * everything they claimed.
 */
export type Owner = { userId: string; sessionId?: never } | { sessionId: string; userId?: never };

/**
 * The resumes this owner may see. A user sees resumes with their id and no expiry. A session sees only its own
 * unclaimed resumes within 24 hours, hidden even before the daily cleanup deletes them.
 */
export function ownsResume(owner: Owner, now = Date.now()): SQL {
  if (owner.userId !== undefined) return eq(resumes.userId, owner.userId);
  return and(
    eq(resumes.anonymousSessionId, owner.sessionId),
    isNull(resumes.userId),
    gt(resumes.createdAt, new Date(now - ANONYMOUS_TTL_HOURS * 3600_000)),
  )!;
}

/** A stable key for per-owner locks and daily limits. */
export function ownerKey(owner: Owner): string {
  return owner.userId !== undefined ? `u:${owner.userId}` : `s:${owner.sessionId}`;
}
