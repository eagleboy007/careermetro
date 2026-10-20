import "server-only";
import { and, asc, count, desc, eq, gte, inArray, isNotNull, isNull, lt, notInArray, or, sql, type SQL } from "drizzle-orm";
import { getDb } from "@/db";
import type { Tx } from "@/db/lock";
import { applications, blocks, companyBlocks, interviews, jobs, notifications, organizations, users, userSettings } from "@/db/schema";
import { displayName } from "@/lib/account/name";
import { errorFields, logEvent } from "@/lib/log";
import { NOTIFICATIONS_SHOWN, NOTIFICATION_KEEP_DAYS, NOTIFICATION_READ_KEEP_DAYS, NOTIFICATION_SHOWN_DAYS } from "@/lib/schemas/constants";
import { notificationView, notifyInput, openNotificationsInput, type NotificationExport, type NotifyInput } from "@/lib/schemas/notifications";
import { LIMITS, takeShared } from "@/lib/shared-limit";
import { APPLICATION_KINDS, hrefFor, relativeTime, sentenceFor } from "./rules";
import type { NotificationView } from "./types";

/*
 * Notifications, in-app (docs/plans/notifications-plan.md, migration 0043). `notify` runs inside each event's own
 * transaction, so an event that rolls back leaves no notification; it holds ids only. Reads are scoped to the signed-in
 * person and build each sentence from the live rows, leaving out anything whose actor is suspended, deleting, gone or
 * blocked either way, and applications that were withdrawn or are from a company the person blocked. Logs carry the
 * kind and counts only: never a name, a company or a job.
 */

type Db = ReturnType<typeof getDb>;
type Deps = { db?: Db; now?: Date };

const DAY = 86_400_000;

/**
 * Writes one notification for an event, in the caller's transaction (in a savepoint, so a failure here never undoes the
 * event itself). Never for the person's own action, or to an account that is being deleted or is suspended. A new row
 * about an application replaces every earlier one about it, since each sentence reads the application's live stage;
 * one about an interview replaces the unread one before it. The partial unique index keeps one unread row per kind and
 * source, so a second write before reading only moves its time.
 */
export async function notify(tx: Tx | Db, raw: NotifyInput, now = new Date()): Promise<void> {
  const parsed = notifyInput.safeParse(raw);
  if (!parsed.success) {
    logEvent("error", "notification_invalid");
    return;
  }
  const n = parsed.data;
  if (n.userId === n.actorId) return;
  const requestId = "connectionRequestId" in n ? n.connectionRequestId : null;
  const applicationId = "applicationId" in n ? n.applicationId : null;
  const interviewId = "interviewId" in n ? n.interviewId : null;
  try {
    const wrote = await tx.transaction(async (sp) => {
      const [to] = await sp.select({ deleted: users.deletionRequestedAt, suspended: users.suspendedAt }).from(users).where(eq(users.id, n.userId));
      if (!to || to.deleted || to.suspended) return false;
      if (applicationId) {
        await sp
          .delete(notifications)
          .where(and(eq(notifications.userId, n.userId), eq(notifications.applicationId, applicationId), inArray(notifications.kind, [...APPLICATION_KINDS])));
      }
      if (interviewId) {
        await sp.delete(notifications).where(and(eq(notifications.userId, n.userId), eq(notifications.interviewId, interviewId), isNull(notifications.readAt)));
      }
      await sp.execute(sql`
        insert into notifications (user_id, kind, actor_id, connection_request_id, application_id, interview_id, created_at)
        values (${n.userId}, ${n.kind}, ${n.actorId}, ${requestId}, ${applicationId}, ${interviewId}, ${now.toISOString()}::timestamptz)
        on conflict (user_id, kind, (coalesce(application_id, connection_request_id, interview_id))) where read_at is null
        do update set created_at = excluded.created_at, actor_id = excluded.actor_id`);
      return true;
    });
    if (wrote) logEvent("info", "notification_written", { kind: n.kind });
  } catch (error) {
    logEvent("error", "notification_failed", { kind: n.kind, ...errorFields(error) });
  }
}

/** A withdrawn connection request takes its notification with it. Run in the withdrawal's transaction. */
export async function forgetRequests(tx: Tx | Db, requestIds: string[]): Promise<void> {
  if (!requestIds.length) return;
  await tx.delete(notifications).where(inArray(notifications.connectionRequestId, requestIds));
}

/** A block either way, or a removed connection: every notification between the two people goes. */
export async function forgetBetween(tx: Tx | Db, x: string, y: string): Promise<void> {
  await tx
    .delete(notifications)
    .where(or(and(eq(notifications.userId, x), eq(notifications.actorId, y)), and(eq(notifications.userId, y), eq(notifications.actorId, x))));
}

/**
 * What the person may be shown. The actor must still be there (not deleting, not suspended) and not blocked either way.
 * A row about an application or interview needs the application to be theirs, not withdrawn and from a company they
 * haven't blocked; moves and closings pause while job search is off (Arrivals is paused then), interviews never do.
 */
function shownTo(userId: string): SQL {
  return and(
    isNull(users.deletionRequestedAt),
    isNull(users.suspendedAt),
    sql`not exists (select 1 from ${blocks} where (${blocks.blockerId} = ${userId} and ${blocks.blockedId} = ${notifications.actorId}) or (${blocks.blockerId} = ${notifications.actorId} and ${blocks.blockedId} = ${userId}))`,
    or(
      and(isNull(notifications.applicationId), isNull(notifications.interviewId)),
      and(
        isNotNull(applications.id),
        eq(applications.userId, userId),
        isNull(applications.withdrawnAt),
        sql`not exists (select 1 from ${companyBlocks} where ${companyBlocks.userId} = ${userId} and ${companyBlocks.orgId} = ${applications.orgId})`,
      ),
    ),
    or(notInArray(notifications.kind, [...APPLICATION_KINDS]), sql`coalesce(${userSettings.jobSearch}, true)`),
  )!;
}

/** The application a row is about: its own, or its interview's. */
const applicationOf = sql`${applications.id} = coalesce(${notifications.applicationId}, ${interviews.applicationId})`;

/** The newest NOTIFICATIONS_SHOWN the person may see from the last NOTIFICATION_SHOWN_DAYS days, as the panel shows them. */
export async function notificationsFor(userId: string, deps: Deps = {}): Promise<NotificationView[]> {
  const db = deps.db ?? getDb();
  const now = deps.now ?? new Date();
  const rows = await db
    .select({
      id: notifications.id,
      kind: notifications.kind,
      createdAt: notifications.createdAt,
      readAt: notifications.readAt,
      actorName: users.name,
      actorHandle: users.username,
      company: organizations.name,
      job: jobs.title,
      stage: applications.stage,
      startsAt: interviews.startsAt,
    })
    .from(notifications)
    .innerJoin(users, eq(users.id, notifications.actorId))
    .leftJoin(interviews, eq(interviews.id, notifications.interviewId))
    .leftJoin(applications, applicationOf)
    .leftJoin(jobs, eq(jobs.id, applications.jobId))
    .leftJoin(organizations, eq(organizations.id, applications.orgId))
    .leftJoin(userSettings, eq(userSettings.userId, notifications.userId))
    .where(and(eq(notifications.userId, userId), gte(notifications.createdAt, new Date(now.getTime() - NOTIFICATION_SHOWN_DAYS * DAY)), shownTo(userId)))
    .orderBy(desc(notifications.createdAt), desc(notifications.id))
    .limit(NOTIFICATIONS_SHOWN);
  return rows.flatMap((r) => {
    const facts = { kind: r.kind, actorName: displayName(r.actorName), actorHandle: r.actorHandle, company: r.company, job: r.job, stage: r.stage, startsAt: r.startsAt };
    const view = notificationView.safeParse({ id: r.id, kind: r.kind, text: sentenceFor(facts), href: hrefFor(facts), when: relativeTime(r.createdAt, now), isNew: r.readAt === null });
    // A row that doesn't fit (a name too long, say) is left out rather than failing the panel; logged by kind only.
    if (!view.success) logEvent("warn", "notification_unshown", { kind: r.kind });
    return view.success ? [view.data] : [];
  });
}

/** How many unread notifications the person may see: the dot on the bell, read in the signed-in layout. */
export async function newCount(userId: string, deps: Deps = {}): Promise<number> {
  const db = deps.db ?? getDb();
  const now = deps.now ?? new Date();
  const [row] = await db
    .select({ n: count() })
    .from(notifications)
    .innerJoin(users, eq(users.id, notifications.actorId))
    .leftJoin(interviews, eq(interviews.id, notifications.interviewId))
    .leftJoin(applications, applicationOf)
    .leftJoin(userSettings, eq(userSettings.userId, notifications.userId))
    .where(
      and(
        eq(notifications.userId, userId),
        isNull(notifications.readAt),
        gte(notifications.createdAt, new Date(now.getTime() - NOTIFICATION_SHOWN_DAYS * DAY)),
        shownTo(userId),
      ),
    );
  return Math.min(row?.n ?? 0, NOTIFICATIONS_SHOWN);
}

/** Marks every unread notification of the person's read, counting the try against the day's limit. False past it. */
export async function markAllRead(userId: string, deps: Deps = {}): Promise<boolean> {
  const db = deps.db ?? getDb();
  const now = deps.now ?? new Date();
  if (!(await takeShared(LIMITS.notificationReadsPerUserDay, userId, { db, now: now.getTime() }))) return false;
  const marked = await db
    .update(notifications)
    .set({ readAt: now })
    .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)))
    .returning({ id: notifications.id });
  logEvent("info", "notifications_read", { count: marked.length });
  return true;
}

/**
 * Opening the panel: the rows as they stood (new ones flagged, so they stay bold until it closes), then every row is
 * marked read. Past the day's limit the rows still show and stay unread.
 */
export async function openNotifications(userId: string, raw: unknown, deps: Deps = {}): Promise<{ ok: true; items: NotificationView[] } | { ok: false; error: "invalid" }> {
  if (!openNotificationsInput.safeParse(raw).success) return { ok: false, error: "invalid" };
  const items = await notificationsFor(userId, deps);
  if (!(await markAllRead(userId, deps))) logEvent("info", "notifications_read_limited");
  return { ok: true, items };
}

/**
 * Download your data (version 29): each notification's kind and dates, with the company and job for the ones about an
 * application or interview. Other people's names are left out.
 */
export async function exportNotifications(userId: string, db: Pick<Db, "select"> = getDb()): Promise<NotificationExport[]> {
  const rows = await db
    .select({ kind: notifications.kind, createdAt: notifications.createdAt, readAt: notifications.readAt, company: organizations.name, job: jobs.title })
    .from(notifications)
    .leftJoin(interviews, eq(interviews.id, notifications.interviewId))
    .leftJoin(applications, applicationOf)
    .leftJoin(jobs, eq(jobs.id, applications.jobId))
    .leftJoin(organizations, eq(organizations.id, applications.orgId))
    .where(eq(notifications.userId, userId))
    .orderBy(asc(notifications.createdAt), asc(notifications.id));
  return rows.map((r) => ({
    kind: r.kind,
    created_at: r.createdAt.toISOString(),
    read_at: r.readAt?.toISOString() ?? null,
    ...(r.company ? { company: r.company } : {}),
    ...(r.job ? { job: r.job } : {}),
  }));
}

/**
 * Daily cleanup (api/cron/cleanup): deletes read notifications NOTIFICATION_READ_KEEP_DAYS after they were read, and any
 * notification NOTIFICATION_KEEP_DAYS after it was made. Returns how many.
 */
export async function clearOldNotifications(db: Db = getDb(), now = new Date()): Promise<number> {
  const gone = await db
    .delete(notifications)
    .where(
      or(
        lt(notifications.readAt, new Date(now.getTime() - NOTIFICATION_READ_KEEP_DAYS * DAY)),
        lt(notifications.createdAt, new Date(now.getTime() - NOTIFICATION_KEEP_DAYS * DAY)),
      ),
    )
    .returning({ id: notifications.id });
  return gone.length;
}
