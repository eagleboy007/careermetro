import "server-only";
import { and, asc, desc, eq, gte, inArray, lt, or, sql, type SQL } from "drizzle-orm";
import { skills } from "@/content";
import { getDb } from "@/db";
import { eventRsvps, events, eventsDigests, eventTopics, userGoals, userInterests, userSettings, users } from "@/db/schema";
import { DEFAULT_TIMETABLE_SETTINGS, eventRsvpInput, PERSON_CITIES, type EventRsvpState, type EventTeaser, type PersonCity, type TimetableView, type TimetableWhy } from "@/lib/schemas";
import { EVENT_RADII_KM, EVENT_RADIUS_DEFAULT_KM, EVENT_TOPIC_KINDS, TIMETABLE_EVENTS_MAX } from "@/lib/schemas/constants";
import { interestTopicsFor, timetableFor, timetableWindow, type TimetableEvent, type TimetablePerson } from "./match";
import { FAR_RADIUS_KM, teaserRows } from "./view";

type Db = ReturnType<typeof getDb>;

/**
 * Timetable in Download your data (from export version 36): the radius, Include online and the digest choice (the
 * defaults until the person saves some), every India week the digest went out that is still kept (newest first; rows
 * go after 90 days), and the person's own Save and I'm going rows with each event's title, organiser, start and link.
 * Nobody else's rows; nothing the digest said is kept.
 */
export async function exportTimetable(userId: string, db: Db = getDb()) {
  const [[settings], digests, rsvps] = await Promise.all([
    db
      .select({ radiusKm: userSettings.eventsRadiusKm, online: userSettings.eventsOnline, digest: userSettings.eventsDigest })
      .from(userSettings)
      .where(eq(userSettings.userId, userId)),
    db.select({ week: eventsDigests.week }).from(eventsDigests).where(eq(eventsDigests.userId, userId)).orderBy(desc(eventsDigests.week)),
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
    digestWeeks: digests.map((d) => d.week),
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

/**
 * Daily cleanup (T164): events that ended more than 90 days ago. Their topics and everyone's Save and I'm going rows go
 * with them (on delete cascade), since those rows are personal data with no use once the event is long over.
 */
export async function clearEndedEvents(db: Db = getDb(), now = new Date()): Promise<{ endedEventsDeleted: number }> {
  const gone = await db
    .delete(events)
    .where(lt(events.endsAt, new Date(now.getTime() - 90 * 86_400_000)))
    .returning({ id: events.id });
  return { endedEventsDeleted: gone.length };
}

/** The radius and Include online the person saved (the defaults with no row). */
export type TimetableChoices = { radiusKm: number; online: boolean };

/** What the timetable needs about one person: from the profile, Settings, open goals and Me's interests. */
export type TimetableReader = { person: TimetablePerson; choices: TimetableChoices; why: TimetableWhy };

const isCity = (c: string | null): c is PersonCity => c !== null && (PERSON_CITIES as readonly string[]).includes(c);

/**
 * The person as the timetable sees them: the profile city (never the device), the saved radius and Include online,
 * the skills of their open goals (active or renew, swapped-to skill included) in goal order, and their interests'
 * keys. `why` names the goals and the interests as typed, for "Why you see these".
 */
export async function timetablePersonFor(userId: string, db: Db = getDb()): Promise<TimetableReader> {
  const [[user], [settings], goals, interests] = await Promise.all([
    db.select({ city: users.city }).from(users).where(eq(users.id, userId)),
    db.select({ radiusKm: userSettings.eventsRadiusKm, online: userSettings.eventsOnline }).from(userSettings).where(eq(userSettings.userId, userId)),
    db
      .select({ skillId: userGoals.skillId, swappedTo: userGoals.swappedTo })
      .from(userGoals)
      .where(and(eq(userGoals.userId, userId), inArray(userGoals.status, ["active", "renew"])))
      .orderBy(asc(userGoals.position), asc(userGoals.skillId)),
    db.select({ name: userInterests.name, nameKey: userInterests.nameKey }).from(userInterests).where(eq(userInterests.userId, userId)).orderBy(asc(userInterests.createdAt), asc(userInterests.nameKey)),
  ]);
  const radiusKm = (EVENT_RADII_KM as readonly number[]).includes(settings?.radiusKm ?? -1) ? settings!.radiusKm : EVENT_RADIUS_DEFAULT_KM;
  const online = settings?.online ?? DEFAULT_TIMETABLE_SETTINGS.online;
  const goalSkillIds = [...new Set(goals.map((g) => g.swappedTo ?? g.skillId))];
  const skillName = new Map(skills.map((s) => [s.id, s.name]));
  return {
    person: { city: isCity(user?.city ?? null) ? (user!.city as PersonCity) : null, radiusKm, online, goalSkillIds, interestKeys: interests.map((i) => i.nameKey) },
    choices: { radiusKm, online },
    why: { goals: goalSkillIds.map((id) => skillName.get(id) ?? id), interests: interests.map((i) => i.name) },
  };
}

/** Rows read at most for one person: the soonest ones; the view keeps TIMETABLE_EVENTS_MAX of those that are near enough. */
const EVENTS_READ_MAX = TIMETABLE_EVENTS_MAX * 5;

/**
 * Live events in the timetable's window with at least one topic the person's goals or interests match, soonest first,
 * each with its topics and the person's own Save or I'm going. No match to look for means no read at all.
 */
export async function liveEventsFor(userId: string, person: TimetablePerson, now: Date, db: Db = getDb()): Promise<TimetableEvent[]> {
  const goals = [...person.goalSkillIds];
  const interests = interestTopicsFor(person.interestKeys);
  const matches: SQL[] = [];
  if (goals.length) matches.push(and(eq(eventTopics.kind, "skill"), inArray(eventTopics.topic, goals))!);
  if (interests.length) matches.push(and(eq(eventTopics.kind, "interest"), inArray(eventTopics.topic, interests))!);
  if (!matches.length) return [];
  const { from, until } = timetableWindow(now);
  const rows = await db
    .select({
      id: events.id,
      title: events.title,
      organiser: events.organiser,
      kind: events.kind,
      startsAt: events.startsAt,
      endsAt: events.endsAt,
      online: events.online,
      city: events.city,
      venue: events.venue,
      cost: events.cost,
      sourceUrl: events.sourceUrl,
      status: events.status,
    })
    .from(events)
    .where(
      and(
        eq(events.status, "live"),
        gte(events.startsAt, new Date(from)),
        lt(events.startsAt, new Date(until)),
        sql`exists (select 1 from ${eventTopics} where ${eventTopics.eventId} = ${events.id} and (${or(...matches)!}))`,
      ),
    )
    .orderBy(asc(events.startsAt), asc(events.id))
    .limit(EVENTS_READ_MAX);
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const [topicRows, rsvpRows] = await Promise.all([
    db.select({ eventId: eventTopics.eventId, kind: eventTopics.kind, topic: eventTopics.topic }).from(eventTopics).where(inArray(eventTopics.eventId, ids)),
    db.select({ eventId: eventRsvps.eventId, state: eventRsvps.state }).from(eventRsvps).where(and(eq(eventRsvps.userId, userId), inArray(eventRsvps.eventId, ids))),
  ]);
  const topicsOf = new Map<string, TimetableEvent["topics"][number][]>();
  for (const t of topicRows) {
    if (!(EVENT_TOPIC_KINDS as readonly string[]).includes(t.kind)) continue;
    topicsOf.set(t.eventId, [...(topicsOf.get(t.eventId) ?? []), { kind: t.kind, topic: t.topic }]);
  }
  const rsvpOf = new Map<string, EventRsvpState>(rsvpRows.map((r) => [r.eventId, r.state]));
  return rows.map((r) => ({
    ...r,
    // A city the person list doesn't hold can't be placed, so the matcher leaves the event out.
    city: isCity(r.city) ? r.city : null,
    topics: topicsOf.get(r.id) ?? [],
    rsvp: rsvpOf.get(r.id) ?? null,
  }));
}

/**
 * The /timetable screen for one person. The view holds every match within FAR_RADIUS_KM and online ones, so the filter
 * row ("My goals", "Include online", "Show outside 25 km") works on the screen without another read; `choices` says
 * what the person saved, which the filter row starts from.
 */
export async function timetableForUser(userId: string, now = new Date(), db: Db = getDb()): Promise<{ view: TimetableView; choices: TimetableChoices; why: TimetableWhy }> {
  const { person, choices, why } = await timetablePersonFor(userId, db);
  const wide: TimetablePerson = { ...person, radiusKm: Math.max(person.radiusKm, FAR_RADIUS_KM), online: true };
  const view = timetableFor(await liveEventsFor(userId, wide, now, db), wide, now);
  return { view, choices, why };
}

/** Today's teaser: the next two live matches under the person's saved radius and Include online. Empty hides it. */
export async function timetableTeaserFor(userId: string, now = new Date(), db: Db = getDb()): Promise<EventTeaser[]> {
  const { person } = await timetablePersonFor(userId, db);
  const view = timetableFor(await liveEventsFor(userId, person, now, db), person, now);
  return teaserRows(view.groups.flatMap((g) => g.events), 2);
}

export type TimetableResult = { ok: true } | { ok: false; error: "invalid" | "not_found" };

export const TIMETABLE_MESSAGES: Record<"invalid" | "not_found", string> = {
  invalid: "That didn't work. Please try again.",
  not_found: "This event is no longer listed.",
};

/**
 * Save ("saved"), I'm going ("going"), or neither (null deletes the person's row). Only a live event can be saved or
 * marked; taking a mark off always works. Going adds no prep task yet (Timetable PR 3): changing to Save clears any
 * goal the row named, as the table requires.
 */
export async function setEventRsvp(userId: string, raw: unknown, db: Db = getDb()): Promise<TimetableResult> {
  const input = eventRsvpInput.safeParse(raw);
  if (!input.success) return { ok: false, error: "invalid" };
  const { eventId, state } = input.data;
  if (state === null) {
    await db.delete(eventRsvps).where(and(eq(eventRsvps.userId, userId), eq(eventRsvps.eventId, eventId)));
    return { ok: true };
  }
  const [event] = await db.select({ status: events.status }).from(events).where(eq(events.id, eventId));
  if (!event || event.status !== "live") return { ok: false, error: "not_found" };
  await db
    .insert(eventRsvps)
    .values({ userId, eventId, state, goalSkillId: null })
    .onConflictDoUpdate({ target: [eventRsvps.userId, eventRsvps.eventId], set: state === "saved" ? { state, goalSkillId: null } : { state } });
  return { ok: true };
}
