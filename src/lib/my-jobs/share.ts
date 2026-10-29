import "server-only";
import { and, eq, gt, lt } from "drizzle-orm";
import { getDb } from "@/db";
import { sharedJobHolds } from "@/db/schema";
import type { SharedJobView } from "@/lib/schemas";

type Db = ReturnType<typeof getDb>;

/*
 * Share from the phone (C21, docs/plans/application-tracker-plan.md section 5): what a phone's share sheet sent, held
 * in shared_job_holds until Departures opens it. Nothing here logs: the text and link never reach a log.
 */

/** The cookie that lets only the browser that shared open a hold made while signed out. */
export const SHARE_COOKIE = "cm_share";
/** How long a hold can be opened, and the cookie's life. */
export const SHARE_HOLD_MS = 60 * 60 * 1000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isHoldId = (v: unknown): v is string => typeof v === "string" && UUID.test(v);

/** Keeps a share and answers its id. `userId` when the person was signed in. */
export async function holdSharedJob(job: SharedJobView, userId: string | null, db: Db = getDb()): Promise<string> {
  const [row] = await db
    .insert(sharedJobHolds)
    .values({ userId, text: job.text, url: job.url || null })
    .returning({ id: sharedJobHolds.id });
  return row.id;
}

/**
 * Opens a hold once: only by the browser holding its cookie or by the person it was shared by, and only within the
 * hour. The read deletes it, so a second open (a reload, another tab) finds nothing. Null when there is nothing to open.
 */
export async function takeSharedJob(
  id: string,
  who: { userId: string | null; cookie: string | null },
  db: Db = getDb(),
  now = new Date(),
): Promise<SharedJobView | null> {
  if (!isHoldId(id)) return null;
  const byCookie = who.cookie?.toLowerCase() === id.toLowerCase();
  if (!byCookie && !who.userId) return null;
  const [row] = await db
    .delete(sharedJobHolds)
    .where(
      and(
        eq(sharedJobHolds.id, id),
        gt(sharedJobHolds.createdAt, new Date(now.getTime() - SHARE_HOLD_MS)),
        byCookie ? undefined : eq(sharedJobHolds.userId, who.userId!),
      ),
    )
    .returning({ text: sharedJobHolds.text, url: sharedJobHolds.url });
  return row ? { text: row.text, url: row.url ?? "" } : null;
}

/** Daily cleanup (api/cron/cleanup): deletes holds no one opened within the hour. */
export async function clearOldSharedJobs(db: Db = getDb(), now = new Date()): Promise<{ sharedJobsCleared: number }> {
  const gone = await db
    .delete(sharedJobHolds)
    .where(lt(sharedJobHolds.createdAt, new Date(now.getTime() - SHARE_HOLD_MS)))
    .returning({ id: sharedJobHolds.id });
  return { sharedJobsCleared: gone.length };
}
