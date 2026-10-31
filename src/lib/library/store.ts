import "server-only";
import { and, asc, count, eq, inArray, isNotNull, isNull, lt, ne, sql } from "drizzle-orm";
import { getDb } from "@/db";
import type { Tx } from "@/db/lock";
import { resourceReports, resources, resourceSuggestions, rideDays, userGoals, userResources } from "@/db/schema";
import { resources as catalog, eliteShelfEntries, roleProfiles, skillGroupMembers, skills } from "@/content";
import { eliteOn } from "@/lib/elite/store";
import { swappedSkill } from "@/lib/goals/not-for-me";
import { goalOnCurrentLine } from "@/lib/gaps/current";
import { goalsOf } from "@/lib/goals/store";
import { unreviewedAllowed } from "@/lib/mock/rules";
import { addedTaskId, buildRide, goalForAdded, MAX_COURSES, rideParts } from "@/lib/ride/build";
import { indiaDay } from "@/lib/ride/days";
import { rideGoalsFor } from "@/lib/ride/store";
import {
  libraryActionInput,
  resourceReportInput,
  suggestionInput,
  type EliteShelfView,
  type LibraryExport,
  type LibraryLanguage,
  type LibraryView,
  type ResourceReportExport,
  type ResourceSuggestionExport,
} from "@/lib/schemas";
import { ON_RIDE_MAX, SUGGESTIONS_OPEN_MAX } from "@/lib/schemas/constants";
import { LIMITS, takeShared } from "@/lib/shared-limit";
import { buildLibrary, type LibraryMarks } from "./build";
import { linkKey } from "./links";
import { buildEliteShelf } from "./shelf";

type Db = ReturnType<typeof getDb>;

const skillNames: ReadonlyMap<string, string> = new Map(skills.map((s) => [s.id, s.name]));
/** The language each catalog link is taught in. The table has no column for it, so it comes from the catalog file. */
const languageByUrl: ReadonlyMap<string, LibraryLanguage> = new Map(catalog.flatMap((r) => (r.language ? [[r.url, r.language] as const] : [])));

/** The catalog's skills by URL, for putting the Elite shelf's free sources for the person's goals first. */
const skillIdsByUrl: ReadonlyMap<string, readonly string[]> = new Map(catalog.map((r) => [r.url, r.skillIds]));

/** The healthy catalog, as the path builder reads it: only links the link check hasn't marked broken and no admin hid. Read only. */
async function healthyCatalog(db: Db) {
  return db
    .select({
      id: resources.id,
      title: resources.title,
      url: resources.url,
      provider: resources.provider,
      kind: resources.kind,
      minutes: resources.minutes,
      free: resources.free,
      skillIds: resources.skillIds,
    })
    .from(resources)
    .where(and(eq(resources.healthy, true), eq(resources.free, true), isNull(resources.hiddenAt)))
    .orderBy(asc(resources.title), asc(resources.id));
}

/** The person's own marks (user_resources), by their user id only: saved newest first, finished ticks and Add to my rides. */
async function marksOf(userId: string, db: Db): Promise<LibraryMarks> {
  const rows = await db
    .select({ id: userResources.resourceId, savedAt: userResources.savedAt, finishedAt: userResources.finishedAt, onRideAt: userResources.onRideAt })
    .from(userResources)
    .where(eq(userResources.userId, userId));
  const time = (d: Date | null) => d?.getTime() ?? 0;
  return {
    saved: rows
      .filter((r) => r.savedAt)
      .sort((a, b) => time(b.savedAt) - time(a.savedAt) || a.id.localeCompare(b.id))
      .map((r) => r.id),
    ticked: rows.filter((r) => r.finishedAt).map((r) => r.id),
    added: rows
      .filter((r) => r.onRideAt && !r.finishedAt)
      .sort((a, b) => time(a.onRideAt) - time(b.onRideAt) || a.id.localeCompare(b.id))
      .map((r) => r.id),
  };
}

/**
 * The signed-in person's Library (FR-51, handoff 12a), read only: their open goals in map order with the path's
 * courses and more free ones from the catalog, the courses on today's ride, and what they ticked themselves (ride
 * tasks, or a learn pitstop marked done on the Path). With no current analysis it is the catalog alone, for search.
 * Nothing here writes: goals are synced the same way Today and the Map sync them.
 */
export async function libraryFor(userId: string, now = new Date(), db: Db = getDb()): Promise<LibraryView> {
  const [line, rows, days, marks] = await Promise.all([
    rideGoalsFor(userId, db),
    healthyCatalog(db),
    db.select({ day: rideDays.day, taskIds: rideDays.taskIds }).from(rideDays).where(eq(rideDays.userId, userId)),
    marksOf(userId, db),
  ]);
  const today = indiaDay(now);
  const ticked = new Set(days.flatMap((d) => d.taskIds));
  if (!line) {
    return buildLibrary({ role: null, pathHref: null, goals: [], learnSkill: new Map(), catalog: rows, languageByUrl, skillNames, ticked, ride: null, marks });
  }
  const own = await goalsOf(userId, db);
  const learnSkill = new Map(own.map((g) => [g.id, swappedSkill(g, skillGroupMembers) ?? g.skillId]));
  const ride = buildRide({
    goals: line.goals,
    path: line.path,
    doneBefore: new Set(days.filter((d) => d.day < today).flatMap((d) => d.taskIds)),
    doneToday: new Set(days.find((d) => d.day === today)?.taskIds ?? []),
    doneThisWeek: new Set(),
  });
  const role = roleProfiles.find((r) => r.slug === line.result.roleSlug);
  return buildLibrary({
    role: role?.title ?? line.result.roleSlug,
    pathHref: line.path.href,
    goals: line.goals,
    learnSkill,
    catalog: rows,
    languageByUrl,
    skillNames,
    ticked,
    ride,
    marks,
  });
}

/**
 * The Library's Elite tab (FR-50 part 5, handoff 12l) for the person whose Library this is: eliteOn decides whether it
 * opens. Free sources come from the same healthy catalog as the rest of the Library; playbooks and drills not yet
 * checked by someone in the role show on local and preview deployments only.
 */
export async function eliteShelfFor(userId: string, view: LibraryView, db: Db = getDb()): Promise<EliteShelfView> {
  return buildEliteShelf({
    elite: await eliteOn(userId, db),
    entries: eliteShelfEntries,
    items: view.items,
    skillIdsByUrl,
    goals: view.goals,
    allowUnreviewed: unreviewedAllowed(),
  });
}

/* Library part 2 (docs/plans/library-part-2-plan.md) ---------------------------------------------------------------
 * Save, "I finished this", Add to my rides, Report a broken link and Suggest a free resource. Every write takes
 * Zod-checked input, is scoped to the session user in its WHERE clause and counted against its daily limit inside the
 * transaction. Nothing here logs: titles, links and marks never reach a log. */

type Deps = { db?: Db; now?: Date };

export const LIBRARY_ERRORS = ["invalid", "limit", "not_found", "ride_full", "not_on_goals", "bad_link", "duplicate", "too_many_open"] as const;
export type LibraryError = (typeof LIBRARY_ERRORS)[number];
export type LibraryResult = { ok: true } | { ok: false; error: LibraryError; resourceId?: string | null };

export const LIBRARY_MESSAGES: Record<LibraryError, string> = {
  invalid: "That didn't work. Please refresh the page and try again.",
  limit: "That's as many as we take in a day. Try again tomorrow.",
  not_found: "That link isn't in the Library any more. Refresh the page to see the latest.",
  ride_full: `You have ${ON_RIDE_MAX} on your rides. Finish or remove one first.`,
  not_on_goals: "This one isn't for a goal on your line, so it can't go on a ride.",
  bad_link: "Paste a full https link to a free resource.",
  duplicate: "That link is already in the Library.",
  too_many_open: `You have ${SUGGESTIONS_OPEN_MAX} suggestions waiting for a reviewer. Send more once some are checked.`,
};

const DAY = 24 * 60 * 60 * 1000;
/** Decided reports and suggestions are deleted this long after the decision. */
export const DECIDED_KEEP_DAYS = 180;

const COLUMN = { saved: "savedAt", finished: "finishedAt", onRide: "onRideAt" } as const;
/** The one column a mark writes, set to `value`. */
const stamp = (mark: keyof typeof COLUMN, value: Date | null) =>
  mark === "saved" ? { savedAt: value } : mark === "finished" ? { finishedAt: value } : { onRideAt: value };

/** One resource as a mark needs it. */
async function resourceRow(db: Db | Tx, resourceId: string) {
  const [row] = await db
    .select({ id: resources.id, minutes: resources.minutes, skillIds: resources.skillIds, healthy: resources.healthy, free: resources.free, hiddenAt: resources.hiddenAt })
    .from(resources)
    .where(eq(resources.id, resourceId))
    .limit(1);
  return row ?? null;
}

const listed = (r: { healthy: boolean; free: boolean; hiddenAt: Date | null }) => r.healthy && r.free && !r.hiddenAt;

/**
 * Items on the person's rides now: added, not ticked as finished, and with a part still to do. An item whose last
 * part was ticked on a ride is finished, so it no longer counts toward the five.
 */
async function onRideCount(tx: Tx, userId: string): Promise<number> {
  const rows = await tx
    .select({ id: userResources.resourceId, minutes: resources.minutes })
    .from(userResources)
    .innerJoin(resources, eq(resources.id, userResources.resourceId))
    .where(
      and(
        eq(userResources.userId, userId),
        isNotNull(userResources.onRideAt),
        isNull(userResources.finishedAt),
        // The same rows the ride reads (addedResources in src/lib/ride/store.ts): a broken, paid or hidden link
        // leaves the ride, so it holds no slot either.
        eq(resources.healthy, true),
        eq(resources.free, true),
        isNull(resources.hiddenAt),
      ),
    );
  if (!rows.length) return 0;
  const ticked = await tx
    .selectDistinct({ id: sql<string>`unnest(${rideDays.taskIds})` })
    .from(rideDays)
    .where(eq(rideDays.userId, userId));
  const done = new Set(ticked.map((t) => t.id));
  return rows.filter((r) => !done.has(addedTaskId(r.id, rideParts(r.minutes)))).length;
}

/**
 * The bookmark, "I finished this" or Add to my rides, on or off. Turning one on needs a healthy, free link no admin
 * hid; turning one off always works. A row with no mark left is deleted. Add to my rides also needs an open goal on
 * the person's line that the link teaches, and room: at most five at once. Unticking "I finished this" takes back
 * only the box's tick, never a ride or Path tick.
 */
export async function setLibraryMark(userId: string, raw: unknown, deps: Deps = {}): Promise<LibraryResult> {
  const input = libraryActionInput.safeParse(raw);
  if (!input.success) return { ok: false, error: "invalid" };
  const { resourceId, mark, on } = input.data;
  const db = deps.db ?? getDb();
  const now = deps.now ?? new Date();
  // Whether the link is for an open goal is read first, outside the transaction, as a ride tick reads the line.
  if (mark === "onRide" && on) {
    const [line, found] = await Promise.all([rideGoalsFor(userId, db, { sync: false }), resourceRow(db, resourceId)]);
    const goal = found && listed(found) ? goalForAdded(line?.goals ?? [], found.skillIds) : null;
    if (found && listed(found) && !goal) {
      if (!(await takeShared(LIMITS.libraryChangesPerUserDay, userId, { db, now: now.getTime() }))) return { ok: false, error: "limit" };
      return { ok: false, error: "not_on_goals" };
    }
    // One of the goal's own ride courses is on the rides already, ticked as that course; an added row for it would
    // never be ticked as res:… and would hold a slot for good. So nothing is written.
    if (goal?.resources.slice(0, MAX_COURSES).some((c) => c.id === resourceId)) {
      if (!(await takeShared(LIMITS.libraryChangesPerUserDay, userId, { db, now: now.getTime() }))) return { ok: false, error: "limit" };
      return { ok: true };
    }
  }
  const column = COLUMN[mark];
  return db.transaction(async (tx): Promise<LibraryResult> => {
    if (!(await takeShared(LIMITS.libraryChangesPerUserDay, userId, { db: tx, now: now.getTime() }))) return { ok: false, error: "limit" };
    // The same lock as a ride tick, so the five-item cap and today's ride are read one change at a time.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`cm-ride:${userId}`}))`);
    const found = await resourceRow(tx, resourceId);
    if (!found) return { ok: false, error: "not_found" };
    const where = and(eq(userResources.userId, userId), eq(userResources.resourceId, resourceId));
    const [row] = await tx
      .select({ savedAt: userResources.savedAt, finishedAt: userResources.finishedAt, onRideAt: userResources.onRideAt })
      .from(userResources)
      .where(where)
      .limit(1)
      .for("update");
    if (on) {
      if (!listed(found)) return { ok: false, error: "not_found" };
      if (row?.[column]) return { ok: true };
      if (mark === "onRide" && (await onRideCount(tx, userId)) >= ON_RIDE_MAX) return { ok: false, error: "ride_full" };
      await tx
        .insert(userResources)
        .values({ userId, resourceId, ...stamp(mark, now), updatedAt: now })
        .onConflictDoUpdate({ target: [userResources.userId, userResources.resourceId], set: { ...stamp(mark, now), updatedAt: now } });
      return { ok: true };
    }
    if (!row || !row[column]) return { ok: true };
    const rest = { ...row, ...stamp(mark, null) };
    if (!rest.savedAt && !rest.finishedAt && !rest.onRideAt) await tx.delete(userResources).where(where);
    else await tx.update(userResources).set({ ...stamp(mark, null), updatedAt: now }).where(where);
    return { ok: true };
  });
}

/**
 * "Report a broken link": one open report per person and link. A second report of the same link by the same person
 * stores nothing new and says the same. A link an admin hid takes no new reports. No note, so nothing typed is kept.
 */
export async function reportResource(userId: string, raw: unknown, deps: Deps = {}): Promise<LibraryResult> {
  const input = resourceReportInput.safeParse(raw);
  if (!input.success) return { ok: false, error: "invalid" };
  const { resourceId, reason } = input.data;
  const db = deps.db ?? getDb();
  const now = deps.now ?? new Date();
  return db.transaction(async (tx): Promise<LibraryResult> => {
    if (!(await takeShared(LIMITS.resourceReportsPerUserDay, userId, { db: tx, now: now.getTime() }))) return { ok: false, error: "limit" };
    const found = await resourceRow(tx, resourceId);
    if (!found || found.hiddenAt) return { ok: false, error: "not_found" };
    // The unique index on open reports (resource, person) keeps it to one, however often it is sent.
    await tx.insert(resourceReports).values({ resourceId, userId, reason, createdAt: now }).onConflictDoNothing();
    return { ok: true };
  });
}

/**
 * The skills of the person's open goals (not skipped or met), the swapped-to skill included: what a suggestion may name
 * (FR-51, T88). Goals left on the earlier line after a change of destination don't count (`goalOnCurrentLine`).
 */
async function openGoalSkills(userId: string, db: Db): Promise<Set<string>> {
  const rows = await db
    .select({ skillId: userGoals.skillId, swappedTo: userGoals.swappedTo })
    .from(userGoals)
    .where(and(eq(userGoals.userId, userId), inArray(userGoals.status, ["active", "renew"]), goalOnCurrentLine));
  return new Set(rows.flatMap((r) => (r.swappedTo ? [r.skillId, r.swappedTo] : [r.skillId])));
}

/**
 * "Suggest a free resource": a cleaned https link (never fetched here) and the skill of one of the person's open
 * goals, or null for Other; any other skill is "invalid". A link already in the catalog is "duplicate" and stores
 * nothing; the result names the catalog item when the Library shows it. Five a day, and thirty waiting at once; the
 * same link from the same person is kept once.
 */
export async function suggestResource(userId: string, raw: unknown, deps: Deps = {}): Promise<LibraryResult> {
  const input = suggestionInput.safeParse(raw);
  if (!input.success) return { ok: false, error: input.error.issues.some((i) => i.path[0] === "url") ? "bad_link" : "invalid" };
  const { url: link, skillId } = input.data;
  if (skillId !== null && !skillNames.has(skillId)) return { ok: false, error: "invalid" };
  const db = deps.db ?? getDb();
  if (skillId !== null && !(await openGoalSkills(userId, db)).has(skillId)) return { ok: false, error: "invalid" };
  const now = deps.now ?? new Date();
  return db.transaction(async (tx): Promise<LibraryResult> => {
    if (!(await takeShared(LIMITS.resourceSuggestionsPerUserDay, userId, { db: tx, now: now.getTime() }))) return { ok: false, error: "limit" };
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`cm-suggest:${userId}`}))`);
    const key = linkKey(link.url);
    const rows = await tx.select({ id: resources.id, url: resources.url, healthy: resources.healthy, free: resources.free, hiddenAt: resources.hiddenAt }).from(resources);
    const match = rows.find((r) => linkKey(r.url) === key);
    if (match) return { ok: false, error: "duplicate", resourceId: listed(match) ? match.id : null };
    const [open] = await tx
      .select({ n: count() })
      .from(resourceSuggestions)
      .where(and(eq(resourceSuggestions.userId, userId), eq(resourceSuggestions.status, "open")));
    if (open.n >= SUGGESTIONS_OPEN_MAX) return { ok: false, error: "too_many_open" };
    await tx.insert(resourceSuggestions).values({ userId, url: link.url, host: link.host, skillId, createdAt: now }).onConflictDoNothing();
    return { ok: true };
  });
}

/** For Download your data (export version 28): the person's Library marks, the links they reported and the links they suggested. */
export async function exportLibrary(
  userId: string,
  db: Db = getDb(),
): Promise<{ library: LibraryExport; resourceReports: ResourceReportExport[]; resourceSuggestions: ResourceSuggestionExport[] }> {
  const [marks, reports, suggestions] = await Promise.all([
    db
      .select({ title: resources.title, url: resources.url, savedAt: userResources.savedAt, finishedAt: userResources.finishedAt, onRideAt: userResources.onRideAt })
      .from(userResources)
      .innerJoin(resources, eq(resources.id, userResources.resourceId))
      .where(eq(userResources.userId, userId))
      .orderBy(asc(userResources.updatedAt), asc(resources.id)),
    db
      .select({ title: resources.title, reason: resourceReports.reason, status: resourceReports.status, createdAt: resourceReports.createdAt })
      .from(resourceReports)
      .innerJoin(resources, eq(resources.id, resourceReports.resourceId))
      .where(eq(resourceReports.userId, userId))
      .orderBy(asc(resourceReports.createdAt), asc(resourceReports.id)),
    db
      .select({ url: resourceSuggestions.url, status: resourceSuggestions.status, createdAt: resourceSuggestions.createdAt })
      .from(resourceSuggestions)
      .where(eq(resourceSuggestions.userId, userId))
      .orderBy(asc(resourceSuggestions.createdAt), asc(resourceSuggestions.id)),
  ]);
  const of = (at: "savedAt" | "finishedAt" | "onRideAt") =>
    marks.flatMap((m) => (m[at] ? [{ title: m.title, url: m.url, at: m[at]!.toISOString() }] : []));
  return {
    library: { saved: of("savedAt"), finished: of("finishedAt"), onRide: of("onRideAt") },
    resourceReports: reports.map((r) => ({ title: r.title, reason: r.reason, status: r.status, created_at: r.createdAt.toISOString() })),
    resourceSuggestions: suggestions.map((s) => ({ url: s.url, status: s.status, created_at: s.createdAt.toISOString() })),
  };
}

/** The daily cleanup: reports and suggestions decided more than 180 days ago. Open ones stay until decided. */
export async function clearOldLibraryRecords(db: Db = getDb(), now = new Date()): Promise<{ resourceReportsDeleted: number; resourceSuggestionsDeleted: number }> {
  const cutoff = new Date(now.getTime() - DECIDED_KEEP_DAYS * DAY);
  const reports = await db
    .delete(resourceReports)
    .where(and(ne(resourceReports.status, "open"), isNotNull(resourceReports.decidedAt), lt(resourceReports.decidedAt, cutoff)))
    .returning({ id: resourceReports.id });
  const suggestions = await db
    .delete(resourceSuggestions)
    .where(and(ne(resourceSuggestions.status, "open"), isNotNull(resourceSuggestions.decidedAt), lt(resourceSuggestions.decidedAt, cutoff)))
    .returning({ id: resourceSuggestions.id });
  return { resourceReportsDeleted: reports.length, resourceSuggestionsDeleted: suggestions.length };
}
