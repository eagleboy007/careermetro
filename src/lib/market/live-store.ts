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
 * Today's open posts with a live role, grouped by role, city and experience note (at most 10,000 open posts, so a
 * few hundred groups); the rollup's state and India rows for the trend's months; its first month; and the last good
 * feed run. All four in parallel.
 */
export async function liveMarketInputs({ db = getDb(), now = new Date() }: { db?: Db; now?: Date } = {}): Promise<LiveInputs> {
  const t = marketOpeningsMonthly;
  // The trend reads at most the last 12 full months; one more covers the month the window starts after. Months are
  // India months (monthOf in ./rollup.mjs), as the rollup writes them.
  const from = `${addMonths(monthOf(now).slice(0, 7), -(TREND_MONTHS + 1))}-01`;
  const [open, rollup, [first], lastRun] = await Promise.all([
    db
      .select({ roleSlug: sql<string>`${jobPosts.roleSlug}`, city: jobPosts.city, experienceNote: jobPosts.experienceNote, posts: count() })
      .from(jobPosts)
      .where(and(isNull(jobPosts.closedAt), isNotNull(jobPosts.roleSlug)))
      .groupBy(jobPosts.roleSlug, jobPosts.city, jobPosts.experienceNote),
    db
      .select({ month: sql<string>`${t.month}::text`, roleSlug: t.roleSlug, state: t.state, band: t.band, newPosts: t.newPosts })
      .from(t)
      .where(and(isNull(t.city), gte(t.month, from))),
    db.select({ month: sql<string | null>`min(${t.month})::text` }).from(t),
    lastFeedRun(db),
  ]);
  return { open, rollup, firstMonth: first?.month ?? null, lastRun };
}
