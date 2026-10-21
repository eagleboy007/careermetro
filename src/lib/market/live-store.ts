import "server-only";
import { and, count, gte, isNotNull, isNull, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { jobPosts, marketOpeningsMonthly } from "@/db/schema";
import { lastFeedRun } from "@/lib/departures/store";
import { TREND_MONTHS, type LiveInputs } from "./live";
import { addMonths, monthOf } from "./rollup.mjs";

/*
 * The reads behind live counts on /market (./live.ts turns them into figures). Read only, counts only: no post title,
 * company, URL or skills leave the database, and nothing here logs.
 */

type Db = ReturnType<typeof getDb>;

/**
 * T122: the server's limit on each live read, so /market can never wait on them for good (a lock on
 * market_openings_monthly, a stuck query). The page races the whole read against MARKET_PAGE_LIMIT_MS, a little longer,
 * which also covers waiting for a pooled connection.
 */
export const MARKET_READ_TIMEOUT_MS = 5000;
/** Shorter than the statement limit, so a lock wait fails as one (55P03) and the log says which it was. */
export const MARKET_LOCK_TIMEOUT_MS = 3000;
/** The page's own limit on the whole read (src/app/(app)/market/page.tsx). */
export const MARKET_PAGE_LIMIT_MS = MARKET_READ_TIMEOUT_MS + 1500;

/** `timeouts` stands in for the limits above in tests; a lockMs of 0 turns the lock limit off. */
type Deps = { db?: Db; now?: Date; timeouts?: { statementMs: number; lockMs: number } };

/**
 * Today's open posts with a live role, grouped by role, city and experience note (at most 10,000 open posts, so a
 * few hundred groups); the rollup's state and India rows for the trend's months; its first month; and the last good
 * feed run. One read-only transaction whose first statements set its limits (SET LOCAL holds for this transaction
 * only, so it works through Supabase's transaction pooler): a read that passes one fails with 57014 (statement) or
 * 55P03 (lock) instead of hanging. The four reads share the transaction's one connection, so they queue there rather
 * than run side by side; they are small, and each has the statement limit to itself.
 */
export async function liveMarketInputs({
  db = getDb(),
  now = new Date(),
  timeouts = { statementMs: MARKET_READ_TIMEOUT_MS, lockMs: MARKET_LOCK_TIMEOUT_MS },
}: Deps = {}): Promise<LiveInputs> {
  const t = marketOpeningsMonthly;
  // The trend reads at most the last 12 full months; one more covers the month the window starts after. Months are
  // India months (monthOf in ./rollup.mjs), as the rollup writes them.
  const from = `${addMonths(monthOf(now).slice(0, 7), -(TREND_MONTHS + 1))}-01`;
  return db.transaction(
    async (tx) => {
      await tx.execute(sql.raw(`set local statement_timeout = ${Math.trunc(timeouts.statementMs)}`));
      await tx.execute(sql.raw(`set local lock_timeout = ${Math.trunc(timeouts.lockMs)}`));
      const [open, rollup, [first], lastRun] = await Promise.all([
        tx
          .select({ roleSlug: sql<string>`${jobPosts.roleSlug}`, city: jobPosts.city, experienceNote: jobPosts.experienceNote, posts: count() })
          .from(jobPosts)
          .where(and(isNull(jobPosts.closedAt), isNotNull(jobPosts.roleSlug)))
          .groupBy(jobPosts.roleSlug, jobPosts.city, jobPosts.experienceNote),
        tx
          .select({ month: sql<string>`${t.month}::text`, roleSlug: t.roleSlug, state: t.state, band: t.band, newPosts: t.newPosts })
          .from(t)
          .where(and(isNull(t.city), gte(t.month, from))),
        tx.select({ month: sql<string | null>`min(${t.month})::text` }).from(t),
        lastFeedRun(tx),
      ]);
      return { open, rollup, firstMonth: first?.month ?? null, lastRun };
    },
    { accessMode: "read only" },
  );
}
