import { z } from "zod";
import { cleanSuggestedUrl } from "@/lib/library/links";
import {
  EVENT_SUGGESTION_QUEUE_MAX,
  EVENT_SUGGESTION_STATUSES,
  SUGGESTION_URL_MAX,
  EVENT_COST_MAX,
  EVENT_FEED_FORMATS,
  EVENT_FEED_LENGTH_MAX_DAYS,
  EVENT_FEED_URLS_MAX,
  EVENT_FEEDS_MAX,
  EVENT_KINDS,
  EVENT_LISTING_HOSTS,
  EVENT_MANUAL_EVIDENCE_MAX,
  EVENT_MANUAL_FEED_ID,
  EVENT_MANUAL_MAX,
  EVENT_MANUAL_TOPICS_MAX,
  EVENT_ORGANISER_MAX,
  EVENT_RADII_KM,
  EVENT_RADIUS_DEFAULT_KM,
  EVENT_RSVP_STATES,
  EVENT_SOURCE_KEY_MAX,
  EVENT_SOURCES,
  EVENT_STATUSES,
  EVENT_TAGS_MAX,
  EVENT_TITLE_MAX,
  EVENT_TOPIC_KINDS,
  EVENT_TOPICS_MAX,
  EVENT_URL_MAX,
  EVENT_VENUE_MAX,
  EVENTS_DIGEST_EVENTS_MAX,
  INTEREST_MAX,
  INTEREST_TOPIC_ALIASES_MAX,
  INTERESTS_MAX,
  INTEREST_TOPICS_MAX,
  PERSON_CITIES,
  TIMETABLE_EVENTS_MAX,
} from "./constants";
export {
  EVENT_FEED_DROPS,
  EVENT_LISTING_HOSTS,
  EVENT_MANUAL_FEED_ID,
  EVENT_MANUAL_SOURCE,
  EVENT_KIND_LABELS,
  EVENT_KINDS,
  EVENT_RADII_KM,
  EVENT_RADIUS_DEFAULT_KM,
  EVENT_RSVP_STATES,
  EVENT_STATUSES,
  EVENT_SUGGESTION_NOTE,
  EVENT_SUGGESTION_STATUSES,
  EVENT_SUGGESTIONS_PENDING_MAX,
  EVENT_WINDOW_DAYS,
  EVENTS_DIGEST_DAYS,
  EVENTS_DIGEST_EVENTS_MAX,
  TIMETABLE_EVENTS_MAX,
  TIMETABLE_NO_CITY,
} from "./constants";

/*
 * Timetable (docs/plans/timetable-plan.md): events whose topic matches one of the person's goals or interests. An event
 * keeps only our short summary (title, organiser, time, place, cost) and a link to its source; the organiser's
 * description is read for topics by code and never kept. Location comes from the profile city, never the device.
 */

export const eventSource = z.enum(EVENT_SOURCES);
export const eventKind = z.enum(EVENT_KINDS);
export const eventStatus = z.enum(EVENT_STATUSES);
export const eventTopicKind = z.enum(EVENT_TOPIC_KINDS);
export const eventRsvpState = z.enum(EVENT_RSVP_STATES);
export type EventRsvpState = z.infer<typeof eventRsvpState>;

/** A skill id from skills.json or an interest topic key: lowercase words joined by hyphens. */
export const topicKey = z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/).max(80);

/** One row of `event_topics`, without its event id. */
export const eventTopic = z.strictObject({ kind: eventTopicKind, topic: topicKey });
export type EventTopic = z.infer<typeof eventTopic>;

const https = z.string().max(EVENT_URL_MAX).pipe(z.url({ protocol: /^https$/ }));

/** Control characters, an HTML tag, or an HTML entity ("&amp;", "&#60;"): a feed's markup, never our plain summary. */
const NOT_PLAIN = /[\u0000-\u001f\u007f]|<\/?[A-Za-z!][^>]*>|&(?:#\d+|#x[0-9a-f]+|[a-z][a-z0-9]*);/i;

/**
 * One line of an event's summary, refused (not cleaned) when it holds control characters, tags or entities (T166): the
 * feed job cleans what it reads before it writes, so a row that still holds them is a bug to see, not to show.
 */
export const eventText = (min: number, max: number) =>
  z
    .string()
    .min(min)
    .max(max)
    .refine((s) => !NOT_PLAIN.test(s), "plain text only: no tags, entities or control characters");

/** One `events` row as the store reads it (the same checks as the table's). */
export const eventRow = z
  .strictObject({
    id: z.uuid(),
    source: eventSource,
    sourceKey: z.string().min(1).max(EVENT_SOURCE_KEY_MAX),
    sourceUrl: https,
    title: eventText(1, EVENT_TITLE_MAX),
    organiser: eventText(1, EVENT_ORGANISER_MAX),
    kind: eventKind,
    startsAt: z.date(),
    endsAt: z.date(),
    online: z.boolean(),
    /** The event's city as the source gives it, one of PERSON_CITIES; null when online, and only then (T166). */
    city: z.enum(PERSON_CITIES).nullable(),
    /** An area such as "Baner, Pune"; no street address. */
    venue: eventText(1, EVENT_VENUE_MAX).nullable(),
    /** "Free", "₹200", "₹1,500 student pass". Never a payment link. */
    cost: eventText(0, EVENT_COST_MAX),
    status: eventStatus,
    checkedAt: z.date().nullable(),
    createdAt: z.date(),
    updatedAt: z.date(),
  })
  .refine((e) => e.endsAt.getTime() >= e.startsAt.getTime(), { message: "ends before it starts", path: ["endsAt"] })
  .refine((e) => !e.online || e.city === null, { message: "an online event has no city", path: ["city"] })
  .refine((e) => e.online || e.city !== null, { message: "an in-person event names its city", path: ["city"] });
export type EventRow = z.infer<typeof eventRow>;

/** The topics found in one event: each once, at most EVENT_TOPICS_MAX. */
export const eventTopicList = z
  .array(eventTopic)
  .max(EVENT_TOPICS_MAX)
  .refine((ts) => new Set(ts.map((t) => `${t.kind}:${t.topic}`)).size === ts.length, { message: "a topic twice" });

/** A tag on an event card: "Goal: SIEM" or "Interest: AI". The neutral tag style; an event is not progress. */
export const eventTag = z.strictObject({
  kind: z.enum(["goal", "interest"]),
  topic: topicKey,
  label: z.string().min(1).max(160),
});
export type EventTag = z.infer<typeof eventTag>;

/** One event card on /timetable. Times are ISO; the screen shows them in IST. */
export const eventCard = z
  .strictObject({
    id: z.uuid(),
    title: eventText(1, EVENT_TITLE_MAX),
    organiser: eventText(1, EVENT_ORGANISER_MAX),
    kind: eventKind,
    startsAt: z.iso.datetime(),
    endsAt: z.iso.datetime(),
    online: z.boolean(),
    city: z.enum(PERSON_CITIES).nullable(),
    venue: eventText(1, EVENT_VENUE_MAX).nullable(),
    cost: eventText(0, EVENT_COST_MAX),
    sourceUrl: https,
    /** Why it shows: at least one goal or interest it matches. */
    tags: z.array(eventTag).min(1).max(EVENT_TAGS_MAX),
    /** Kilometres from the person's city centre, rounded; null for an online event. */
    distanceKm: z.number().int().min(0).nullable(),
    rsvp: eventRsvpState.nullable(),
    /**
     * The goal (skill id) the person made it a prep task for (Timetable PR 3): only on an event they are going to, and
     * only while that goal is still one of its tags. Left out when there is none.
     */
    prepGoal: topicKey.optional(),
  })
  .refine((e) => Date.parse(e.endsAt) >= Date.parse(e.startsAt), { message: "ends before it starts", path: ["endsAt"] })
  .refine((e) => (e.online ? e.distanceKm === null : e.city !== null && e.distanceKm !== null), { message: "place and distance disagree", path: ["distanceKm"] })
  .refine((e) => !e.prepGoal || (e.rsvp === "going" && e.tags.some((t) => t.kind === "goal" && t.topic === e.prepGoal)), {
    message: "a prep task needs I'm going and that goal's tag",
    path: ["prepGoal"],
  });
export type EventCard = z.infer<typeof eventCard>;

/** "This week", "Later this month", then one group a month ("2026-12"), in IST. */
export const timetableGroup = z.strictObject({
  key: z.union([z.literal("week"), z.literal("later"), z.string().regex(/^\d{4}-\d{2}$/)]),
  label: z.string().min(1).max(40),
  events: z.array(eventCard).min(1).max(TIMETABLE_EVENTS_MAX),
});
export type TimetableGroup = z.infer<typeof timetableGroup>;

export const timetableFilter = z.enum(["all", "goals", "interests"]);
export type TimetableFilter = z.infer<typeof timetableFilter>;

/** The whole /timetable view for one person. */
export const timetableView = z
  .strictObject({
    /** The profile city, or null: then only online events show, with TIMETABLE_NO_CITY. */
    city: z.enum(PERSON_CITIES).nullable(),
    noCity: z.boolean(),
    radiusKm: z.number().int().min(1).max(500),
    online: z.boolean(),
    filter: timetableFilter,
    groups: z.array(timetableGroup).max(12),
    /** Matching events beyond the radius: "3 more outside 25 km". */
    outsideRadius: z.number().int().min(0),
  })
  .refine((v) => v.noCity === (v.city === null), { message: "noCity must follow city", path: ["noCity"] })
  .refine((v) => v.groups.reduce((n, g) => n + g.events.length, 0) <= TIMETABLE_EVENTS_MAX, { message: "too many events", path: ["groups"] })
  .refine((v) => new Set(v.groups.map((g) => g.key)).size === v.groups.length, { message: "a group twice", path: ["groups"] });
export type TimetableView = z.infer<typeof timetableView>;

/** "Save" ("saved"), "I'm going" ("going"), or neither (null takes the person's row away). The store checks the event is live. */
export const eventRsvpInput = z.strictObject({ eventId: z.uuid(), state: eventRsvpState.nullable() });
export type EventRsvpInput = z.infer<typeof eventRsvpInput>;

/**
 * "Add it as a prep task for your SIEM goal?" (docs/plans/timetable-plan.md section 4): yes names the goal's skill, and
 * null takes the task off again. The store checks the person is going, the event is live and lists that skill, and the
 * skill is one of their open goals. Going never fills a gap or adds proof.
 */
export const eventPrepInput = z.strictObject({ eventId: z.uuid(), goalSkillId: topicKey.nullable() });
export type EventPrepInput = z.infer<typeof eventPrepInput>;

/** "Why you see these": the names of the person's open goals, in goal order, and their interests as typed on Me. */
export const timetableWhy = z.strictObject({
  goals: z.array(z.string().min(1).max(160)).max(200),
  interests: z.array(z.string().min(1).max(INTEREST_MAX)).max(INTERESTS_MAX),
});
export type TimetableWhy = z.infer<typeof timetableWhy>;

/** The three Timetable choices in `user_settings`. "Show outside 25 km" sets 100 for one visit; Settings saves it. */
export const timetableSettings = z.strictObject({
  radiusKm: z.union([z.literal(EVENT_RADII_KM[0]), z.literal(EVENT_RADII_KM[1])]),
  online: z.boolean(),
  digest: z.boolean(),
});
export type TimetableSettings = z.infer<typeof timetableSettings>;

/** No `user_settings` row means these. The digest is off until the person turns it on, as the weekly email is. */
export const DEFAULT_TIMETABLE_SETTINGS: TimetableSettings = { radiusKm: EVENT_RADIUS_DEFAULT_KM, online: true, digest: false };

/**
 * "Send me this week's events" (Timetable PR 5), from /timetable or Settings > Notifications. It saves at once, apart
 * from the Settings form's Save button, and changes only the person's own `user_settings.events_digest`.
 */
export const eventsDigestInput = z.strictObject({ on: z.boolean() });
export type EventsDigestInput = z.infer<typeof eventsDigestInput>;

/**
 * One event in the Monday digest (docs/plans/timetable-plan.md section 5): title, organiser, day and time in IST, city or
 * Online, and the organiser's link. Nothing about any other person.
 */
export const eventsDigestEvent = z.strictObject({
  title: eventText(1, EVENT_TITLE_MAX),
  organiser: eventText(1, EVENT_ORGANISER_MAX),
  /** "Sat 7 Nov, 6 to 8 pm IST", or "14 to 15 Nov" across days. */
  when: z.string().min(1).max(80),
  /** A profile city, or "Online". */
  place: z.union([z.enum(PERSON_CITIES), z.literal("Online")]),
  sourceUrl: https,
});
export type EventsDigestEvent = z.infer<typeof eventsDigestEvent>;

/**
 * One person's Monday digest: the India week (its Monday) it is for, the soonest matching events in the next
 * EVENTS_DIGEST_DAYS days (at most EVENTS_DIGEST_EVENTS_MAX), and how many more matched. No digest without an event.
 */
export const eventsDigestView = z.strictObject({
  week: z.iso.date(),
  events: z.array(eventsDigestEvent).min(1).max(EVENTS_DIGEST_EVENTS_MAX),
  more: z.number().int().min(0).max(TIMETABLE_EVENTS_MAX),
});
export type EventsDigestView = z.infer<typeof eventsDigestView>;

/** One entry of src/content/interest-topics.json: a topic key, its label on a tag, and the words that mean it. */
export const interestTopic = z
  .strictObject({
    key: topicKey,
    label: z.string().min(1).max(40),
    /** Lowercase, single spaces: an interest typed on Me maps to this topic when it is one of them exactly. */
    aliases: z
      .array(z.string().min(1).max(40).regex(/^[a-z0-9+#./&' -]+$/).refine((a) => a === a.trim().replace(/\s+/g, " "), "trimmed, single spaces"))
      .min(1)
      .max(INTEREST_TOPIC_ALIASES_MAX),
    /**
     * Aliases that are also ordinary words in an event's text ("data", "product", "networking"). They still map an
     * interest typed on Me, but the matcher never looks for them in an event's title or description.
     */
    ambiguous: z.array(z.string().min(1).max(40)).max(INTEREST_TOPIC_ALIASES_MAX).default([]),
  })
  .refine((t) => t.ambiguous.every((a) => t.aliases.includes(a)), { message: "ambiguous lists only its own aliases", path: ["ambiguous"] });
export type InterestTopic = z.infer<typeof interestTopic>;

export const interestTopicsFile = z
  .array(interestTopic)
  .min(1)
  .max(INTEREST_TOPICS_MAX)
  .superRefine((ts, ctx) => {
    const keys = new Set<string>();
    for (const t of ts) {
      if (keys.has(t.key)) ctx.addIssue({ code: "custom", message: `topic ${t.key} twice` });
      keys.add(t.key);
    }
  });

/** One entry of src/content/city-centres.json: a city's centre from public map data, to 4 decimals. */
export const cityCentre = z.strictObject({
  city: z.enum(PERSON_CITIES),
  // India's mainland and islands lie within these.
  lat: z.number().min(6).max(37.5),
  lng: z.number().min(68).max(97.5),
});
export type CityCentre = z.infer<typeof cityCentre>;

export const cityCentresFile = z
  .array(cityCentre)
  .max(PERSON_CITIES.length)
  .superRefine((cs, ctx) => {
    const seen = new Set<string>();
    for (const c of cs) {
      if (seen.has(c.city)) ctx.addIssue({ code: "custom", message: `${c.city} twice` });
      seen.add(c.city);
    }
  });

/** One row of `eventRsvps` in Download your data (from export version 36): the person's own saves and "I'm going". */
export const eventRsvpExport = z.strictObject({
  title: z.string().min(1).max(EVENT_TITLE_MAX),
  organiser: z.string().min(1).max(EVENT_ORGANISER_MAX),
  startsAt: z.date(),
  sourceUrl: https,
  state: eventRsvpState,
  goalSkillId: topicKey.nullable(),
  createdAt: z.date(),
});
export type EventRsvpExport = z.infer<typeof eventRsvpExport>;

/*
 * The event feed (Timetable PR 4, docs/plans/timetable-plan.md section 6). Each feed is listed in
 * src/content/event-feeds.json with its terms link and the date its terms were read; it goes on only with that date
 * (docs/timetable-sources.md keeps what the terms say). The job reads each feed's public answer, keeps our short
 * summary and the topics code finds, and never keeps or logs the organiser's description.
 */

export const eventFeedFormat = z.enum(EVENT_FEED_FORMATS);

/** A feed id: lowercase words joined by hyphens. It starts each of its events' source_key ("foss-united:…"). */
export const eventFeedId = z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/).max(40);

const parsesAsHttps = (u: string) => {
  try {
    return new URL(u.replaceAll("{year}", "2026")).protocol === "https:";
  } catch {
    return false;
  }
};

/** A feed address: https only; a confs.tech address may hold "{year}", which the job fills with this year and next. */
const feedAddress = z.string().max(EVENT_URL_MAX).refine(parsesAsHttps, "an https address");

/** One entry of src/content/event-feeds.json. */
export const eventFeed = z
  .strictObject({
    id: eventFeedId,
    /** The feed's own name, for docs. The log names the feed by its id. */
    name: z.string().min(1).max(80),
    /** The organiser on each event, when the feed's entries name none. */
    organiser: eventText(1, EVENT_ORGANISER_MAX),
    format: eventFeedFormat,
    urls: z.array(feedAddress).min(1).max(EVENT_FEED_URLS_MAX),
    /** The terms or licence page read before the feed went on. */
    termsUrl: https,
    /** The day (YYYY-MM-DD) someone read those terms and found they allow reuse; null until then. */
    termsReadOn: z.iso.date().nullable(),
    /** Off until termsReadOn is set; the job reads only feeds that are on. */
    on: z.boolean(),
    /** Why it is on or off, in a sentence or two. */
    note: z.string().min(1).max(500),
  })
  .refine((f) => !f.on || f.termsReadOn !== null, { message: "a feed goes on only once its terms were read", path: ["on"] })
  .refine((f) => f.format === "confs-tech" || f.urls.every((u) => !u.includes("{year}")), { message: "only a confs.tech address takes {year}", path: ["urls"] });
export type EventFeed = z.infer<typeof eventFeed>;

export const eventFeedsFile = z
  .array(eventFeed)
  .max(EVENT_FEEDS_MAX)
  .refine((fs) => new Set(fs.map((f) => f.id)).size === fs.length, { message: "a feed id twice" })
  .refine((fs) => fs.every((f) => f.id !== EVENT_MANUAL_FEED_ID), { message: `"${EVENT_MANUAL_FEED_ID}" is the hand-entered events' id` });

/** One VEVENT as the job reads it from an iCalendar feed, after unfolding and unescaping. Other properties are ignored. */
export const icsEvent = z.strictObject({
  uid: z.string().min(1).max(500),
  summary: z.string().min(1).max(5000),
  description: z.string().max(200_000),
  location: z.string().max(2000),
  url: z.string().max(EVENT_URL_MAX).nullable(),
  status: z.string().max(40).nullable(),
  start: z.date(),
  /** Null when the feed gives no end. */
  end: z.date().nullable(),
  /** A date with no time (VALUE=DATE). */
  allDay: z.boolean(),
});
export type IcsEvent = z.infer<typeof icsEvent>;

/** One conference in a confs.tech conference-data file. Its other fields (twitter, cfpUrl, cocUrl, …) are ignored. */
export const confsTechConference = z.object({
  name: z.string().min(1).max(500),
  url: z.string().max(EVENT_URL_MAX),
  startDate: z.iso.date(),
  endDate: z.iso.date().optional(),
  city: z.string().max(200).optional(),
  country: z.string().max(200).optional(),
  online: z.boolean().optional(),
});
export type ConfsTechConference = z.infer<typeof confsTechConference>;
/** A confs.tech file: a list of conferences, each checked on its own so one bad entry drops only itself. */
export const confsTechFile = z.array(z.unknown()).max(5000);

/**
 * One event as the feed job writes it: the `events` row's own fields (status, checked_at and the timestamps are the
 * store's) and its topics, at least one. The same checks as the table's, so a row that passes is never refused.
 */
export const feedEventRow = z
  .strictObject({
    sourceKey: z.string().min(1).max(EVENT_SOURCE_KEY_MAX),
    sourceUrl: https,
    title: eventText(1, EVENT_TITLE_MAX),
    organiser: eventText(1, EVENT_ORGANISER_MAX),
    kind: eventKind,
    startsAt: z.date(),
    endsAt: z.date(),
    online: z.boolean(),
    city: z.enum(PERSON_CITIES).nullable(),
    venue: eventText(1, EVENT_VENUE_MAX).nullable(),
    cost: eventText(0, EVENT_COST_MAX),
    topics: eventTopicList.min(1),
  })
  .refine((e) => e.endsAt.getTime() >= e.startsAt.getTime(), { message: "ends before it starts", path: ["endsAt"] })
  .refine((e) => e.endsAt.getTime() - e.startsAt.getTime() <= EVENT_FEED_LENGTH_MAX_DAYS * 86_400_000, { message: "too long", path: ["endsAt"] })
  .refine((e) => !e.online || e.city === null, { message: "an online event has no city", path: ["city"] })
  .refine((e) => e.online || e.city !== null, { message: "an in-person event names its city", path: ["city"] });
export type FeedEventRow = z.infer<typeof feedEventRow>;

/*
 * Hand-entered events (docs/timetable-sources.md): src/content/manual-events.json, edited by the team in a PR from the
 * organiser's own page. The daily event feed loads each one (src/lib/timetable/manual.ts). dateEvidence stays in the
 * content file: it is never written to the database, shown or logged.
 */

/** "2026-11-13T09:00:00+05:30": an India wall clock with its offset, as typed from the organiser's page. */
const indiaDateTime = z.iso
  .datetime({ offset: true })
  .refine((s) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?\+05:30$/.test(s), "India time: YYYY-MM-DDTHH:MM(:SS)+05:30");

/** True when a link's host is one of EVENT_LISTING_HOSTS or under one. */
export function isListingHost(url: string): boolean {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase().replace(/\.$/, "");
  } catch {
    return false;
  }
  return EVENT_LISTING_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
}

/** One hand-entered event. */
export const manualEvent = z
  .strictObject({
    title: eventText(1, EVENT_TITLE_MAX),
    organiser: eventText(1, EVENT_ORGANISER_MAX),
    kind: eventKind,
    startsAt: indiaDateTime,
    endsAt: indiaDateTime,
    online: z.boolean(),
    /** One of PERSON_CITIES; null when online, and only then. */
    city: z.enum(PERSON_CITIES).nullable(),
    venue: eventText(1, EVENT_VENUE_MAX).nullable(),
    /** "" when the page names no price. Never a payment link. */
    cost: eventText(0, EVENT_COST_MAX),
    /** Skill ids from skills.json (the content test checks each exists). */
    topics: z
      .array(topicKey)
      .min(1)
      .max(EVENT_MANUAL_TOPICS_MAX)
      .refine((ts) => new Set(ts).size === ts.length, "a topic twice"),
    /** The organiser's own page: https, never a listing or job site. */
    sourceUrl: https.refine((u) => !isListingHost(u), "the organiser's own page, not a listing site"),
    /** The day someone last read the date on that page. */
    checkedOn: z.iso.date(),
    /** A short quote of the date from the page. Kept here only: never stored, shown or logged. */
    dateEvidence: z.string().min(1).max(EVENT_MANUAL_EVIDENCE_MAX),
  })
  .refine((e) => Date.parse(e.endsAt) >= Date.parse(e.startsAt), { message: "ends before it starts", path: ["endsAt"] })
  .refine((e) => Date.parse(e.endsAt) - Date.parse(e.startsAt) <= EVENT_FEED_LENGTH_MAX_DAYS * 86_400_000, { message: "too long", path: ["endsAt"] })
  .refine((e) => !e.online || (e.city === null && e.venue === null), { message: "an online event has no city or area", path: ["city"] })
  .refine((e) => e.online || e.city !== null, { message: "an in-person event names its city", path: ["city"] })
  .refine((e) => e.kind !== "online" || e.online, { message: "an Online event is online", path: ["kind"] })
  .refine((e) => e.checkedOn <= e.startsAt.slice(0, 10), { message: "checked after it started", path: ["checkedOn"] });
export type ManualEvent = z.infer<typeof manualEvent>;

/** The title as a slug: lowercase letters and digits joined by hyphens, at most 120 characters. */
export function manualSlug(title: string): string {
  const slug = title
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120)
    .replace(/-+$/g, "");
  return slug || "event";
}

/** A hand-entered event's stable source_key: "manual:<title slug>-<India start date>". */
export const manualKey = (e: Pick<ManualEvent, "title" | "startsAt">): string => `manual:${manualSlug(e.title)}-${e.startsAt.slice(0, 10)}`;

/** The whole content file: each event once by its key. */
export const manualEventsFile = z
  .array(manualEvent)
  .max(EVENT_MANUAL_MAX)
  .superRefine((es, ctx) => {
    const seen = new Set<string>();
    for (const e of es) {
      const key = manualKey(e);
      if (seen.has(key)) ctx.addIssue({ code: "custom", message: `${key} twice` });
      seen.add(key);
    }
  });

/**
 * One hand-entered event on /admin/reports: what the file says and what the events table holds for it. state is the
 * row's status ("live", "hidden", "cancelled"), "over" once it has ended, or "waiting" until the next daily run loads it.
 */
export const manualEventAdminRow = z.strictObject({
  key: z.string().min(1).max(EVENT_SOURCE_KEY_MAX),
  title: eventText(1, EVENT_TITLE_MAX),
  organiser: eventText(1, EVENT_ORGANISER_MAX),
  startsAt: z.iso.datetime({ offset: true }),
  endsAt: z.iso.datetime({ offset: true }),
  online: z.boolean(),
  city: z.enum(PERSON_CITIES).nullable(),
  sourceUrl: https,
  checkedOn: z.iso.date(),
  state: z.enum(["live", "hidden", "cancelled", "pending", "over", "waiting"]),
});
export type ManualEventAdminRow = z.infer<typeof manualEventAdminRow>;

/*
 * Suggest an event (Timetable PR 6, docs/plans/timetable-plan.md section 6): a signed-in member gives the organiser's
 * https link and the basic fields. Members' suggestions need a grievance officer (pending item 15), so each one is kept
 * as pending in `event_suggestions` (owner only, goes with the account) and nothing shows it to anyone else or
 * publishes it. The link is never fetched by the server, and neither it nor any typed text reaches a log.
 */

export const eventSuggestionStatus = z.enum(EVENT_SUGGESTION_STATUSES);

const IST_MS = 5.5 * 3600_000;

/**
 * "2026-11-07T18:00", an India wall clock as the form's date and time boxes give it, as the instant it names. Null
 * when it isn't a real date and time (31 Feb, 24:00) or isn't in that exact form.
 */
export function istInstant(local: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local);
  if (!m) return null;
  const [y, mo, d, h, mi] = m.slice(1).map(Number);
  if (mo < 1 || mo > 12 || d < 1 || h > 23 || mi > 59) return null;
  const wall = new Date(Date.UTC(y, mo - 1, d, h, mi));
  // Date.UTC rolls 31 Feb over into March; a real date comes back as it went in.
  if (wall.getUTCFullYear() !== y || wall.getUTCMonth() !== mo - 1 || wall.getUTCDate() !== d) return null;
  return new Date(wall.getTime() - IST_MS);
}

/** A web address typed into a text box: the event's link has its own box, and the cost is never a payment link. */
const HAS_LINK = /:\/\/|\bwww\.[a-z0-9-]+\./i;

/** A typed line: trimmed, inner spaces single, then the summary's checks (plain text, length) and no link. */
const typedLine = (min: number, max: number) =>
  z
    .string()
    .max(max * 4)
    .transform((s) => s.trim().replace(/\s+/g, " "))
    .pipe(eventText(min, max).refine((s) => !HAS_LINK.test(s), "no links here: the event's link has its own box"));

/** A start or end from the form, in India time, as its instant. */
const indiaTime = z
  .string()
  .max(16)
  .transform((s, ctx) => {
    const at = istInstant(s);
    if (!at) {
      ctx.addIssue({ code: "custom", message: "a date and a time" });
      return z.NEVER;
    }
    return at;
  });

/**
 * The "Suggest an event" form. The link is cleaned as a Library suggestion is (https, a public host, no shortener, user
 * info or port; tracking parameters dropped) and comes back with its host. Times are India time. The same checks as
 * the events table, plus: an online event has no city or area and an "Online" kind is online, and it lasts at most
 * EVENT_FEED_LENGTH_MAX_DAYS. The store checks it starts ahead (within EVENT_SUGGESTION_AHEAD_DAYS).
 */
export const eventSuggestionInput = z
  .strictObject({
    url: z
      .string()
      .max(EVENT_URL_MAX)
      .transform((raw, ctx) => {
        const clean = cleanSuggestedUrl(raw);
        if (!clean) {
          ctx.addIssue({ code: "custom", message: "an https link to the organiser's page" });
          return z.NEVER;
        }
        return clean;
      }),
    title: typedLine(1, EVENT_TITLE_MAX),
    organiser: typedLine(1, EVENT_ORGANISER_MAX),
    kind: eventKind,
    startsAt: indiaTime,
    endsAt: indiaTime,
    online: z.boolean(),
    city: z.enum(PERSON_CITIES).nullable(),
    venue: typedLine(0, EVENT_VENUE_MAX).transform((v) => v || null),
    cost: typedLine(0, EVENT_COST_MAX),
  })
  .refine((e) => e.endsAt.getTime() >= e.startsAt.getTime(), { message: "ends before it starts", path: ["endsAt"] })
  .refine((e) => e.endsAt.getTime() - e.startsAt.getTime() <= EVENT_FEED_LENGTH_MAX_DAYS * 86_400_000, { message: "too long", path: ["endsAt"] })
  .refine((e) => !e.online || (e.city === null && e.venue === null), { message: "an online event has no city or area", path: ["city"] })
  .refine((e) => e.online || e.city !== null, { message: "an in-person event names its city", path: ["city"] })
  .refine((e) => e.kind !== "online" || e.online, { message: "an Online event is online", path: ["kind"] });
export type EventSuggestionInput = z.input<typeof eventSuggestionInput>;
export type EventSuggestion = z.output<typeof eventSuggestionInput>;

const suggestedUrl = z.string().max(SUGGESTION_URL_MAX).pipe(z.url({ protocol: /^https$/ }));

/** One of the person's suggestions in Download your data (from export version 37): what they sent, and that it waits. */
export const eventSuggestionExport = z.strictObject({
  sourceUrl: suggestedUrl,
  title: z.string().min(1).max(EVENT_TITLE_MAX),
  organiser: z.string().min(1).max(EVENT_ORGANISER_MAX),
  kind: eventKind,
  startsAt: z.date(),
  endsAt: z.date(),
  online: z.boolean(),
  city: z.enum(PERSON_CITIES).nullable(),
  venue: z.string().min(1).max(EVENT_VENUE_MAX).nullable(),
  cost: z.string().max(EVENT_COST_MAX),
  status: eventSuggestionStatus,
  createdAt: z.date(),
});
export type EventSuggestionExport = z.infer<typeof eventSuggestionExport>;

/**
 * One pending suggestion on /admin/reports: what was sent and when, never who sent it. Read only: there is no action
 * until a grievance officer is named. Times are ISO.
 */
export const eventSuggestionQueueRow = z.strictObject({
  id: z.uuid(),
  sourceUrl: suggestedUrl,
  host: z.string().min(1).max(253),
  title: z.string().min(1).max(EVENT_TITLE_MAX),
  organiser: z.string().min(1).max(EVENT_ORGANISER_MAX),
  kind: eventKind,
  startsAt: z.iso.datetime(),
  endsAt: z.iso.datetime(),
  online: z.boolean(),
  city: z.enum(PERSON_CITIES).nullable(),
  venue: z.string().min(1).max(EVENT_VENUE_MAX).nullable(),
  cost: z.string().max(EVENT_COST_MAX),
  createdAt: z.iso.datetime(),
});
export type EventSuggestionQueueRow = z.infer<typeof eventSuggestionQueueRow>;

/** The pending queue: how many wait in all, and the oldest EVENT_SUGGESTION_QUEUE_MAX of them. */
export const eventSuggestionQueue = z
  .strictObject({ total: z.number().int().min(0), rows: z.array(eventSuggestionQueueRow).max(EVENT_SUGGESTION_QUEUE_MAX) })
  .refine((q) => q.rows.length <= q.total, { message: "more rows than the total", path: ["rows"] });
export type EventSuggestionQueue = z.infer<typeof eventSuggestionQueue>;
