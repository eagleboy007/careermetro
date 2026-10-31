import { cityCentres, interestTopics, skills } from "@/content";
import { escape, hasSkill, norm, skillMatchersFor } from "@/lib/departures/feed-rules.mjs";
import { indiaDay, mondayOf } from "@/lib/ride/days";
import type {
  CityCentre,
  EventCard,
  EventRsvpState,
  EventTag,
  EventTopic,
  InterestTopic,
  PersonCity,
  Skill,
  TimetableFilter,
  TimetableGroup,
  TimetableView,
} from "@/lib/schemas";
import { EVENT_STARTED_GRACE_MS, EVENT_TAGS_MAX, EVENT_TITLE_MAX, EVENT_TOPICS_MAX, EVENT_WINDOW_DAYS, TIMETABLE_EVENTS_MAX, type EventKind } from "@/lib/schemas/constants";

/*
 * Timetable matching (docs/plans/timetable-plan.md sections 2 and 3). Plain code, no model and no network: topics come
 * from the skill taxonomy's names and aliases (the Departures feed's matcher) and the interest topic list; distance
 * comes from city centres. An event with no topic the person's goals or interests match is never returned.
 */

type Matcher = ReturnType<typeof skillMatchersFor>[number];
export type TopicMatchers = { skills: Matcher[]; interests: Matcher[] };

/**
 * Skill names that are also ordinary words in an event's text, on top of each skill's own ambiguous list: "Go to gate
 * 2", "Excel in your career" (T163).
 */
export const EVENT_AMBIGUOUS_SKILL_NAMES = ["go", "excel"] as const;

/**
 * Phrases where a common word is not the skill or the topic (T163, the PM's stoplist): "react to", "go to", "let's go",
 * "rust-proof", "excel at". They are blanked out of an event's text before any matcher reads it, so even a
 * capitalised "Go to gate 2" or "Rust-proof" at the start of a sentence names nothing.
 */
export const EVENT_STOP_PHRASES =
  /(?<![A-Za-z0-9])(?:react(?:s|ed|ing)?\s+(?:to|with|against|quickly|fast|calmly)|go(?:es|ing)?\s+(?:to|through|ahead|back|beyond|out|on|for|over|home|live|green)|gone\s+(?:to|through)|let'?s\s+go|on\s+the\s+go|ready,?\s+set,?\s+go|rust[- ]?(?:proof|proofing|resistant|free|colou?red|belt)|excel(?:s|led|ling)?\s+(?:in|at)|swift(?:ly)?\s+(?:action|response|reply|answer)|ruby\s+(?:wedding|anniversary|jubilee)|spring\s+(?:break|cleaning|season|fest|festival))(?![A-Za-z0-9])/gi;

/** Only so much of an organiser's description is read for topics (T166). */
export const EVENT_DESCRIPTION_READ_MAX = 20_000;
/** Topic slots kept for interests, so a description naming many skills can't push every interest out (T166). */
export const EVENT_INTEREST_TOPICS_RESERVED = 20;

/** A matcher's name that matches only the exact spelling, whole words only (case-aware), for an ambiguous name. */
const exactName = (name: string) => new RegExp(`(?<![A-Za-z0-9])(${escape(name)})(?![A-Za-z0-9])`);

/**
 * One matcher per skill and per interest topic, whole words only. Aliases marked ambiguous ("react", "data",
 * "networking") are left out, as the resume matcher leaves them out of free text. A name that is itself ambiguous
 * ("React", "Rust", "Go", "Security") matches only in its exact, capitalised spelling (T163), and the stop phrases
 * are blanked first, so an event never gets a topic from an ordinary word.
 */
export function topicMatchersFor(skillList: readonly Skill[], topics: readonly InterestTopic[]): TopicMatchers {
  const build = (entries: { id: string; name: string; aliases: string[]; ambiguous: readonly string[] }[]): Matcher[] => {
    const skips = entries.map((e) => new Set(e.ambiguous.map(norm)));
    const matchers = skillMatchersFor(entries.map((e, i) => ({ id: e.id, name: e.name, aliases: e.aliases.filter((a) => !skips[i].has(norm(a))) })));
    return matchers.map((m, i) => (skips[i].has(norm(entries[i].name)) ? { ...m, name: exactName(entries[i].name) } : m));
  };
  return {
    skills: build(skillList.map((s) => ({ id: s.id, name: s.name, aliases: s.aliases, ambiguous: [...s.ambiguous, ...EVENT_AMBIGUOUS_SKILL_NAMES] }))),
    interests: build(topics.map((t) => ({ id: t.key, name: t.label, aliases: t.aliases, ambiguous: t.ambiguous }))),
  };
}

let defaultMatchers: TopicMatchers | null = null;
const matchersOf = () => (defaultMatchers ??= topicMatchersFor(skills, interestTopics));

/**
 * The topics found in an event's title and the first EVENT_DESCRIPTION_READ_MAX characters of its description, with
 * the stop phrases blanked: skill ids in taxonomy order, then interest topic keys in the list's order, at most
 * EVENT_TOPICS_MAX, of which skills leave up to EVENT_INTEREST_TOPICS_RESERVED to interests. Only the topics are
 * returned; the description is never kept or logged.
 */
export function topicsOf(title: string, description: string, matchers: TopicMatchers = matchersOf()): EventTopic[] {
  const text = `${title}\n${description.slice(0, EVENT_DESCRIPTION_READ_MAX)}`.replace(EVENT_STOP_PHRASES, " ");
  const skillTopics = matchers.skills.filter((m) => hasSkill(m, text)).map((m) => ({ kind: "skill" as const, topic: m.id }));
  const interestTopicsFound = matchers.interests.filter((m) => hasSkill(m, text)).map((m) => ({ kind: "interest" as const, topic: m.id }));
  const skillRoom = EVENT_TOPICS_MAX - Math.min(interestTopicsFound.length, EVENT_INTEREST_TOPICS_RESERVED);
  return [...skillTopics.slice(0, skillRoom), ...interestTopicsFound].slice(0, EVENT_TOPICS_MAX);
}

/**
 * The interest topic keys a person's interests map to, from `user_interests.name_key` (lowercase, single spaces). An
 * interest maps only when it is a topic's key, label or alias exactly; one that maps to nothing matches nothing.
 */
export function interestTopicsFor(nameKeys: readonly string[], topics: readonly InterestTopic[] = interestTopics): string[] {
  const byTerm = new Map<string, string>();
  for (const t of topics) for (const term of [t.key, t.label, ...t.aliases]) if (!byTerm.has(norm(term))) byTerm.set(norm(term), t.key);
  const keys = nameKeys.map((k) => byTerm.get(norm(k))).filter((k): k is string => k !== undefined);
  return [...new Set(keys)];
}

const EARTH_KM = 6371;
const rad = (deg: number) => (deg * Math.PI) / 180;

/** Great-circle distance in km between two points (haversine). */
export function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Km between two cities' centres: 0 for the same city, null when either has no centre. */
export function cityDistanceKm(from: string, to: string, centres: readonly CityCentre[] = cityCentres): number | null {
  if (from === to) return 0;
  const a = centres.find((c) => c.city === from);
  const b = centres.find((c) => c.city === to);
  return a && b ? haversineKm(a, b) : null;
}

/** One live event as the store gives it to the matcher, with its topics and the person's own Save or I'm going. */
export type TimetableEvent = {
  id: string;
  title: string;
  organiser: string;
  kind: EventKind;
  startsAt: Date;
  endsAt: Date;
  online: boolean;
  city: PersonCity | null;
  venue: string | null;
  cost: string;
  sourceUrl: string;
  status: "pending" | "live" | "hidden" | "cancelled";
  topics: readonly EventTopic[];
  rsvp: EventRsvpState | null;
};

/** What the matcher knows about the person: from the profile, Settings, open goals and Me's interests. */
export type TimetablePerson = {
  city: PersonCity | null;
  radiusKm: number;
  online: boolean;
  /** Skill ids of the person's open goals, in goal order. */
  goalSkillIds: readonly string[];
  /** `user_interests.name_key` values. */
  interestKeys: readonly string[];
};

const DAY_MS = 86_400_000;
const IST_MS = 5.5 * 3600_000;
const indiaMidnight = (day: string) => new Date(Date.parse(`${day}T00:00:00Z`) - IST_MS);

/**
 * The timetable's window (T166): from two hours before `now` (an event that started a little while ago still shows) to
 * the end of the India calendar day EVENT_WINDOW_DAYS days after today, as India counts days, not rolling hours.
 * `until` is exclusive: India midnight that ends the last day.
 */
export function timetableWindow(now: Date): { from: number; until: number } {
  const lastDayAfter = new Date(Date.parse(`${indiaDay(now)}T00:00:00Z`) + (EVENT_WINDOW_DAYS + 1) * DAY_MS).toISOString().slice(0, 10);
  return { from: now.getTime() - EVENT_STARTED_GRACE_MS, until: indiaMidnight(lastDayAfter).getTime() };
}

/** "…" past the limit, like job titles. */
const clip = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s);

/** The tags an event earns for the person: goals first, in goal order, then interests, in the person's order; at most EVENT_TAGS_MAX. */
export function tagsFor(
  topics: readonly EventTopic[],
  goalSkillIds: readonly string[],
  personTopics: readonly string[],
  names: { skill: (id: string) => string; interest: (key: string) => string },
): EventTag[] {
  const skillTopics = new Set(topics.filter((t) => t.kind === "skill").map((t) => t.topic));
  const interestTopicsFound = new Set(topics.filter((t) => t.kind === "interest").map((t) => t.topic));
  const goals = [...new Set(goalSkillIds)].filter((id) => skillTopics.has(id)).map((id): EventTag => ({ kind: "goal", topic: id, label: `Goal: ${names.skill(id)}` }));
  const interests = [...new Set(personTopics)]
    .filter((key) => interestTopicsFound.has(key))
    .map((key): EventTag => ({ kind: "interest", topic: key, label: `Interest: ${names.interest(key)}` }));
  return [...goals, ...interests].slice(0, EVENT_TAGS_MAX);
}

const monthLabel = (key: string, nowYear: string) => {
  const month = new Intl.DateTimeFormat("en-GB", { month: "long", timeZone: "UTC" }).format(new Date(`${key}-01T00:00:00Z`));
  return key.slice(0, 4) === nowYear ? month : `${month} ${key.slice(0, 4)}`;
};

/**
 * Groups cards (already in start order) as the prototype does, in IST: This week (to Sunday 23:59), Later this month,
 * then one group a month.
 */
export function groupByWhen(cards: readonly EventCard[], now: Date): TimetableGroup[] {
  const today = indiaDay(now);
  const weekEnd = indiaMidnight(mondayOf(today)).getTime() + 7 * DAY_MS;
  const groups = new Map<string, TimetableGroup>();
  for (const card of cards) {
    const at = new Date(card.startsAt);
    const month = indiaDay(at).slice(0, 7);
    const key = at.getTime() < weekEnd ? "week" : month === today.slice(0, 7) ? "later" : month;
    const label = key === "week" ? "This week" : key === "later" ? "Later this month" : monthLabel(key, today.slice(0, 4));
    const group: TimetableGroup = groups.get(key) ?? { key, label, events: [] };
    group.events.push(card);
    groups.set(key, group);
  }
  return [...groups.values()];
}

/**
 * The timetable for one person: live events in the next EVENT_WINDOW_DAYS (dropping those that started more than two
 * hours ago) that match at least one of their goals or interests (only goals or only interests with that filter),
 * online ones when Include online is on, and in-person ones whose city centre is within the radius of the profile
 * city's. With no profile city only online events can show, and `noCity` asks for one. Matching events beyond the
 * radius are counted, not shown.
 */
export function timetableFor(
  events: readonly TimetableEvent[],
  person: TimetablePerson,
  now: Date,
  filter: TimetableFilter = "all",
  content: { skills?: readonly Skill[]; topics?: readonly InterestTopic[]; centres?: readonly CityCentre[] } = {},
): TimetableView {
  const skillList = content.skills ?? skills;
  const topics = content.topics ?? interestTopics;
  const centres = content.centres ?? cityCentres;
  const skillName = new Map(skillList.map((s) => [s.id, s.name]));
  const topicLabel = new Map(topics.map((t) => [t.key, t.label]));
  const names = { skill: (id: string) => skillName.get(id) ?? id, interest: (key: string) => topicLabel.get(key) ?? key };
  const personTopics = interestTopicsFor(person.interestKeys, topics);
  const { from, until } = timetableWindow(now);

  let outsideRadius = 0;
  const cards: EventCard[] = [];
  const ordered = [...events].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime() || a.title.localeCompare(b.title, "en-IN") || a.id.localeCompare(b.id, "en-IN"));
  for (const e of ordered) {
    if (e.status !== "live") continue;
    const start = e.startsAt.getTime();
    if (start < from || start >= until) continue;
    const tags = tagsFor(e.topics, person.goalSkillIds, personTopics, names).filter((t) =>
      filter === "goals" ? t.kind === "goal" : filter === "interests" ? t.kind === "interest" : true,
    );
    if (!tags.length) continue;
    let distanceKm: number | null = null;
    if (e.online) {
      if (!person.online) continue;
    } else {
      if (!person.city || !e.city) continue;
      const km = cityDistanceKm(person.city, e.city, centres);
      if (km === null) continue;
      if (km > person.radiusKm) {
        outsideRadius++;
        continue;
      }
      distanceKm = Math.round(km);
    }
    cards.push({
      id: e.id,
      title: clip(e.title, EVENT_TITLE_MAX),
      organiser: e.organiser,
      kind: e.kind,
      startsAt: e.startsAt.toISOString(),
      endsAt: e.endsAt.toISOString(),
      online: e.online,
      city: e.online ? null : e.city,
      venue: e.venue,
      cost: e.cost,
      sourceUrl: e.sourceUrl,
      tags,
      distanceKm,
      rsvp: e.rsvp,
    });
  }

  return {
    city: person.city,
    noCity: person.city === null,
    radiusKm: person.radiusKm,
    online: person.online,
    filter,
    groups: groupByWhen(cards.slice(0, TIMETABLE_EVENTS_MAX), now),
    outsideRadius,
  };
}
