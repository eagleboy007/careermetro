import "server-only";
import { eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import type { Tx } from "@/db/lock";
import { userSettings } from "@/db/schema";
import { indiaDay } from "@/lib/ride/days";
import { DEFAULT_JOB_SEARCH, DEFAULT_SETTINGS, jobSearchInput, noticeInput, type JobSearchView, type NoticeDays } from "@/lib/schemas";
import { LIMITS, takeShared } from "@/lib/shared-limit";

/*
 * Job search switch and notice period (handoff 6, docs/plans/job-search-plan.md). `jobSearchOn` is the one check that
 * Express apply, the Today board and the Arrivals badge read; company search (find-store) puts the same column in its
 * query. No row is on. Nothing here logs: the switch, the days and the date are private and never reach a log, a
 * profile or a company (companies see only Can join).
 */

type Db = ReturnType<typeof getDb>;
type Deps = { db?: Db; now?: Date };

export const JOB_SEARCH_ERRORS = ["invalid", "limit", "future", "days"] as const;
export type JobSearchError = (typeof JOB_SEARCH_ERRORS)[number];
export type JobSearchResult = { ok: true; view: JobSearchView } | { ok: false; error: JobSearchError };

export const JOB_SEARCH_MESSAGES: Record<JobSearchError, string> = {
  invalid: "That didn't work. Please refresh the page and try again.",
  limit: "That's as many changes as we allow in a day. Try again tomorrow.",
  future: "Pick the day you handed in your resignation. It can't be later than today.",
  days: "Pick your notice period first.",
};

const columns = { on: userSettings.jobSearch, noticeDays: userSettings.noticeDays, resignedOn: userSettings.resignedOn };
type Row = { on: boolean; noticeDays: number | null; resignedOn: string | null };

const viewOf = (row: Row | undefined): JobSearchView =>
  row ? { on: row.on, noticeDays: row.noticeDays as NoticeDays | null, resignedOn: row.resignedOn } : DEFAULT_JOB_SEARCH;

/** The switch and the notice period as saved; on with no notice period until the person changes them. */
export async function jobSearchFor(userId: string, db: Db | Tx = getDb()): Promise<JobSearchView> {
  const [row] = await db.select(columns).from(userSettings).where(eq(userSettings.userId, userId)).limit(1);
  return viewOf(row);
}

/** The one check for "is this person looking for a job". No row is on. */
export async function jobSearchOn(userId: string, db: Db | Tx = getDb()): Promise<boolean> {
  return (await jobSearchFor(userId, db)).on;
}

/**
 * Writes the person's own row only, under a per-person lock, counting the try against the day's 20 changes. A first
 * save makes the settings row with a new user's other defaults (DEFAULT_SETTINGS), as Network's switch does, since the
 * visibility column's own default is still "Only you".
 */
async function change(userId: string, patch: Partial<typeof userSettings.$inferInsert>, db: Db, now: Date): Promise<JobSearchResult> {
  return db.transaction(async (tx): Promise<JobSearchResult> => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`cm-job-search:${userId}`}))`);
    if (!(await takeShared(LIMITS.jobSearchChangesPerUserDay, userId, { db: tx, now: now.getTime() }))) return { ok: false, error: "limit" };
    const { visibility, ...rest } = DEFAULT_SETTINGS;
    const [row] = await tx
      .insert(userSettings)
      .values({ userId, profileVisibility: visibility, ...rest, ...patch, updatedAt: now })
      .onConflictDoUpdate({ target: userSettings.userId, set: { ...patch, updatedAt: now } })
      .returning(columns);
    return { ok: true, view: viewOf(row) };
  });
}

/** "Looking for a job" on (true) or off (false). Off pauses Departures and Arrivals; applications already sent stay. */
export async function setJobSearch(userId: string, raw: unknown, deps: Deps = {}): Promise<JobSearchResult> {
  const on = jobSearchInput.safeParse(raw);
  if (!on.success) return { ok: false, error: "invalid" };
  return change(userId, { jobSearch: on.data }, deps.db ?? getDb(), deps.now ?? new Date());
}

/**
 * The notice period card: the days, and the resignation date that starts the countdown (null stops it). A date needs
 * the days and can't be later than today in India.
 */
export async function setNotice(userId: string, raw: unknown, deps: Deps = {}): Promise<JobSearchResult> {
  const now = deps.now ?? new Date();
  const input = noticeInput.safeParse(raw);
  if (!input.success) return { ok: false, error: input.error.issues.some((i) => i.path[0] === "days" && i.code === "custom") ? "days" : "invalid" };
  if (input.data.resignedOn && input.data.resignedOn > indiaDay(now)) return { ok: false, error: "future" };
  return change(userId, { noticeDays: input.data.days, resignedOn: input.data.resignedOn }, deps.db ?? getDb(), now);
}

/** For "Download your data": the switch, the days and the resignation date, as stored (the defaults with no row). */
export async function exportJobSearch(userId: string, db: Db = getDb()) {
  const view = await jobSearchFor(userId, db);
  return { lookingForAJob: view.on, noticeDays: view.noticeDays, resignedOn: view.resignedOn };
}
