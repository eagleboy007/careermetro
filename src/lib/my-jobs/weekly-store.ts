import "server-only";
import { randomBytes } from "node:crypto";
import { and, asc, eq, inArray, isNull, lt, notExists, sql } from "drizzle-orm";
import { skills as allSkills } from "@/content";
import { getDb } from "@/db";
import { jobChecks, jobPosts, jobSaves, users, userSettings, weeklyEmails } from "@/db/schema";
import { giveBackAppEmail, takeAppEmail } from "@/lib/email/budget";
import { eliteOn } from "@/lib/elite/store";
import { profileMatcher } from "@/lib/gaps/match";
import { jobCheckView } from "@/lib/jobs/groups";
import { indiaDay, mondayOf } from "@/lib/ride/days";
import { APP_EMAIL_DAILY_BUDGET } from "@/lib/schemas/constants";
import { stageOf, statusOf } from "./rules";
import { fitContext, jobName } from "./store";
import { weeklyEmail, weeklyView, type WeeklyEmail, type WeeklyJob, type WeeklyView } from "./weekly";

type Db = ReturnType<typeof getDb>;

/*
 * The weekly My jobs email's reads and writes (C22, docs/plans/application-tracker-plan.md section 6). Nothing here
 * logs: names, titles, companies and addresses never reach a log, and the off token is never logged either.
 */

const skillName = new Map(allSkills.map((s) => [s.id, s.name]));
const MOVING = ["applied", "heard", "interview", "offer"] as const;

/** The person's moving jobs with the skills each asks for against the current resume. Company and title only. */
export async function weeklyJobs(userId: string, { db = getDb(), now = new Date() }: { db?: Db; now?: Date } = {}): Promise<WeeklyJob[]> {
  const rows = await db
    .select({
      postId: jobSaves.jobPostId,
      checkId: jobSaves.jobCheckId,
      stage: jobSaves.stage,
      statusAt: sql<Date>`coalesce(${jobSaves.statusAt}, ${jobSaves.appliedAt}, ${jobSaves.updatedAt})`.mapWith(jobSaves.updatedAt),
      appliedAt: jobSaves.appliedAt,
      interviewAt: jobSaves.interviewAt,
      company: sql<string | null>`coalesce(${jobChecks.company}, ${jobPosts.company})`,
      title: sql<string | null>`coalesce(${jobChecks.title}, ${jobPosts.title})`,
      required: sql<string[] | null>`coalesce(${jobChecks.requiredSkillIds}, ${jobPosts.requiredSkillIds})`,
      nice: sql<string[] | null>`coalesce(${jobChecks.niceSkillIds}, ${jobPosts.niceSkillIds})`,
      unknown: jobChecks.unknownSkills,
      createdAt: jobChecks.createdAt,
    })
    .from(jobSaves)
    .leftJoin(jobPosts, eq(jobPosts.id, jobSaves.jobPostId))
    .leftJoin(jobChecks, eq(jobChecks.id, jobSaves.jobCheckId))
    .where(and(eq(jobSaves.userId, userId), inArray(jobSaves.stage, MOVING.map((s) => stageOf(s)!))))
    .orderBy(asc(jobSaves.id));
  const listed = rows.filter((r) => r.company && r.title);
  if (!listed.length) return [];
  const ctx = await fitContext(userId, db);
  const matchRole = ctx ? profileMatcher(ctx.profile, now) : undefined;
  return listed.map((r) => {
    let open: string[] = [];
    let only: string[] = [];
    if (ctx) {
      const view = jobCheckView(
        {
          id: r.checkId ?? r.postId!,
          company: r.company!,
          title: r.title!,
          requiredSkillIds: r.required ?? [],
          niceSkillIds: r.nice ?? [],
          unknownSkills: r.unknown ?? [],
          createdAt: r.createdAt ?? now,
        },
        ctx.profile,
        ctx.target,
        ctx.proved,
        { now, matchRole },
      );
      const names = (list: { skillId: string; skillName: string }[]) => list.map((s) => skillName.get(s.skillId) ?? s.skillName);
      open = names(view.alsoGoals);
      only = names(view.onlyThisJob);
    }
    return {
      ref: r.postId ? { kind: "post" as const, postId: r.postId } : { kind: "check" as const, checkId: r.checkId! },
      ...jobName(r.company!, r.title!),
      status: statusOf(r.stage),
      statusAt: r.statusAt,
      appliedAt: r.appliedAt,
      interviewAt: r.interviewAt,
      open,
      only,
    };
  });
}

/** This week's view for one person (Settings' "See this week's" preview and the cron), or null on an empty week. */
export async function weeklyFor(userId: string, deps: { db?: Db; now?: Date } = {}): Promise<WeeklyView | null> {
  const db = deps.db ?? getDb();
  const now = deps.now ?? new Date();
  const [jobs, elite] = await Promise.all([weeklyJobs(userId, { db, now }), eliteOn(userId, db)]);
  return weeklyView(jobs, now, { elite });
}

/** A new off token: 32 random bytes, base64url (43 characters). */
export const newOffToken = () => randomBytes(32).toString("base64url");
/** What an off token looks like; anything else is never looked up. */
export const OFF_TOKEN = /^[A-Za-z0-9_-]{43}$/;

/** The person's off token, made on first use. The weekly email and the Monday events digest carry the same one. */
export async function offTokenFor(userId: string, db: Db): Promise<string> {
  await db.update(userSettings).set({ emailOffToken: newOffToken() }).where(and(eq(userSettings.userId, userId), isNull(userSettings.emailOffToken)));
  const [row] = await db.select({ token: userSettings.emailOffToken }).from(userSettings).where(eq(userSettings.userId, userId)).limit(1);
  return row!.token!;
}

/**
 * "Turn it off" from the email: turns the weekly email off. The token is replaced, so the link works once, unless the
 * Monday events digest is still on: its emails carry the same token, and their off link must keep working (Timetable
 * PR 5). Answers nothing whatever happened, so the page never says whether a token existed.
 */
export async function turnOffWeeklyEmail(token: string, db: Db = getDb()): Promise<void> {
  if (!OFF_TOKEN.test(token)) return;
  await db
    .update(userSettings)
    .set({ emailWeeklySummary: false, emailOffToken: sql`case when ${userSettings.eventsDigest} then ${userSettings.emailOffToken} else ${newOffToken()} end` })
    .where(eq(userSettings.emailOffToken, token));
}

export type WeeklyRun = { considered: number; sent: number; empty: number; failed: number; capped: boolean };
/**
 * Sends one weekly email with its idempotency key. `quota`: the sender's daily quota is spent, so the run stops and the
 * next day picks up the rest. `maybeSent`: it may have gone out anyway (a timeout or a server error).
 */
export type WeeklySend = (message: WeeklyEmail & { to: string; offUrl: string; idempotencyKey: string }) => Promise<{ ok: boolean; quota?: boolean; maybeSent?: boolean }>;

/** The idempotency key for one person's weekly email (T151): the sender sends it at most once within 24 hours. */
export const weeklyKey = (userId: string, week: string) => `weekly-${userId}-${week}`;

/**
 * One cron run (Monday to Wednesday, 08:00 IST): everyone with the switch on and no email yet this India week gets
 * one, when their week isn't empty, while the shared app-email budget lasts (`cap` a day, APP_EMAIL_DAILY_BUDGET,
 * shared with the Monday events digest, which runs first and takes at most APP_EMAIL_DIGEST_SHARE; src/lib/email/budget.ts). People go in the order of the last week they had a
 * row (never first, then the longest ago), then id, so the same people aren't left at the end every week (T151).
 *
 * At most one email a person a week (T151): before sending, the run takes one from the day's budget and claims the
 * person's week row, so another run skips them. A send Resend refused outright (nothing went out) gives both back and
 * the next day tries again. A send that may have gone out (a timeout or a server error) is tried once more with the
 * same idempotency key, which Resend sends at most once; if that is unsure too, the claim and the budget stay, so the
 * person may miss a week but never gets two. A week found empty gets its row too. Stops before `deadline`, when the
 * budget is spent, or at Resend's daily quota. Counts only.
 */
export async function runWeeklyEmails({
  db = getDb(),
  now = new Date(),
  cap = APP_EMAIL_DAILY_BUDGET,
  site,
  send,
  deadline = Number.POSITIVE_INFINITY,
  only,
}: {
  db?: Db;
  now?: Date;
  cap?: number;
  site: string;
  send: WeeklySend;
  deadline?: number;
  /** Only these people (tests, where the database holds others). */
  only?: string[];
}): Promise<WeeklyRun> {
  const week = mondayOf(indiaDay(now));
  const lastWeek = sql`(select max(${weeklyEmails.week}) from ${weeklyEmails} where ${weeklyEmails.userId} = ${users.id})`;
  const people = await db
    .select({ id: users.id, email: users.email, firstName: users.firstName })
    .from(userSettings)
    .innerJoin(users, eq(users.id, userSettings.userId))
    .where(
      and(
        eq(userSettings.emailWeeklySummary, true),
        isNull(users.deletionRequestedAt),
        isNull(users.suspendedAt),
        only ? inArray(users.id, only) : undefined,
        notExists(db.select({ one: sql`1` }).from(weeklyEmails).where(and(eq(weeklyEmails.userId, users.id), eq(weeklyEmails.week, week)))),
      ),
    )
    .orderBy(sql`${lastWeek} asc nulls first`, asc(users.id));
  const run: WeeklyRun = { considered: 0, sent: 0, empty: 0, failed: 0, capped: false };
  for (const person of people) {
    if (Date.now() > deadline) {
      run.capped = true;
      break;
    }
    run.considered++;
    try {
      const view = await weeklyFor(person.id, { db, now });
      if (!view) {
        // Nothing moving: no email, and no need to look again this week.
        await db.insert(weeklyEmails).values({ userId: person.id, week }).onConflictDoNothing();
        run.empty++;
        continue;
      }
      const offUrl = `${site}/api/email/off?t=${await offTokenFor(person.id, db)}`;
      const email = weeklyEmail(view, { name: person.firstName, site, offUrl });
      const day = await takeAppEmail({ db, now, cap });
      if (!day) {
        run.capped = true;
        break;
      }
      const claimed = await db.insert(weeklyEmails).values({ userId: person.id, week, sentAt: now }).onConflictDoNothing().returning({ week: weeklyEmails.week });
      if (!claimed.length) {
        // Another run claimed this person's week since the list was read.
        await giveBackAppEmail(day, db);
        continue;
      }
      const message = { ...email, to: person.email, offUrl, idempotencyKey: weeklyKey(person.id, week) };
      let result = await send(message);
      if (!result.ok && result.maybeSent) result = await send(message);
      if (result.ok) {
        run.sent++;
        continue;
      }
      run.failed++;
      if (result.maybeSent) continue;
      // Refused outright, so nothing went out: free the week and the budget for the next run.
      await db.delete(weeklyEmails).where(and(eq(weeklyEmails.userId, person.id), eq(weeklyEmails.week, week)));
      await giveBackAppEmail(day, db);
      if (result.quota) {
        run.capped = true;
        break;
      }
    } catch {
      run.failed++;
    }
  }
  return run;
}

/** The latest week the email went out, for Download your data. */
export async function lastWeeklyEmail(userId: string, db: Db = getDb()): Promise<string | null> {
  const [row] = await db
    .select({ week: weeklyEmails.week })
    .from(weeklyEmails)
    .where(eq(weeklyEmails.userId, userId))
    .orderBy(sql`${weeklyEmails.week} desc`)
    .limit(1);
  return row?.week ?? null;
}

/** Daily cleanup: weekly rows over 90 days old. */
export async function clearOldWeeklyEmails(db: Db = getDb(), now = new Date()): Promise<{ weeklyRowsCleared: number }> {
  const gone = await db
    .delete(weeklyEmails)
    .where(lt(weeklyEmails.sentAt, new Date(now.getTime() - 90 * 86_400_000)))
    .returning({ week: weeklyEmails.week });
  return { weeklyRowsCleared: gone.length };
}
