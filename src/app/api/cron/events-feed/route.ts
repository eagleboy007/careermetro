import { eventFeeds, manualEventsJson } from "@/content";
import { errorFields, logEvent } from "@/lib/log";
import { hasBearer } from "@/lib/secret";
import { feedSummary, readFeed, type FeedRead } from "@/lib/timetable/feed";
import { writeFeedRun } from "@/lib/timetable/feed-store";
import { readManual } from "@/lib/timetable/manual";

// Each address takes at most 10 seconds and a feed reads a few at once; no address starts after RUN_MS, so the run
// ends well inside this.
export const maxDuration = 60;
const RUN_MS = 40_000;

/**
 * The daily event feed (Timetable PR 4, docs/plans/timetable-plan.md section 6), run by Vercel Cron once a day
 * (vercel.json; the Hobby plan's once-a-day crons). Every run loads the hand-entered events of
 * src/content/manual-events.json (always on, no network call; src/lib/timetable/manual.ts). Then it reads each feed in
 * src/content/event-feeds.json that is on (a feed goes on only once its terms were read; docs/timetable-sources.md),
 * one public GET per address. It upserts the events it keeps by source key, cancelling the ones a complete feed, or a
 * hand-entered file that parsed whole, no longer lists. Counts, feed ids and short error codes only in the logs: never
 * an event's title, link, description or date evidence.
 */
export async function GET(request: Request) {
  if (!hasBearer(request, process.env.CRON_SECRET)) return Response.json({ ok: false }, { status: 401 });
  const feeds = eventFeeds.filter((f) => f.on);
  const startedAt = new Date();
  const deadline = startedAt.getTime() + RUN_MS;
  try {
    const manual = readManual(manualEventsJson, { now: startedAt });
    if (manual.error) logEvent("warn", "events_feed_source_failed", { source: manual.feedId, code: manual.error, read: manual.ok, complete: manual.complete });
    const reads: FeedRead[] = [];
    for (const feed of feeds) reads.push(await readFeed(feed, { now: startedAt, deadline }));
    for (const r of reads) {
      if (r.error) logEvent("warn", "events_feed_source_failed", { source: r.feedId, code: r.error, read: r.ok, complete: r.complete });
    }
    const all = [manual, ...reads];
    const written = all.some((r) => r.ok && r.rows.length) ? await writeFeedRun(all, { startedAt }) : { upserted: 0, cancelled: 0, topics: 0 };
    const summary = {
      ...feedSummary(reads, written),
      manualListed: manual.listed,
      manualKept: manual.rows.length,
      manualComplete: manual.complete,
      manualDroppedPast: manual.dropped.past,
      manualDroppedInvalid: manual.dropped.invalid,
    };
    const failed = (feeds.length > 0 && summary.feedsOk === 0) || !manual.complete;
    logEvent(failed ? "warn" : "info", "events_feed_done", summary);
    return Response.json({ ok: true, ...summary });
  } catch (error) {
    logEvent("error", "events_feed_failed", errorFields(error));
    return Response.json({ ok: false }, { status: 500 });
  }
}
