import "server-only";
import { asc, desc, eq, lt } from "drizzle-orm";
import { getDb } from "@/db";
import { eventRsvps, events, eventsDigests, userSettings } from "@/db/schema";
import { DEFAULT_TIMETABLE_SETTINGS } from "@/lib/schemas";

type Db = ReturnType<typeof getDb>;

/**
 * Timetable in Download your data (from export version 36): the radius, Include online and the digest choice (the
 * defaults until the person saves some), the India week the digest last went out, and the person's own Save and I'm
 * going rows with each event's title, organiser, start and link. Nobody else's rows; nothing the digest said is kept.
 */
export async function exportTimetable(userId: string, db: Db = getDb()) {
  const [[settings], [digest], rsvps] = await Promise.all([
    db
      .select({ radiusKm: userSettings.eventsRadiusKm, online: userSettings.eventsOnline, digest: userSettings.eventsDigest })
      .from(userSettings)
      .where(eq(userSettings.userId, userId)),
    db.select({ week: eventsDigests.week }).from(eventsDigests).where(eq(eventsDigests.userId, userId)).orderBy(desc(eventsDigests.week)).limit(1),
    db
      .select({
        title: events.title,
        organiser: events.organiser,
        startsAt: events.startsAt,
        sourceUrl: events.sourceUrl,
        state: eventRsvps.state,
        goalSkillId: eventRsvps.goalSkillId,
        createdAt: eventRsvps.createdAt,
      })
      .from(eventRsvps)
      .innerJoin(events, eq(events.id, eventRsvps.eventId))
      .where(eq(eventRsvps.userId, userId))
      .orderBy(asc(eventRsvps.createdAt), asc(events.startsAt)),
  ]);
  return {
    settings: settings ?? { ...DEFAULT_TIMETABLE_SETTINGS },
    lastDigestWeek: digest?.week ?? null,
    rsvps,
  };
}

/** Daily cleanup: digest rows over 90 days old, as the weekly email's are. */
export async function clearOldEventsDigests(db: Db = getDb(), now = new Date()): Promise<{ eventsDigestRowsCleared: number }> {
  const gone = await db
    .delete(eventsDigests)
    .where(lt(eventsDigests.sentAt, new Date(now.getTime() - 90 * 86_400_000)))
    .returning({ week: eventsDigests.week });
  return { eventsDigestRowsCleared: gone.length };
}
