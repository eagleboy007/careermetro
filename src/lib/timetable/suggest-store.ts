import "server-only";
import { and, asc, count, eq, gte, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { eventSuggestions } from "@/db/schema";
import { eventSuggestionInput, PERSON_CITIES, type EventSuggestionExport, type EventSuggestionQueue, type PersonCity } from "@/lib/schemas";
import { EVENT_SUGGESTION_AHEAD_DAYS, EVENT_SUGGESTION_QUEUE_MAX, EVENT_SUGGESTIONS_PENDING_MAX } from "@/lib/schemas/constants";
import { LIMITS, takeShared } from "@/lib/shared-limit";

/*
 * Suggest an event (Timetable PR 6, docs/plans/timetable-plan.md section 6). A signed-in member's suggestion is kept as
 * pending in event_suggestions, and that is all: members' suggestions need a grievance officer (pending item 15), so
 * nothing here shows a suggestion to another member, puts it in the feed or the digest, or copies it into `events`.
 * The table itself allows no status but pending. The link is never fetched. Nothing here logs: titles, links and
 * typed text never reach a log.
 */

type Db = ReturnType<typeof getDb>;
type Deps = { db?: Db; now?: Date };

export const EVENT_SUGGESTION_ERRORS = ["invalid", "bad_link", "past", "too_far", "limit", "too_many_pending", "duplicate"] as const;
export type EventSuggestionError = (typeof EVENT_SUGGESTION_ERRORS)[number];
export type EventSuggestionResult = { ok: true } | { ok: false; error: EventSuggestionError };

export const EVENT_SUGGESTION_MESSAGES: Record<EventSuggestionError, string> = {
  invalid: "Some details don't fit. Check the dates, the place, and that only the link box holds a link.",
  bad_link: "Paste the organiser's full https link to the event, not a short link.",
  past: "That event has already started. Suggest one that's still ahead.",
  too_far: "That's more than a year away. Suggest it nearer the date.",
  limit: "That's as many as we take in a day. Try again tomorrow.",
  too_many_pending: `You have ${EVENT_SUGGESTIONS_PENDING_MAX} suggestions waiting for review. You can send more once some of those events have passed.`,
  duplicate: "You've already suggested this event. It's waiting for review.",
};

const DAY = 86_400_000;

/**
 * "Suggest an event": the form, checked with Zod (a cleaned https link, plain text, India times, a consistent place),
 * for an event that starts ahead and within EVENT_SUGGESTION_AHEAD_DAYS. Five tries a day, each counted; at most
 * EVENT_SUGGESTIONS_PENDING_MAX of the person's suggestions for events not yet over wait at once; the same event (link
 * and start) from the same person is kept once. Always stored as pending, for no one else to see.
 */
export async function suggestEvent(userId: string, raw: unknown, deps: Deps = {}): Promise<EventSuggestionResult> {
  const input = eventSuggestionInput.safeParse(raw);
  if (!input.success) return { ok: false, error: input.error.issues.some((i) => i.path[0] === "url") ? "bad_link" : "invalid" };
  const e = input.data;
  const now = deps.now ?? new Date();
  if (e.startsAt.getTime() <= now.getTime()) return { ok: false, error: "past" };
  if (e.startsAt.getTime() > now.getTime() + EVENT_SUGGESTION_AHEAD_DAYS * DAY) return { ok: false, error: "too_far" };
  const db = deps.db ?? getDb();
  return db.transaction(async (tx): Promise<EventSuggestionResult> => {
    if (!(await takeShared(LIMITS.eventSuggestionsPerUserDay, userId, { db: tx, now: now.getTime() }))) return { ok: false, error: "limit" };
    // One at a time per person, so two sends can't both pass the last free place.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`cm-event-suggest:${userId}`}))`);
    const [waiting] = await tx
      .select({ n: count() })
      .from(eventSuggestions)
      .where(and(eq(eventSuggestions.userId, userId), gte(eventSuggestions.endsAt, now)));
    if (waiting.n >= EVENT_SUGGESTIONS_PENDING_MAX) return { ok: false, error: "too_many_pending" };
    const added = await tx
      .insert(eventSuggestions)
      .values({
        userId,
        sourceUrl: e.url.url,
        host: e.url.host,
        title: e.title,
        organiser: e.organiser,
        kind: e.kind,
        startsAt: e.startsAt,
        endsAt: e.endsAt,
        online: e.online,
        city: e.city,
        venue: e.venue,
        cost: e.cost,
        status: "pending",
        createdAt: now,
      })
      .onConflictDoNothing()
      .returning({ id: eventSuggestions.id });
    return added.length ? { ok: true } : { ok: false, error: "duplicate" };
  });
}

/** How many of the person's own suggestions for events not yet over are waiting, for "N waiting for review". */
export async function pendingSuggestionCount(userId: string, now = new Date(), db: Db = getDb()): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(eventSuggestions)
    .where(and(eq(eventSuggestions.userId, userId), eq(eventSuggestions.status, "pending"), gte(eventSuggestions.endsAt, now)));
  return row?.n ?? 0;
}

const isCity = (c: string | null): c is PersonCity => c !== null && (PERSON_CITIES as readonly string[]).includes(c);

/** For Download your data (from export version 37): every suggestion the person sent that we still keep, oldest first. */
export async function exportEventSuggestions(userId: string, db: Db = getDb()): Promise<EventSuggestionExport[]> {
  const rows = await db
    .select({
      sourceUrl: eventSuggestions.sourceUrl,
      title: eventSuggestions.title,
      organiser: eventSuggestions.organiser,
      kind: eventSuggestions.kind,
      startsAt: eventSuggestions.startsAt,
      endsAt: eventSuggestions.endsAt,
      online: eventSuggestions.online,
      city: eventSuggestions.city,
      venue: eventSuggestions.venue,
      cost: eventSuggestions.cost,
      status: eventSuggestions.status,
      createdAt: eventSuggestions.createdAt,
    })
    .from(eventSuggestions)
    .where(eq(eventSuggestions.userId, userId))
    .orderBy(asc(eventSuggestions.createdAt), asc(eventSuggestions.id));
  return rows.map((r) => ({ ...r, city: isCity(r.city) ? r.city : null }));
}

/**
 * The pending queue on /admin/reports, for admins only (the caller checks, src/lib/admin/server.ts): how many wait, and
 * the oldest EVENT_SUGGESTION_QUEUE_MAX with what was sent and when, never who sent it. Read only: nothing can publish
 * a member's suggestion until a grievance officer is named.
 */
export async function eventSuggestionQueueFor(db: Db = getDb()): Promise<EventSuggestionQueue> {
  const [[total], rows] = await Promise.all([
    db.select({ n: count() }).from(eventSuggestions).where(eq(eventSuggestions.status, "pending")),
    db
      .select({
        id: eventSuggestions.id,
        sourceUrl: eventSuggestions.sourceUrl,
        host: eventSuggestions.host,
        title: eventSuggestions.title,
        organiser: eventSuggestions.organiser,
        kind: eventSuggestions.kind,
        startsAt: eventSuggestions.startsAt,
        endsAt: eventSuggestions.endsAt,
        online: eventSuggestions.online,
        city: eventSuggestions.city,
        venue: eventSuggestions.venue,
        cost: eventSuggestions.cost,
        createdAt: eventSuggestions.createdAt,
      })
      .from(eventSuggestions)
      .where(eq(eventSuggestions.status, "pending"))
      .orderBy(asc(eventSuggestions.createdAt), asc(eventSuggestions.id))
      .limit(EVENT_SUGGESTION_QUEUE_MAX),
  ]);
  return {
    total: Math.max(total?.n ?? 0, rows.length),
    rows: rows.map((r) => ({
      ...r,
      city: isCity(r.city) ? r.city : null,
      startsAt: r.startsAt.toISOString(),
      endsAt: r.endsAt.toISOString(),
      createdAt: r.createdAt.toISOString(),
    })),
  };
}
