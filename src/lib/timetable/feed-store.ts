import "server-only";
import { and, eq, gt, inArray, isNull, like, lt, or, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { events, eventTopics } from "@/db/schema";
import { EVENT_MANUAL_SOURCE, EVENT_STATUSES } from "@/lib/schemas/constants";
import type { FeedRead } from "./feed";

type Db = ReturnType<typeof getDb>;

/** Rows written per statement: well under Postgres's 65,535 parameters. */
const CHUNK = 200;
/** A feed id is a slug (eventFeedId), so it holds no LIKE wildcard. */
const FEED_ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/**
 * Writes one run of the event feed in a single transaction (docs/plans/timetable-plan.md section 6):
 * - every kept event is upserted by (source, source_key), its read's source ("feed", or "suggestion" for the
 *   hand-entered events of src/content/manual-events.json): a new one starts live; a seen one takes the feed's latest
 *   summary, is live again if it had been cancelled, and stays hidden if an admin hid it; checked_at is the run's time;
 * - its topics are replaced with the ones found this run;
 * - for each feed read whole (`complete`) that kept at least one event, its live events still ahead that this run
 *   didn't see (same source, source_key starting "<feed id>:") are cancelled. A feed that failed, was cut short or
 *   kept nothing cancels nothing, so an outage never empties the timetable. Events that have started are left alone: an "upcoming" feed drops them once they begin.
 * Counts only come back; nothing is logged here.
 */
export async function writeFeedRun(
  reads: readonly FeedRead[],
  { startedAt, now = new Date() }: { startedAt: Date; now?: Date },
  db: Db = getDb(),
): Promise<{ upserted: number; cancelled: number; topics: number }> {
  const rows = reads.flatMap((r) => (r.ok ? r.rows.map((row) => ({ ...row, source: r.source ?? ("feed" as const) })) : []));
  const keyOf = (source: string, sourceKey: string) => `${source} ${sourceKey}`;
  return db.transaction(async (tx) => {
    let upserted = 0;
    let topics = 0;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const chunk = rows.slice(i, i + CHUNK);
      const saved = await tx
        .insert(events)
        .values(
          chunk.map((r) => ({
            source: r.source,
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
        .returning({ id: events.id, source: events.source, sourceKey: events.sourceKey });
      upserted += saved.length;
      const idOf = new Map(saved.map((s) => [keyOf(s.source, s.sourceKey), s.id]));
      const ids = saved.map((s) => s.id);
      if (ids.length) await tx.delete(eventTopics).where(inArray(eventTopics.eventId, ids));
      const topicRows = chunk.flatMap((r) => {
        const eventId = idOf.get(keyOf(r.source, r.sourceKey));
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
            eq(events.source, read.source ?? "feed"),
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

/**
 * The status of each hand-entered event already loaded, by source key, for the read-only list on /admin/reports (the
 * caller checks the admin). Only rows under the hand-entered source and its "manual:" keys are read.
 */
export async function manualEventStatuses(keys: readonly string[], db: Db = getDb()): Promise<Map<string, (typeof EVENT_STATUSES)[number]>> {
  const wanted = keys.filter((k) => k.startsWith("manual:"));
  if (!wanted.length) return new Map();
  const rows = await db
    .select({ sourceKey: events.sourceKey, status: events.status })
    .from(events)
    .where(and(eq(events.source, EVENT_MANUAL_SOURCE), inArray(events.sourceKey, wanted)));
  return new Map(rows.map((r) => [r.sourceKey, r.status]));
}
