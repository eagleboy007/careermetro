import "server-only";
import { and, asc, count, desc, eq, gt, isNotNull, inArray, isNull, lt, sql } from "drizzle-orm";
import { getDb } from "@/db";
import type { Tx } from "@/db/lock";
import { jobFeedRuns, jobPosts, jobSaves, userSettings } from "@/db/schema";
import { currentAnalysis, type CurrentAnalysis } from "@/lib/gaps/current";
import { goalsOf, provedSkills } from "@/lib/goals/store";
import { getResumeForOwner } from "@/lib/resume/store";
import { clearStageInput, saveInput, stageInput, type DepartureExport } from "@/lib/schemas";
import { APPLY_STAGES } from "@/lib/schemas/constants";
import { LIMITS, takeShared } from "@/lib/shared-limit";
import type { FitContext, StoredPost } from "./fit";

/*
 * Live Departures (docs/plans/departures-live-plan.md): the open posts of the daily feed, the person's own Saved and
 * Applied lists (job_saves), and what fit is read against. Every write takes Zod-checked input and is scoped to the
 * session user in its WHERE clause. Nothing here logs: post titles, saves and stages never reach a log.
 */

type Db = ReturnType<typeof getDb>;
/** `listMax` stands in for OWN_LIST_MAX in tests. */
type Deps = { db?: Db; now?: Date; listMax?: number };

/** Open posts sent to the page, newest first. Saved and applied posts come too, whatever their age or state. */
export const PAGE_POSTS = 300;
/**
 * Saved and Applied each hold at most this many posts a person (T91): a new save or application past it is refused,
 * and the page loads at most this many of each, newest first, so a render never reads an unbounded list.
 */
export const OWN_LIST_MAX = 200;
/** Closed posts (and their saves) go this long after closing: the same 180 days a company keeps access. */
export const CLOSED_KEEP_DAYS = 180;
/** Feed runs are kept this long. */
export const RUN_KEEP_DAYS = 90;
const DAY = 24 * 60 * 60 * 1000;

export const DEPARTURE_ERRORS = ["invalid", "limit", "not_found", "closed", "saved_full", "applied_full"] as const;
export type DepartureError = (typeof DEPARTURE_ERRORS)[number];
export type DepartureResult = { ok: true } | { ok: false; error: DepartureError };

export const DEPARTURE_MESSAGES: Record<DepartureError, string> = {
  invalid: "That didn't work. Please refresh the page and try again.",
  limit: "That's as many changes as we allow in a day. Try again tomorrow.",
  not_found: "That role isn't on Departures any more. Refresh the page to see the latest roles.",
  closed: "This role has closed on the company's board, so it can't be saved or applied to now.",
  saved_full: `You have ${OWN_LIST_MAX} saved roles, as many as we keep. Take one off Saved first.`,
  applied_full: `You're tracking ${OWN_LIST_MAX} applications, as many as we keep. Use "I didn't apply" on one you don't need first.`,
};

const postColumns = {
  id: jobPosts.id,
  title: jobPosts.title,
  company: jobPosts.company,
  city: jobPosts.city,
  workType: jobPosts.workType,
  experienceNote: jobPosts.experienceNote,
  roleSlug: jobPosts.roleSlug,
  requiredSkillIds: jobPosts.requiredSkillIds,
  niceSkillIds: jobPosts.niceSkillIds,
  url: jobPosts.url,
  postedAt: jobPosts.postedAt,
  firstSeenAt: jobPosts.firstSeenAt,
  closedAt: jobPosts.closedAt,
};

export type DeparturesBoard = {
  /** Open posts newest first, then the person's saved or applied posts not among them (closed ones included). */
  posts: StoredPost[];
  saved: string[];
  applied: [string, number][];
  /** When the last run that read at least one board finished; null before the first. */
  updatedAt: Date | null;
};

/** When the last good feed run finished: one that read at least one board. */
export async function lastFeedRun(db: Db | Tx = getDb()): Promise<Date | null> {
  const [row] = await db
    .select({ finishedAt: jobFeedRuns.finishedAt })
    .from(jobFeedRuns)
    .where(and(isNotNull(jobFeedRuns.finishedAt), gt(jobFeedRuns.boardsOk, 0)))
    .orderBy(desc(jobFeedRuns.finishedAt))
    .limit(1);
  return row?.finishedAt ?? null;
}

/** Newest first by posted time (first seen when the post gives none), then id: the order the open posts index keeps. */
const newestFirst = (a: StoredPost, b: StoredPost) =>
  (b.postedAt ?? b.firstSeenAt).getTime() - (a.postedAt ?? a.firstSeenAt).getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * The board for one person (null: signed out, open posts only). Read only. `roleSlug` (the page's `?role=`) keeps only
 * posts read as that role, the person's own included. Saved and Applied are read as at most `ownMax` each, newest
 * change first (OWN_LIST_MAX, which the writes keep them under).
 *
 * Besides the newest `limit` open posts anywhere, the newest `limit` in the places `placesOf`'s person is open to work
 * in (Settings, FR-55) and in `city` (the City filter, `?city=`) are read too, so a city's roles aren't only those
 * that happen to be among the newest in India.
 */
export async function departuresBoard(
  userId: string | null,
  {
    db = getDb(),
    limit = PAGE_POSTS,
    roleSlug = null,
    ownMax = OWN_LIST_MAX,
    placesOf = null,
    city = null,
  }: { db?: Db; limit?: number; roleSlug?: string | null; ownMax?: number; placesOf?: string | null; city?: string | null } = {},
): Promise<DeparturesBoard> {
  const ofRole = roleSlug ? eq(jobPosts.roleSlug, roleSlug) : undefined;
  // Each read on its own, so the picked city's roles don't crowd out the places' (or the other way).
  const inPlaces = placesOf
    ? sql`${jobPosts.city} = any(coalesce((select ${userSettings.openToWorkIn} from ${userSettings} where ${userSettings.userId} = ${placesOf}), '{}'::text[]))`
    : undefined;
  const inCity = city ? eq(jobPosts.city, city) : undefined;
  const openOf = (where: ReturnType<typeof and>) =>
    db
      .select(postColumns)
      .from(jobPosts)
      .where(and(isNull(jobPosts.closedAt), ofRole, where))
      .orderBy(desc(sql`coalesce(${jobPosts.postedAt}, ${jobPosts.firstSeenAt})`), asc(jobPosts.id))
      .limit(limit);
  const ownOf = (id: string, list: "saved" | "applied") =>
    db
      .select({ ...postColumns, savedAt: jobSaves.savedAt, stage: jobSaves.stage })
      .from(jobSaves)
      .innerJoin(jobPosts, eq(jobPosts.id, jobSaves.jobPostId))
      .where(and(eq(jobSaves.userId, id), list === "saved" ? isNotNull(jobSaves.savedAt) : isNotNull(jobSaves.stage), ofRole))
      .orderBy(desc(jobSaves.updatedAt), asc(jobSaves.id))
      .limit(ownMax);
  type OwnRow = Awaited<ReturnType<typeof ownOf>>[number];
  // Each list on its own, so a saved row past the Applied cap (or the other way) doesn't slip into the other list.
  const ownRows = async (id: string): Promise<{ saved: OwnRow[]; applied: OwnRow[] }> => {
    const [saved, applied] = await Promise.all([ownOf(id, "saved"), ownOf(id, "applied")]);
    return { saved, applied };
  };
  const [newest, placed, picked, own, updatedAt] = await Promise.all([
    openOf(undefined),
    inPlaces ? openOf(inPlaces) : Promise.resolve([]),
    inCity ? openOf(inCity) : Promise.resolve([]),
    userId ? ownRows(userId) : Promise.resolve({ saved: [] as OwnRow[], applied: [] as OwnRow[] }),
    lastFeedRun(db),
  ]);
  const open = [...new Map([...newest, ...placed, ...picked].map((p) => [p.id, p])).values()].sort(newestFirst);
  const ids = new Set(open.map((p) => p.id));
  const posts: StoredPost[] = [...open];
  for (const r of [...own.saved, ...own.applied]) {
    if (ids.has(r.id)) continue;
    ids.add(r.id);
    posts.push(r);
  }
  return {
    posts,
    saved: own.saved.map((r) => r.id),
    // Applied to Offer only: a job marked Not this time or Withdrawn in My jobs has no tracker step on Departures.
    applied: own.applied.filter((r) => r.stage! <= 4).map((r) => [r.id, r.stage!] as [string, number]),
    updatedAt,
  };
}

/**
 * What fit is read against: the latest confirmed profile of the resume the person's current analysis came from, the
 * line's target role, the skills of their open goals and their current proof. Null with no confirmed resume.
 * `read` is `currentAnalysis` already read in this request (null for none); left out, it is read here.
 */
export async function fitContextFor(userId: string, db: Db = getDb(), read?: CurrentAnalysis | null): Promise<FitContext | null> {
  const analysis = read === undefined ? await currentAnalysis(userId, db) : read;
  if (!analysis) return null;
  const [resume, goals, proved] = await Promise.all([getResumeForOwner(analysis.resumeId, { userId }, db), goalsOf(userId, db), provedSkills(userId, db)]);
  if (!resume?.confirmed) return null;
  const goalSkillIds = new Set(goals.filter((g) => g.status === "active" || g.status === "renew").flatMap((g) => (g.swappedTo ? [g.skillId, g.swappedTo] : [g.skillId])));
  return { profile: resume.profile, targetSlug: analysis.result.roleSlug, goalSkillIds, proved: new Set(proved) };
}

/** The post and the person's row on it, read under the transaction. */
async function postAndRow(tx: Tx, userId: string, postId: string) {
  const [post] = await tx.select({ closedAt: jobPosts.closedAt }).from(jobPosts).where(eq(jobPosts.id, postId)).limit(1);
  if (!post) return null;
  const [row] = await tx
    .select({ savedAt: jobSaves.savedAt, stage: jobSaves.stage })
    .from(jobSaves)
    .where(and(eq(jobSaves.userId, userId), eq(jobSaves.jobPostId, postId)))
    .limit(1)
    .for("update");
  return { closed: post.closedAt !== null, row: row ?? null };
}

/**
 * Runs one change in a transaction, counting the try against the day's 200 first, then holding the person's
 * Departures lock so two changes at once can't both pass the OWN_LIST_MAX count.
 */
async function change(userId: string, deps: Deps, fn: (tx: Tx, now: Date) => Promise<DepartureResult>): Promise<DepartureResult> {
  const db = deps.db ?? getDb();
  const now = deps.now ?? new Date();
  return db.transaction(async (tx) => {
    if (!(await takeShared(LIMITS.departureChangesPerUserDay, userId, { db: tx, now: now.getTime() }))) return { ok: false, error: "limit" };
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`cm-departures:${userId}`}))`);
    return fn(tx, now);
  });
}

/** Whether the person's Saved or Applied list is already at its cap (OWN_LIST_MAX). */
async function listFull(tx: Tx, userId: string, list: "saved" | "applied", max: number): Promise<boolean> {
  const [row] = await tx
    .select({ n: count() })
    .from(jobSaves)
    .where(and(eq(jobSaves.userId, userId), list === "saved" ? isNotNull(jobSaves.savedAt) : isNotNull(jobSaves.stage)));
  return row.n >= max;
}

/**
 * The bookmark. Saving a closed post is refused unless it is already saved; taking one off Saved always works, and
 * keeps the row only while it still has a stage.
 */
export async function saveRole(userId: string, raw: unknown, deps: Deps = {}): Promise<DepartureResult> {
  const input = saveInput.safeParse(raw);
  if (!input.success) return { ok: false, error: "invalid" };
  const { postId, saved } = input.data;
  return change(userId, deps, async (tx, now) => {
    const found = await postAndRow(tx, userId, postId);
    if (!found) return { ok: false, error: "not_found" };
    if (saved) {
      if (found.row?.savedAt) return { ok: true };
      if (found.closed) return { ok: false, error: "closed" };
      if (await listFull(tx, userId, "saved", deps.listMax ?? OWN_LIST_MAX)) return { ok: false, error: "saved_full" };
      await tx
        .insert(jobSaves)
        .values({ userId, jobPostId: postId, savedAt: now, updatedAt: now })
        .onConflictDoUpdate({ target: [jobSaves.userId, jobSaves.jobPostId], set: { savedAt: now, updatedAt: now } });
      return { ok: true };
    }
    if (!found.row) return { ok: true };
    if (found.row.stage === null)
      await tx.delete(jobSaves).where(and(eq(jobSaves.userId, userId), eq(jobSaves.jobPostId, postId), isNull(jobSaves.stage)));
    else await tx.update(jobSaves).set({ savedAt: null, updatedAt: now }).where(and(eq(jobSaves.userId, userId), eq(jobSaves.jobPostId, postId)));
    return { ok: true };
  });
}

/**
 * The tracker: Applied (1), Heard back, Interview or Offer (4). A closed post can't be newly marked as applied, but a
 * stage already set can still move. `applied_at` is the first time it was marked.
 */
export async function setStage(userId: string, raw: unknown, deps: Deps = {}): Promise<DepartureResult> {
  const input = stageInput.safeParse(raw);
  if (!input.success) return { ok: false, error: "invalid" };
  const { postId, stage } = input.data;
  return change(userId, deps, async (tx, now) => {
    const found = await postAndRow(tx, userId, postId);
    if (!found) return { ok: false, error: "not_found" };
    if (found.closed && found.row?.stage == null) return { ok: false, error: "closed" };
    if (found.row?.stage == null && (await listFull(tx, userId, "applied", deps.listMax ?? OWN_LIST_MAX))) return { ok: false, error: "applied_full" };
    await tx
      .insert(jobSaves)
      .values({ userId, jobPostId: postId, stage, appliedAt: now, updatedAt: now })
      .onConflictDoUpdate({
        target: [jobSaves.userId, jobSaves.jobPostId],
        // A job marked Not this time or Withdrawn in My jobs that is applied to again is open again.
        set: { stage, appliedAt: sql`coalesce(${jobSaves.appliedAt}, ${now.toISOString()}::timestamptz)`, closedAt: null, updatedAt: now },
      });
    return { ok: true };
  });
}

/** "I didn't apply": clears the stage, and the row too unless the post is saved. */
export async function clearStage(userId: string, raw: unknown, deps: Deps = {}): Promise<DepartureResult> {
  const input = clearStageInput.safeParse(raw);
  if (!input.success) return { ok: false, error: "invalid" };
  const { postId } = input.data;
  return change(userId, deps, async (tx, now) => {
    const found = await postAndRow(tx, userId, postId);
    if (!found) return { ok: false, error: "not_found" };
    if (!found.row) return { ok: true };
    if (found.row.savedAt === null) await tx.delete(jobSaves).where(and(eq(jobSaves.userId, userId), eq(jobSaves.jobPostId, postId)));
    else await tx.update(jobSaves).set({ stage: null, appliedAt: null, closedAt: null, updatedAt: now }).where(and(eq(jobSaves.userId, userId), eq(jobSaves.jobPostId, postId)));
    return { ok: true };
  });
}

/** For Download your data (added in export version 26): the person's saved and applied posts, oldest change first. */
export async function exportDepartures(userId: string, db: Db = getDb()): Promise<DepartureExport[]> {
  const rows = await db
    .select({
      title: jobPosts.title,
      company: jobPosts.company,
      city: jobPosts.city,
      url: jobPosts.url,
      savedAt: jobSaves.savedAt,
      stage: jobSaves.stage,
      appliedAt: jobSaves.appliedAt,
      closedAt: jobPosts.closedAt,
    })
    .from(jobSaves)
    .innerJoin(jobPosts, eq(jobPosts.id, jobSaves.jobPostId))
    .where(eq(jobSaves.userId, userId))
    .orderBy(asc(jobSaves.updatedAt));
  return rows.map((r) => ({
    title: r.title,
    company: r.company,
    city: r.city,
    url: r.url,
    saved_at: r.savedAt?.toISOString() ?? null,
    stage: r.stage ? (APPLY_STAGES[r.stage - 1] ?? null) : null,
    applied_at: r.appliedAt?.toISOString() ?? null,
    closed: r.closedAt !== null,
  }));
}

/**
 * Limits the cleanup to one test's own rows, so test files sharing a database never delete each other's posts or runs
 * (the feed tests keep 2024 posts and runs on purpose). Tests only: the daily cleanup passes none.
 */
export type DeparturesCleanupScope = { boardToken: string; runIds: string[] };

/**
 * The daily cleanup: posts closed more than 180 days ago go with their saves (on delete cascade), and feed runs older
 * than 90 days. Open posts are never deleted here, and neither are the Market's monthly rollups
 * (market_openings_monthly), which outlive the posts on purpose.
 */
export async function clearOldDepartures(
  db: Db = getDb(),
  now = new Date(),
  scope?: DeparturesCleanupScope,
): Promise<{ closedPostsDeleted: number; feedRunsDeleted: number }> {
  const posts = await db
    .delete(jobPosts)
    .where(
      and(
        isNotNull(jobPosts.closedAt),
        lt(jobPosts.closedAt, new Date(now.getTime() - CLOSED_KEEP_DAYS * DAY)),
        scope ? eq(jobPosts.boardToken, scope.boardToken) : undefined,
      ),
    )
    .returning({ id: jobPosts.id });
  const runs =
    scope && scope.runIds.length === 0
      ? []
      : await db
          .delete(jobFeedRuns)
          .where(
            and(lt(jobFeedRuns.startedAt, new Date(now.getTime() - RUN_KEEP_DAYS * DAY)), scope ? inArray(jobFeedRuns.id, scope.runIds) : undefined),
          )
          .returning({ id: jobFeedRuns.id });
  return { closedPostsDeleted: posts.length, feedRunsDeleted: runs.length };
}
