import { z } from "zod";
import {
  EVENT_COST_MAX,
  EVENT_FEED_FORMATS,
  EVENT_FEED_LENGTH_MAX_DAYS,
  EVENT_FEED_URLS_MAX,
  EVENT_FEEDS_MAX,
  EVENT_KINDS,
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
  INTEREST_MAX,
  INTEREST_TOPIC_ALIASES_MAX,
  INTERESTS_MAX,
  INTEREST_TOPICS_MAX,
  PERSON_CITIES,
  TIMETABLE_EVENTS_MAX,
} from "./constants";
export {
  EVENT_FEED_DROPS,
  EVENT_KIND_LABELS,
  EVENT_KINDS,
  EVENT_RADII_KM,
  EVENT_RADIUS_DEFAULT_KM,
  EVENT_RSVP_STATES,
  EVENT_STATUSES,
  EVENT_WINDOW_DAYS,
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
  .refine((fs) => new Set(fs.map((f) => f.id)).size === fs.length, { message: "a feed id twice" });

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
