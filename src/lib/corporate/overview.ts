import "server-only";
import { and, count, desc, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { applications, conversations, interviews, jobs, jobTeam, users } from "@/db/schema";
import { indiaDay, mondayOf } from "@/lib/ride/days";
import { APPLICATION_STAGES } from "@/lib/schemas/constants";
import { visibleApplicationsWhere } from "./scope";
import { activeMembership } from "./store";
import type { CompanyOverviewView, LaneCounts } from "./types";

/*
 * Corporate Overview (dev/corporate-plan.md, "Inside Corporate" and build step 7): counts only, of what this member may
 * see now. Every count re-reads the member's live org_members row and goes through the same visibility rule as the
 * board, Messages and Interviews (visibleApplicationsWhere), so it never counts someone the member couldn't open: their
 * own application, withdrawn ones, deleted accounts, applications past the 180 days, or, for interviewers, candidates
 * they aren't interviewing. No names here at all.
 */

type Db = ReturnType<typeof getDb>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
type Member = NonNullable<Awaited<ReturnType<typeof activeMembership>>>;
export type OverviewDeps = { db?: Db; now?: Date };

const DAY = 86_400_000;
const zeroLanes = (): LaneCounts => Object.fromEntries(APPLICATION_STAGES.map((s) => [s, 0])) as LaneCounts;

/** The instant an India date starts. */
const indiaMidnight = (day: string) => new Date(`${day}T00:00:00+05:30`);

/** Company chats with a message from someone else that this member hasn't read. */
async function unreadChatCount(me: Member, userId: string, db: Db | Tx, now: Date): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(conversations)
    .innerJoin(applications, eq(applications.id, conversations.applicationId))
    .innerJoin(users, eq(users.id, applications.userId))
    .where(
      and(
        eq(conversations.orgId, me.orgId),
        visibleApplicationsWhere(me, userId, db, now),
        sql`exists (select 1 from messages x where x.conversation_id = ${conversations.id} and x.kind <> 'system' and x.sender_id is distinct from ${userId}
          and x.created_at > coalesce((select m.last_read_at from conversation_members m where m.conversation_id = ${conversations.id} and m.user_id = ${userId}), '-infinity'::timestamptz))`,
      ),
    );
  return row?.n ?? 0;
}

/** The unread count on the Corporate tab: 0 for someone with no company role. */
export async function corporateUnread(userId: string, deps: OverviewDeps = {}): Promise<number> {
  const db = deps.db ?? getDb();
  const now = deps.now ?? new Date();
  const me = await activeMembership(userId, db, now);
  return me ? unreadChatCount(me, userId, db, now) : 0;
}

/** The Overview for a member, or null when the person has no company role. */
export async function companyOverview(userId: string, deps: OverviewDeps = {}): Promise<CompanyOverviewView | null> {
  const db = deps.db ?? getDb();
  const now = deps.now ?? new Date();
  const me = await activeMembership(userId, db, now);
  if (!me) return null;
  const visible = visibleApplicationsWhere(me, userId, db, now);

  // Open and paused jobs: every one for an admin, otherwise those the member is on.
  const onTeam = db.select({ jobId: jobTeam.jobId }).from(jobTeam).where(eq(jobTeam.userId, userId));
  const jobRows = await db
    .select({ id: jobs.id, title: jobs.title, city: jobs.city, status: jobs.status })
    .from(jobs)
    .where(and(eq(jobs.orgId, me.orgId), inArray(jobs.status, ["open", "paused"]), me.role === "admin" ? undefined : inArray(jobs.id, onTeam)))
    .orderBy(desc(jobs.createdAt));
  const jobIds = jobRows.map((j) => j.id);

  const today = indiaDay(now);
  const weekStart = indiaMidnight(mondayOf(today));
  const [perLane, [fresh], booked, unreadChats] = await Promise.all([
    jobIds.length
      ? db
          .select({ jobId: applications.jobId, stage: applications.stage, n: count() })
          .from(applications)
          .innerJoin(users, eq(users.id, applications.userId))
          .where(and(visible, inArray(applications.jobId, jobIds)))
          .groupBy(applications.jobId, applications.stage)
      : Promise.resolve([]),
    db
      .select({ n: count() })
      .from(applications)
      .innerJoin(users, eq(users.id, applications.userId))
      .where(and(visible, gte(applications.createdAt, new Date(now.getTime() - 7 * DAY)))),
    db
      .select({ startsAt: interviews.startsAt })
      .from(interviews)
      .innerJoin(applications, eq(applications.id, interviews.applicationId))
      .innerJoin(users, eq(users.id, applications.userId))
      .where(
        and(visible, inArray(interviews.status, ["proposed", "accepted"]), gte(interviews.startsAt, weekStart), lt(interviews.startsAt, new Date(weekStart.getTime() + 7 * DAY))),
      ),
    unreadChatCount(me, userId, db, now),
  ]);

  const lanes = zeroLanes();
  const byJob = new Map(jobIds.map((id) => [id, zeroLanes()]));
  for (const r of perLane) {
    byJob.get(r.jobId)![r.stage] += r.n;
    lanes[r.stage] += r.n;
  }
  const sum = (l: LaneCounts) => APPLICATION_STAGES.reduce((n, s) => n + l[s], 0);
  return {
    role: me.role,
    assignedOnly: me.role === "interviewer",
    openJobs: jobRows.filter((j) => j.status === "open").length,
    newApplications: fresh?.n ?? 0,
    interviewsToday: booked.filter((b) => indiaDay(b.startsAt) === today).length,
    interviewsThisWeek: booked.length,
    unreadChats,
    lanes,
    jobs: jobRows.map((j) => {
      const l = byJob.get(j.id)!;
      return { id: j.id, title: j.title, city: j.city, status: j.status as "open" | "paused", lanes: l, total: sum(l) };
    }),
  };
}
