import { eventFeeds } from "@/content";
import { errorFields, logEvent } from "@/lib/log";
import { hasBearer } from "@/lib/secret";
import { feedSummary, readFeed, type FeedRead } from "@/lib/timetable/feed";
import { writeFeedRun } from "@/lib/timetable/feed-store";

// Each address takes at most 10 seconds and a feed reads a few at once; no address starts after RUN_MS, so the run
// ends well inside this.
export const maxDuration = 60;
const RUN_MS = 40_000;

/**
 * The daily event feed (Timetable PR 4, docs/plans/timetable-plan.md section 6), run by Vercel Cron once a day
 * (vercel.json; the Hobby plan's once-a-day crons). It reads each feed in src/content/event-feeds.json that is on (a
 * feed goes on only once its terms were read; docs/timetable-sources.md), one public GET per address, and upserts the
 * events it keeps by source key, cancelling the ones a complete feed no longer lists. With no feed on it reads
 * nothing. Counts, feed ids and short error codes only in the logs: never an event's title, link or description.
 */
export async function GET(request: Request) {
  if (!hasBearer(request, process.env.CRON_SECRET)) return Response.json({ ok: false }, { status: 401 });
  const feeds = eventFeeds.filter((f) => f.on);
  if (!feeds.length) {
    logEvent("info", "events_feed_skipped", { reason: "no_feed_on", feedsListed: eventFeeds.length });
    return Response.json({ ok: true, feedsOn: 0 });
  }
  const startedAt = new Date();
  const deadline = startedAt.getTime() + RUN_MS;
  try {
    const reads: FeedRead[] = [];
    for (const feed of feeds) reads.push(await readFeed(feed, { now: startedAt, deadline }));
    for (const r of reads) {
      if (r.error) logEvent("warn", "events_feed_source_failed", { source: r.feedId, code: r.error, read: r.ok, complete: r.complete });
    }
    const written = reads.some((r) => r.ok) ? await writeFeedRun(reads, { startedAt }) : { upserted: 0, cancelled: 0, topics: 0 };
    const summary = feedSummary(reads, written);
    logEvent(summary.feedsOk ? "info" : "warn", "events_feed_done", summary);
    return Response.json({ ok: true, ...summary });
  } catch (error) {
    logEvent("error", "events_feed_failed", errorFields(error));
    return Response.json({ ok: false }, { status: 500 });
  }
}
