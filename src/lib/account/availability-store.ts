import "server-only";
import { eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import type { Tx } from "@/db/lock";
import { userSettings } from "@/db/schema";
import { DEFAULT_SETTINGS, usuallyFreeInput } from "@/lib/schemas";
import { LIMITS, takeShared } from "@/lib/shared-limit";

/*
 * Usually free (docs/plans/settings-columns-plan.md, v44 gap item 31, FR-55), saved from the Inbox apart from the
 * settings form. Owner only: every read and write is the signed-in person's own row. Private: it never leaves the
 * person's own pages, is never logged and never reaches a company; it only pre-ticks open times in "Ask for times".
 */

type Db = ReturnType<typeof getDb>;
type Deps = { db?: Db; now?: Date };

export type AvailabilityError = "invalid" | "limit";
export type AvailabilityResult = { ok: true; usuallyFree: string[] } | { ok: false; error: AvailabilityError };

export const AVAILABILITY_MESSAGES: Record<AvailabilityError, string> = {
  invalid: "That didn't work. Please refresh the page and try again.",
  limit: "That's as many changes as we allow in a day. Try again tomorrow.",
};

/** The person's Usually free hours, "mon 17:00", Monday first; none until they save some. */
export async function usuallyFreeFor(userId: string, db: Db | Tx = getDb()): Promise<string[]> {
  const [row] = await db.select({ slots: userSettings.usuallyFree }).from(userSettings).where(eq(userSettings.userId, userId)).limit(1);
  return row?.slots ?? [];
}

/**
 * Saves the whole grid at once for the person's own row, under a per-person lock, counting the try against the day's
 * 30 saves. A first save makes the settings row with a new user's other defaults, as the job search switch does.
 */
export async function saveUsuallyFree(userId: string, raw: unknown, deps: Deps = {}): Promise<AvailabilityResult> {
  const db = deps.db ?? getDb();
  const now = deps.now ?? new Date();
  const input = usuallyFreeInput.safeParse(raw);
  if (!input.success) return { ok: false, error: "invalid" };
  return db.transaction(async (tx): Promise<AvailabilityResult> => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`cm-availability:${userId}`}))`);
    if (!(await takeShared(LIMITS.availabilityPerUserDay, userId, { db: tx, now: now.getTime() }))) return { ok: false, error: "limit" };
    const { visibility, ...rest } = DEFAULT_SETTINGS;
    const patch = { usuallyFree: input.data, updatedAt: now };
    const [row] = await tx
      .insert(userSettings)
      .values({ userId, profileVisibility: visibility, ...rest, ...patch })
      .onConflictDoUpdate({ target: userSettings.userId, set: patch })
      .returning({ slots: userSettings.usuallyFree });
    return { ok: true, usuallyFree: row?.slots ?? input.data };
  });
}

/** For "Download your data": the Usually free hours as stored (none with no row). */
export async function exportAvailability(userId: string, db: Db = getDb()) {
  return { usuallyFree: await usuallyFreeFor(userId, db) };
}
