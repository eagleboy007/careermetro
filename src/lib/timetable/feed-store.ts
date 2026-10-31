import "server-only";
import { and, eq, gt, inArray, isNull, like, lt, or, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { events, eventTopics } from "@/db/schema";
import type { FeedRead } from "./feed";

type Db = ReturnType<typeof getDb>;

/** Rows written per statement: well under Postgres's 65,535 parameters. */
const CHUNK = 200;
/** A feed id is a slug (eventFeedId), so it holds no LIKE wildcard. */
const FEED_ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/**
 * Writes one run of the event feed in a single transaction (docs/plans/timetable-plan.md section 6):
 * - every kept event is upserted by (`feed`, source_key): a new one starts live; a seen one takes the feed's latest
 *   summary, is live again if it had been cancelled, and stays hidden if an admin hid it; checked_at is the run's time;
 * - its topics are replaced with the ones found this run;
 * - for each feed read whole (`complete`) that kept at least one event, its live events still ahead that this run
 *   didn't see are cancelled. A feed that failed, was cut short or kept nothing cancels nothing, so an outage never
 *   empties the timetable. Events that have started are left alone: an "upcoming" feed drops them once they begin.
 * Counts only come back; nothing is logged here.
 */
export async function writeFeedRun(
  reads: readonly FeedRead[],
  { startedAt, now = new Date() }: { startedAt: Date; now?: Date },
  db: Db = getDb(),
): Promise<{ upserted: number; cancelled: number; topics: number }> {
  const rows = reads.flatMap((r) => (r.ok ? r.rows : []));
  return db.transaction(async (tx) => {
    let upserted = 0;
    let topics = 0;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const chunk = rows.slice(i, i + CHUNK);
      const saved = await tx
        .insert(events)
        .values(
          chunk.map((r) => ({
            source: "feed" as const,
            sourceKey: r.sourceKey,
            sourceUrl: r.sourceUrl,
            title: r.title,
            organiser: r.organiser,
            kind: r.kind,
            startsAt: r.startsAt,
            endsAt: r.endsAt,
            online: r.online,
            city: r.city,
            venue: r.venue,
            cost: r.cost,
            status: "live" as const,
            checkedAt: now,
            createdAt: now,
            updatedAt: now,
          })),
        )
        .onConflictDoUpdate({
          target: [events.source, events.sourceKey],
          set: {
            sourceUrl: sql`excluded.source_url`,
            title: sql`excluded.title`,
            organiser: sql`excluded.organiser`,
            kind: sql`excluded.kind`,
            startsAt: sql`excluded.starts_at`,
            endsAt: sql`excluded.ends_at`,
            online: sql`excluded.online`,
            city: sql`excluded.city`,
            venue: sql`excluded.venue`,
            cost: sql`excluded.cost`,
            status: sql`case when ${events.status} = 'hidden' then 'hidden' else 'live' end`,
            checkedAt: now,
            updatedAt: now,
          },
        })
        .returning({ id: events.id, sourceKey: events.sourceKey });
      upserted += saved.length;
      const idOf = new Map(saved.map((s) => [s.sourceKey, s.id]));
      const ids = saved.map((s) => s.id);
      if (ids.length) await tx.delete(eventTopics).where(inArray(eventTopics.eventId, ids));
      const topicRows = chunk.flatMap((r) => {
        const eventId = idOf.get(r.sourceKey);
        return eventId ? r.topics.map((t) => ({ eventId, kind: t.kind, topic: t.topic })) : [];
      });
      for (let j = 0; j < topicRows.length; j += 1000) {
        const part = topicRows.slice(j, j + 1000);
        await tx.insert(eventTopics).values(part).onConflictDoNothing();
        topics += part.length;
      }
    }
    let cancelled = 0;
    for (const read of reads) {
      if (!read.ok || !read.complete || !read.rows.length || !FEED_ID.test(read.feedId)) continue;
      const gone = await tx
        .update(events)
        .set({ status: "cancelled", updatedAt: now })
        .where(
          and(
            eq(events.source, "feed"),
            like(events.sourceKey, `${read.feedId}:%`),
            eq(events.status, "live"),
            gt(events.startsAt, now),
            or(isNull(events.checkedAt), lt(events.checkedAt, startedAt)),
          ),
        )
        .returning({ id: events.id });
      cancelled += gone.length;
    }
    return { upserted, cancelled, topics };
  });
}
