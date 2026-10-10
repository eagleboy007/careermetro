import "server-only";
import { and, asc, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { paths, pathSteps, resources, rideDays } from "@/db/schema";
import { syncGoals } from "@/lib/goals/store";
import type { GapAnalysis, Ride, RideWeek, Streak } from "@/lib/schemas";
import { currentAnalysis } from "@/lib/gaps/current";
import { buildRide, taskIdsOf, type RideGoal } from "./build";
import { indiaDay, mondayOf, streakFor, toggled, weekFor, type RideDay } from "./days";

type Db = ReturnType<typeof getDb>;

/**
 * The person's line as ride goals: their goals for the current analysis's gaps, in goal order, each with the courses
 * and practice task of the newest path's step for that skill. Null before there is a current analysis.
 */
export async function rideGoalsFor(userId: string, db: Db = getDb()): Promise<{ result: GapAnalysis; goals: RideGoal[] } | null> {
  const analysis = await currentAnalysis(userId, db);
  if (!analysis) return null;
  const userGoals = await syncGoals(userId, analysis, db);
  const [path] = await db.select({ id: paths.id }).from(paths).where(eq(paths.gapAnalysisId, analysis.id)).orderBy(desc(paths.createdAt)).limit(1);
  const steps = path
    ? await db
        .select({ skillId: pathSteps.skillId, resourceIds: pathSteps.resourceIds, proofTask: pathSteps.proofTask, doneAt: pathSteps.doneAt })
        .from(pathSteps)
        .where(eq(pathSteps.pathId, path.id))
        .orderBy(asc(pathSteps.position))
    : [];
  const ids = [...new Set(steps.flatMap((s) => s.resourceIds))];
  const rows = ids.length
    ? await db
        .select({
          id: resources.id,
          title: resources.title,
          provider: resources.provider,
          kind: resources.kind,
          minutes: resources.minutes,
          healthy: resources.healthy,
        })
        .from(resources)
        .where(inArray(resources.id, ids))
    : [];
  const byId = new Map(rows.filter((r) => r.healthy && r.title.trim()).map((r) => [r.id, r]));
  const stepBySkill = new Map(steps.map((s) => [s.skillId, s]));
  const gapBySkill = new Map(analysis.result.gaps.map((g) => [g.skillId, g]));

  const goals = userGoals.flatMap((g): RideGoal[] => {
    const gap = gapBySkill.get(g.skillId);
    if (!gap) return [];
    const step = stepBySkill.get(g.skillId);
    return [
      {
        goalId: g.id,
        name: gap.skillName,
        status: gap.status === "missing" ? "missing" : gap.status === "outdated" ? "outdated" : "weak",
        proved: g.proved,
        resources: (step?.resourceIds ?? []).flatMap((id) => {
          const r = byId.get(id);
          return r ? [r] : [];
        }),
        practice: step?.proofTask ?? null,
        learnDone: Boolean(step?.doneAt),
      },
    ];
  });
  return { result: analysis.result, goals };
}

async function daysOf(userId: string, db: Db, since?: string): Promise<RideDay[]> {
  const rows = await db
    .select({ day: rideDays.day, taskIds: rideDays.taskIds })
    .from(rideDays)
    .where(since ? and(eq(rideDays.userId, userId), gte(rideDays.day, since)) : eq(rideDays.userId, userId));
  return rows;
}

/** The streak and this week's ride days, for the header chip and the ride card. */
export async function rideStatsFor(userId: string, now: Date, db: Db = getDb()): Promise<{ streak: Streak; week: RideWeek; days: RideDay[] }> {
  const days = await daysOf(userId, db);
  const today = indiaDay(now);
  return { streak: streakFor(days, today), week: weekFor(days, today), days };
}

/** Today's ride with the person's own ticks, their week and streak. Null before there are goals to ride. */
export async function todayRideFor(
  userId: string,
  now: Date,
  db: Db = getDb(),
): Promise<{ ride: Ride; week: RideWeek; streak: Streak; roleSlug: string } | null> {
  const [line, stats] = await Promise.all([rideGoalsFor(userId, db), rideStatsFor(userId, now, db)]);
  if (!line) return null;
  const monday = mondayOf(indiaDay(now));
  const everDone = new Set(stats.days.flatMap((d) => d.taskIds));
  const doneThisWeek = new Set(stats.days.filter((d) => d.day >= monday).flatMap((d) => d.taskIds));
  const ride = buildRide({ goals: line.goals, everDone, doneThisWeek });
  return ride ? { ride, week: stats.week, streak: stats.streak, roleSlug: line.result.roleSlug } : null;
}

/**
 * Ticks or unticks one of the person's ride tasks for today (India date). Only a task on their own line counts; any
 * other id is refused. Ticking the same task twice in a day keeps one ride day.
 */
export async function tickTask(userId: string, taskId: string, on: boolean, now: Date, db: Db = getDb()): Promise<boolean> {
  if (typeof taskId !== "string" || taskId.length > 120) return false;
  const line = await rideGoalsFor(userId, db);
  if (!line || !taskIdsOf(line.goals).has(taskId)) return false;
  const day = indiaDay(now);
  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`cm-ride:${userId}`}))`);
    const [row] = await tx
      .select({ taskIds: rideDays.taskIds })
      .from(rideDays)
      .where(and(eq(rideDays.userId, userId), eq(rideDays.day, day)));
    const taskIds = toggled(row?.taskIds ?? [], taskId, on);
    await tx
      .insert(rideDays)
      .values({ userId, day, taskIds, updatedAt: now })
      .onConflictDoUpdate({ target: [rideDays.userId, rideDays.day], set: { taskIds, updatedAt: now } });
  });
  return true;
}
