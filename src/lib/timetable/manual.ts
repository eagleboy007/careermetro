import { feedEventRow, manualEvent, manualEventsFile, manualKey, type EventTopic, type FeedEventRow, type ManualEvent, type ManualEventAdminRow } from "@/lib/schemas";
import { EVENT_FEED_AHEAD_DAYS, EVENT_MANUAL_FEED_ID, EVENT_MANUAL_MAX, EVENT_MANUAL_SOURCE, EVENT_TOPICS_MAX, EVENT_STATUSES } from "@/lib/schemas/constants";
import { noDrops, type FeedRead } from "./feed";
import { topicsOf, type TopicMatchers } from "./match";

/*
 * Hand-entered events (docs/plans/timetable-plan.md section 6, docs/timetable-sources.md). The team types events from
 * organisers' own pages into src/content/manual-events.json in a PR; the daily event feed loads them on every run as a
 * source that is always on and makes no network call. Each becomes an admin suggestion already checked: source
 * "suggestion", source_key "manual:<title slug>-<India start date>", live. The file's skill topics are kept as written,
 * and the interest topics the matcher finds in the title are added, so "AI" interests match too. dateEvidence never
 * leaves the content file, and nothing here logs event text.
 */

const DAY_MS = 86_400_000;

/** One hand-entered event as the feed job writes it, or the reason it is left out this run. */
export function manualRow(e: ManualEvent, now: Date, matchers?: TopicMatchers): FeedEventRow | "past" | "too_far" | "invalid" {
  const startsAt = new Date(e.startsAt);
  const endsAt = new Date(e.endsAt);
  if (endsAt.getTime() < now.getTime()) return "past";
  if (startsAt.getTime() > now.getTime() + EVENT_FEED_AHEAD_DAYS * DAY_MS) return "too_far";
  const skillTopics: EventTopic[] = e.topics.map((topic) => ({ kind: "skill", topic }));
  const interests = topicsOf(e.title, "", matchers).filter((t) => t.kind === "interest");
  const checked = feedEventRow.safeParse({
    sourceKey: manualKey(e),
    sourceUrl: e.sourceUrl,
    title: e.title,
    organiser: e.organiser,
    kind: e.kind,
    startsAt,
    endsAt,
    online: e.online,
    city: e.city,
    venue: e.venue,
    cost: e.cost,
    topics: [...skillTopics, ...interests].slice(0, EVENT_TOPICS_MAX),
  });
  return checked.success ? checked.data : "invalid";
}

/**
 * The hand-entered file as one feed run. `complete` only when the whole file parsed (each event valid, each key once),
 * so the store cancels a live event still ahead that was taken out of the file only then; a file that fails as a whole
 * still loads the entries that pass on their own, and cancels nothing. Not a list at all: nothing is read.
 */
export function readManual(raw: unknown, { now = new Date(), matchers }: { now?: Date; matchers?: TopicMatchers } = {}): FeedRead {
  const dropped = noDrops();
  const base = { feedId: EVENT_MANUAL_FEED_ID, source: EVENT_MANUAL_SOURCE, dropped };
  if (!Array.isArray(raw)) return { ...base, ok: false, complete: false, error: "invalid", rows: [], listed: 0 };
  const whole = manualEventsFile.safeParse(raw);
  let entries: ManualEvent[];
  if (whole.success) entries = whole.data;
  else {
    entries = [];
    const seen = new Set<string>();
    for (const item of raw.slice(0, EVENT_MANUAL_MAX)) {
      const one = manualEvent.safeParse(item);
      if (!one.success || seen.has(manualKey(one.data))) {
        dropped.invalid++;
        continue;
      }
      seen.add(manualKey(one.data));
      entries.push(one.data);
    }
    dropped.capped += Math.max(0, raw.length - EVENT_MANUAL_MAX);
  }
  const rows: FeedEventRow[] = [];
  for (const e of entries) {
    const row = manualRow(e, now, matchers);
    if (typeof row === "string") dropped[row]++;
    else rows.push(row);
  }
  return { ...base, ok: true, complete: whole.success, error: whole.success ? null : "invalid", rows, listed: raw.length };
}

type Status = (typeof EVENT_STATUSES)[number];

/**
 * The hand-entered list on /admin/reports: every event in the file that parses, soonest first, with its link, the day
 * its date was checked and its state: the events row's status when there is one, "over" once it has ended, and
 * "waiting" until the next daily run loads it. dateEvidence is not part of it.
 */
export function manualAdminRows(raw: unknown, statusOf: ReadonlyMap<string, Status>, now: Date = new Date()): ManualEventAdminRow[] {
  const items = Array.isArray(raw) ? raw.slice(0, EVENT_MANUAL_MAX) : [];
  const rows: ManualEventAdminRow[] = [];
  for (const item of items) {
    const one = manualEvent.safeParse(item);
    if (!one.success) continue;
    const e = one.data;
    const key = manualKey(e);
    const status = statusOf.get(key);
    const over = Date.parse(e.endsAt) < now.getTime();
    rows.push({
      key,
      title: e.title,
      organiser: e.organiser,
      startsAt: e.startsAt,
      endsAt: e.endsAt,
      online: e.online,
      city: e.city,
      sourceUrl: e.sourceUrl,
      checkedOn: e.checkedOn,
      state: over ? "over" : (status ?? "waiting"),
    });
  }
  return rows.sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt) || a.key.localeCompare(b.key));
}

/** The source keys of the file's events, for reading their rows. */
export function manualKeys(raw: unknown): string[] {
  const items = Array.isArray(raw) ? raw.slice(0, EVENT_MANUAL_MAX) : [];
  return items.flatMap((item) => {
    const one = manualEvent.safeParse(item);
    return one.success ? [manualKey(one.data)] : [];
  });
}
