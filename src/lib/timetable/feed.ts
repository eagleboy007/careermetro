import { decode, USER_AGENT } from "@/lib/departures/feed-rules.mjs";
import { confsTechConference, confsTechFile, feedEventRow, icsEvent, type EventFeed, type FeedEventRow, type PersonCity } from "@/lib/schemas";
import {
  EVENT_FEED_AHEAD_DAYS,
  EVENT_FEED_DROPS,
  EVENT_FEED_EVENTS_MAX,
  EVENT_FEED_LENGTH_MAX_DAYS,
  EVENT_FEED_MAX_BYTES,
  EVENT_FEED_TIMEOUT_MS,
  EVENT_ORGANISER_MAX,
  EVENT_SOURCE_KEY_MAX,
  EVENT_TITLE_MAX,
  PERSON_CITIES,
  type EventKind,
  type EventSource,
} from "@/lib/schemas/constants";
import { topicsOf, type TopicMatchers } from "./match";

/*
 * The event feed (Timetable PR 4, docs/plans/timetable-plan.md section 6). Plain code, no model: each feed listed in
 * src/content/event-feeds.json that is on is read once (public GETs only, with a time limit, a size cap and no
 * redirects), and each event becomes our short summary (title, organiser, kind, time, city or online, the organiser's
 * link) plus the topics the matcher finds in its title and description. The description is read for topics and
 * dropped; nothing here keeps or logs event text. An event is dropped, and counted, when it is cancelled, over, too far
 * ahead, too long, outside India and not online, has no topic, or fails the row's checks.
 */

export type FeedDrop = (typeof EVENT_FEED_DROPS)[number];
export type FeedDrops = Record<FeedDrop, number>;
export type FeedRows = { ok: boolean; rows: FeedEventRow[]; dropped: FeedDrops; listed: number };
/**
 * One feed's run. `ok`: at least one of its addresses was read. `complete`: every address was read (a missing
 * confs.tech file counts as read and empty), so the store may cancel the feed's events it no longer lists. `error`: the
 * first failure as a short code ("404", "timeout", "too_large", "invalid", …), never text from the answer.
 */
/** `source` is the events.source the rows are written under: "feed" when left out; hand-entered events use "suggestion". */
export type FeedRead = FeedRows & { feedId: string; complete: boolean; error: string | null; source?: EventSource };
export type FeedDeps = { fetchImpl?: typeof fetch; timeoutMs?: number; maxBytes?: number; now?: Date; deadline?: number; matchers?: TopicMatchers };

const DAY_MS = 86_400_000;
/** India is UTC+05:30 all year. */
const IST_OFFSET_MS = 330 * 60_000;
/** A date with no time shows from 09:00 to 18:00 India time. */
const ALL_DAY_START_H = 9;
const ALL_DAY_END_H = 18;

export const noDrops = (): FeedDrops => Object.fromEntries(EVENT_FEED_DROPS.map((d) => [d, 0])) as FeedDrops;

/* Text ------------------------------------------------------------------------------------------------------------- */

const NUMERIC_ENTITY = /&#(\d{1,7});|&#x([0-9a-f]{1,6});/gi;
const fromCode = (n: number) => (n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : " ");

/** A feed's text as one plain line: entities decoded, tags and control characters out, spaces collapsed, clipped with …. */
export function cleanText(raw: string, max: number): string {
  const decoded = decode(decode(raw)).replace(NUMERIC_ENTITY, (_, dec: string | undefined, hex: string | undefined) => fromCode(dec ? Number(dec) : parseInt(hex ?? "0", 16)));
  const text = decoded
    .replace(/<[^>]*>/g, " ")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

/* Place ------------------------------------------------------------------------------------------------------------ */

/** Old or other names of profile cities, as feeds write them. */
const CITY_ALIASES: Record<string, PersonCity> = {
  bangalore: "Bengaluru",
  bombay: "Mumbai",
  "navi mumbai": "Mumbai",
  thane: "Mumbai",
  gurgaon: "Gurugram",
  delhi: "New Delhi",
  "delhi ncr": "New Delhi",
  mysore: "Mysuru",
  mangalore: "Mangaluru",
  trivandrum: "Thiruvananthapuram",
  cochin: "Kochi",
  ernakulam: "Kochi",
  pondicherry: "Puducherry",
  calcutta: "Kolkata",
  madras: "Chennai",
  secunderabad: "Hyderabad",
  vizag: "Visakhapatnam",
  baroda: "Vadodara",
  panjim: "Panaji",
};
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const CITY_PATTERNS: [RegExp, PersonCity][] = [
  ...PERSON_CITIES.map((c): [string, PersonCity] => [c, c]),
  ...Object.entries(CITY_ALIASES),
].map(([name, city]) => [new RegExp(`(?<![A-Za-z])${escapeRe(name).replace(/ /g, "\\s+")}(?![A-Za-z])`, "i"), city]);

/** The first profile city a place line names (by position), or null. */
export function cityIn(text: string): PersonCity | null {
  let best: { at: number; city: PersonCity } | null = null;
  for (const [re, city] of CITY_PATTERNS) {
    const m = re.exec(text);
    if (m && (!best || m.index < best.at)) best = { at: m.index, city };
  }
  return best?.city ?? null;
}

const ONLINE = /^\s*(?:online|virtual|remote|zoom|google meet|jitsi|youtube live|livestream)\b/i;

/* Kind and time ---------------------------------------------------------------------------------------------------- */

/** The kind from the title alone: online first, then hands-on events, then conferences, else a meetup. */
export function kindOf(title: string, online: boolean): EventKind {
  if (online) return "online";
  if (/\b(?:hackathon|workshop|hands-on|bootcamp|sprint|study jam)\b/i.test(title)) return "workshop";
  if (/\b(?:conf|conference|summit|festival|fest|devfest|debconf|minidebconf|symposium)\b|\bfoss\s?\d/i.test(title)) return "conference";
  return "meetup";
}

/** A day (YYYY-MM-DD) at an India-time hour, as a Date. */
const istAt = (day: string, hour: number) => new Date(Date.parse(`${day}T00:00:00Z`) - IST_OFFSET_MS + hour * 3600_000);
/** The India-time day of a moment. */
const istDay = (d: Date) => new Date(d.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);

/* iCalendar ---------------------------------------------------------------------------------------------------------- */

const INDIA_ZONES = new Set(["asia/kolkata", "asia/calcutta"]);

/**
 * An iCalendar DTSTART/DTEND value as a Date: UTC ("…Z"), India time (TZID Asia/Kolkata, or a floating time, since the
 * feeds read are India's), or a date (VALUE=DATE, at 00:00 India time). Null for anything else, another zone included.
 */
export function icsDate(params: string, value: string): { at: Date; allDay: boolean } | null {
  const zone = /;TZID=("?)([^;:"]+)\1/i.exec(params)?.[2];
  if (zone && !INDIA_ZONES.has(zone.toLowerCase())) return null;
  const date = /^(\d{4})(\d{2})(\d{2})$/.exec(value);
  if (date) {
    const at = istAt(`${date[1]}-${date[2]}-${date[3]}`, 0);
    return Number.isNaN(at.getTime()) ? null : { at, allDay: true };
  }
  const time = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/.exec(value);
  if (!time) return null;
  const [, y, mo, d, h, mi, s, z] = time;
  const utc = Date.parse(`${y}-${mo}-${d}T${h}:${mi}:${s}Z`);
  if (Number.isNaN(utc)) return null;
  return { at: new Date(z ? utc : utc - IST_OFFSET_MS), allDay: false };
}

/** An iCalendar text value unescaped: "\n" a new line, "\," "\;" "\\" the character itself. */
const unescapeIcs = (v: string) => v.replace(/\\([nN,;\\])/g, (_, c: string) => (c === "n" || c === "N" ? "\n" : c));

/**
 * The VEVENTs of an iCalendar answer, unfolded and unescaped, as objects for `icsEvent` (null for one whose start
 * can't be read), at most EVENT_FEED_EVENTS_MAX; `listed` counts every VEVENT. Other components are skipped.
 */
export function parseIcs(text: string): { events: unknown[]; listed: number } {
  const lines = text.replace(/\r\n?/g, "\n").replace(/\n[ \t]/g, "").split("\n");
  const events: unknown[] = [];
  let listed = 0;
  let props: Map<string, { params: string; value: string }> | null = null;
  let depth = 0;
  for (const line of lines) {
    if (/^BEGIN:VEVENT$/i.test(line)) {
      props = new Map();
      depth = 0;
      continue;
    }
    if (!props) continue;
    if (/^BEGIN:/i.test(line)) depth++;
    else if (/^END:VEVENT$/i.test(line)) {
      listed++;
      if (events.length < EVENT_FEED_EVENTS_MAX) events.push(icsObject(props));
      props = null;
    } else if (/^END:/i.test(line)) depth--;
    else if (depth === 0) {
      // NAME;PARAM=…:VALUE; a parameter value may be quoted and hold ":".
      const m = /^([A-Za-z0-9-]+)((?:;[^:;"]*(?:"[^"]*"[^:;"]*)*)*):(.*)$/.exec(line);
      if (m && !props.has(m[1].toUpperCase())) props.set(m[1].toUpperCase(), { params: m[2], value: m[3] });
    }
  }
  return { events, listed };
}

function icsObject(props: Map<string, { params: string; value: string }>): unknown {
  const start = props.get("DTSTART");
  const startAt = start ? icsDate(start.params, start.value.trim()) : null;
  if (!startAt) return null;
  const end = props.get("DTEND");
  const endAt = end ? icsDate(end.params, end.value.trim()) : null;
  if (end && !endAt) return null;
  const text = (name: string) => {
    const p = props.get(name);
    return p ? unescapeIcs(p.value) : null;
  };
  return {
    uid: text("UID") ?? "",
    summary: text("SUMMARY") ?? "",
    description: text("DESCRIPTION") ?? "",
    location: text("LOCATION") ?? "",
    url: props.get("URL")?.value.trim() ?? null,
    status: props.get("STATUS")?.value.trim() ?? null,
    start: startAt.at,
    end: endAt?.at ?? null,
    allDay: startAt.allDay,
  };
}

/* Rows --------------------------------------------------------------------------------------------------------------- */

type Draft = Omit<FeedEventRow, "topics"> & { description: string };

/** The checks every feed shares, after the feed's own reading: time, place, topics, then the row's own checks. */
function finish(draft: Draft | null, now: Date, dropped: FeedDrops, rows: FeedEventRow[], matchers?: TopicMatchers): void {
  if (!draft) return void dropped.invalid++;
  const { description, ...row } = draft;
  if (Number.isNaN(row.startsAt.getTime()) || Number.isNaN(row.endsAt.getTime()) || row.endsAt < row.startsAt) return void dropped.invalid++;
  if (row.endsAt.getTime() < now.getTime()) return void dropped.past++;
  if (row.startsAt.getTime() > now.getTime() + EVENT_FEED_AHEAD_DAYS * DAY_MS) return void dropped.too_far++;
  if (row.endsAt.getTime() - row.startsAt.getTime() > EVENT_FEED_LENGTH_MAX_DAYS * DAY_MS) return void dropped.too_long++;
  if (!row.online && !row.city) return void dropped.no_place++;
  const topics = topicsOf(row.title, description, matchers);
  if (!topics.length) return void dropped.no_topic++;
  const checked = feedEventRow.safeParse({ ...row, topics });
  if (!checked.success) return void dropped.invalid++;
  rows.push(checked.data);
}

/** An https link, or null. */
const httpsUrl = (raw: string | null | undefined): string | null => {
  if (!raw) return null;
  try {
    const u = new URL(raw.trim());
    return u.protocol === "https:" ? u.href : null;
  } catch {
    return null;
  }
};

/** One iCalendar feed's answer as rows. Not a calendar at all: ok false. */
export function icsRows(feed: EventFeed, text: string, now: Date, matchers?: TopicMatchers): FeedRows {
  const dropped = noDrops();
  const rows: FeedEventRow[] = [];
  if (!/BEGIN:VCALENDAR/i.test(text.slice(0, 2000)) && !/^\s*BEGIN:VEVENT/i.test(text)) return { ok: false, rows, dropped, listed: 0 };
  const { events, listed } = parseIcs(text);
  dropped.capped = listed - events.length;
  for (const raw of events) {
    const got = raw ? icsEvent.safeParse(raw) : null;
    if (!got?.success) {
      dropped.invalid++;
      continue;
    }
    const e = got.data;
    if (e.status?.toUpperCase() === "CANCELLED") {
      dropped.cancelled++;
      continue;
    }
    const url = httpsUrl(e.url);
    const key = `${feed.id}:${e.uid.trim()}`;
    const title = cleanText(e.summary, EVENT_TITLE_MAX);
    if (!url || !title || key.length > EVENT_SOURCE_KEY_MAX) {
      dropped.invalid++;
      continue;
    }
    const location = cleanText(e.location, 500);
    const city = location ? cityIn(location) : cityIn(title);
    // With no place line, a title that says online is an online event.
    const online = !city && (location ? ONLINE.test(location) : /\bonline\b/i.test(title));
    const startsAt = e.allDay ? istAt(istDay(e.start), ALL_DAY_START_H) : e.start;
    // An all-day DTEND is the day after the last one.
    const endsAt = e.allDay
      ? istAt(istDay(new Date((e.end ?? new Date(e.start.getTime() + DAY_MS)).getTime() - DAY_MS)), ALL_DAY_END_H)
      : (e.end ?? e.start);
    finish(
      {
        sourceKey: key,
        sourceUrl: url,
        title,
        organiser: feed.organiser,
        kind: kindOf(title, online),
        startsAt,
        endsAt,
        online,
        city: online ? null : city,
        venue: null,
        cost: "",
        description: e.description,
      },
      now,
      dropped,
      rows,
      matchers,
    );
  }
  return { ok: true, rows, dropped, listed };
}

/** The addresses a feed reads this run: a confs.tech "{year}" filled with this India year and the next. */
export function confsTechAddresses(feed: EventFeed, now: Date): string[] {
  const year = Number(istDay(now).slice(0, 4));
  return feed.urls.flatMap((u) => (u.includes("{year}") ? [u.replaceAll("{year}", String(year)), u.replaceAll("{year}", String(year + 1))] : [u]));
}

/** The topic word of a confs.tech file, from its name ("…/2026/python.json" → "python"). */
const topicWordOf = (address: string) => (/\/([a-z0-9-]+)\.json$/i.exec(address)?.[1] ?? "").replace(/-/g, " ");

/**
 * One confs.tech file as rows: conferences in an Indian profile city, or online. A conference both in India and
 * online counts as in person. Dates only: 09:00 to 18:00 India time. The organiser shown is the conference site's
 * host name, since the data names none. Not a list: ok false.
 */
export function confsTechRows(feed: EventFeed, data: unknown, address: string, now: Date, matchers?: TopicMatchers): FeedRows {
  const dropped = noDrops();
  const rows: FeedEventRow[] = [];
  const file = confsTechFile.safeParse(data);
  if (!file.success) return { ok: false, rows, dropped, listed: 0 };
  const word = topicWordOf(address);
  for (const raw of file.data.slice(0, EVENT_FEED_EVENTS_MAX)) {
    const got = confsTechConference.safeParse(raw);
    const url = got.success ? httpsUrl(got.data.url) : null;
    if (!got.success || !url) {
      dropped.invalid++;
      continue;
    }
    const c = got.data;
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "");
    const city = c.country && /^india$/i.test(c.country.trim()) && c.city ? cityIn(c.city) : null;
    const online = !city && c.online === true;
    finish(
      {
        sourceKey: `${feed.id}:${c.startDate}:${host}${u.pathname.replace(/\/+$/, "")}`.slice(0, EVENT_SOURCE_KEY_MAX),
        sourceUrl: url,
        title: cleanText(c.name, EVENT_TITLE_MAX),
        organiser: cleanText(host, EVENT_ORGANISER_MAX),
        kind: online ? "online" : "conference",
        startsAt: istAt(c.startDate, ALL_DAY_START_H),
        endsAt: istAt(c.endDate ?? c.startDate, ALL_DAY_END_H),
        online,
        city,
        venue: null,
        cost: "",
        description: word,
      },
      now,
      dropped,
      rows,
      matchers,
    );
  }
  dropped.capped += Math.max(0, file.data.length - EVENT_FEED_EVENTS_MAX);
  return { ok: true, rows, dropped, listed: file.data.length };
}

/* Network ------------------------------------------------------------------------------------------------------------ */

/**
 * A public GET of a feed's address as text, with a time limit and a size cap, no redirects and no cookies. Fails with
 * a short code only ("404", "timeout", "too_large", "network"), never with text from the answer.
 */
export async function getText(
  url: string,
  { fetchImpl = fetch, timeoutMs = EVENT_FEED_TIMEOUT_MS, maxBytes = EVENT_FEED_MAX_BYTES }: Pick<FeedDeps, "fetchImpl" | "timeoutMs" | "maxBytes"> = {},
): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  try {
    const res = await fetchImpl(url, {
      headers: { "user-agent": USER_AGENT, accept: "text/calendar, application/json;q=0.9, */*;q=0.5" },
      redirect: "error",
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) {
      await res.body?.cancel();
      return { ok: false, error: String(res.status) };
    }
    if (Number(res.headers.get("content-length") ?? 0) > maxBytes) {
      await res.body?.cancel();
      return { ok: false, error: "too_large" };
    }
    if (!res.body) return { ok: true, text: "" };
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        return { ok: false, error: "too_large" };
      }
      chunks.push(value);
    }
    const all = new Uint8Array(size);
    let at = 0;
    for (const c of chunks) {
      all.set(c, at);
      at += c.byteLength;
    }
    return { ok: true, text: new TextDecoder("utf-8").decode(all) };
  } catch (error) {
    const name = (error as { name?: string } | null)?.name;
    return { ok: false, error: name === "TimeoutError" || name === "AbortError" ? "timeout" : "network" };
  }
}

/**
 * One feed read whole: each address in turn (a few at once), its rows checked, each source key once. A confs.tech
 * file that isn't there (404, often next year's) counts as read and empty. Past `deadline` no address is started,
 * and the feed is then not complete.
 */
export async function readFeed(feed: EventFeed, deps: FeedDeps = {}): Promise<FeedRead> {
  const now = deps.now ?? new Date();
  const addresses = confsTechAddresses(feed, now);
  const dropped = noDrops();
  const rows: FeedEventRow[] = [];
  const seen = new Set<string>();
  let listed = 0;
  let read = 0;
  let error: string | null = null;
  const fail = (code: string) => (error ??= code);
  const one = async (address: string) => {
    if (deps.deadline !== undefined && Date.now() > deps.deadline) return void fail("deadline");
    const got = await getText(address, deps);
    if (!got.ok) {
      if (feed.format === "confs-tech" && got.error === "404") read++;
      else fail(got.error);
      return;
    }
    let part: FeedRows;
    if (feed.format === "ics") part = icsRows(feed, got.text, now, deps.matchers);
    else {
      let data: unknown;
      try {
        data = JSON.parse(got.text);
      } catch {
        return void fail("invalid");
      }
      part = confsTechRows(feed, data, address, now, deps.matchers);
    }
    if (!part.ok) return void fail("invalid");
    read++;
    listed += part.listed;
    for (const d of EVENT_FEED_DROPS) dropped[d] += part.dropped[d];
    for (const r of part.rows) {
      if (seen.has(r.sourceKey)) continue;
      seen.add(r.sourceKey);
      rows.push(r);
    }
  };
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(4, addresses.length) }, async () => {
      while (next < addresses.length) await one(addresses[next++]);
    }),
  );
  // Rows in a steady order whatever order the addresses answered in.
  if (addresses.length > 1) rows.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime() || a.sourceKey.localeCompare(b.sourceKey));
  const ok = read > 0;
  return { feedId: feed.id, ok, complete: ok && read === addresses.length, error, rows: ok ? rows : [], dropped, listed };
}

/** The run in counts only, for the log and the cron's answer: never a title, link or description. */
export function feedSummary(reads: readonly FeedRead[], written: { upserted: number; cancelled: number }) {
  const dropped = noDrops();
  for (const r of reads) for (const d of EVENT_FEED_DROPS) dropped[d] += r.dropped[d];
  return {
    feedsOn: reads.length,
    feedsOk: reads.filter((r) => r.ok).length,
    feedsComplete: reads.filter((r) => r.complete).length,
    listed: reads.reduce((n, r) => n + r.listed, 0),
    kept: reads.reduce((n, r) => n + r.rows.length, 0),
    upserted: written.upserted,
    cancelled: written.cancelled,
    droppedInvalid: dropped.invalid,
    droppedCancelled: dropped.cancelled,
    droppedPast: dropped.past,
    droppedTooFar: dropped.too_far,
    droppedTooLong: dropped.too_long,
    droppedNoPlace: dropped.no_place,
    droppedNoTopic: dropped.no_topic,
    droppedCapped: dropped.capped,
  };
}
