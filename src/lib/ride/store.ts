import "server-only";
import { and, asc, count, desc, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { paths, pathSteps, resources, rideDays } from "@/db/schema";
import { goalsOf, notConfirmedSkills, resourcesForSkills, syncGoals } from "@/lib/goals/store";
import { offerFor, swappedSkill } from "@/lib/goals/not-for-me";
import { goalName } from "@/lib/goals/name";
import { fillingSkills } from "@/lib/goals/sync";
import { skillGroupMembers, skills } from "@/content";
import type { GapAnalysis, GoalsSummary, Ride, RideWeek, Streak } from "@/lib/schemas";
import { currentAnalysis } from "@/lib/gaps/current";
import { buildGoalsSummary, buildRide, type RideGoal, type RidePath } from "./build";
import { indiaDay, mondayOf, streakFor, toggled, weekFor, type RideDay } from "./days";

type Db = ReturnType<typeof getDb>;

const skillNames = new Map(skills.map((s) => [s.id, s.name]));

/**
 * The person's goals split for a line: `gaps`, their goals for the current analysis's gaps in goal order, which make
 * the line, carry the train and decide arrival; and `chosen`, their "Your choice" goals that aren't gaps of it, in goal
 * order, which sit on their own spur (handoff section 7) and never move the train, the match or readiness. Skipped
 * "Your choice" goals (removed by the person) are left out.
 */
export function lineGoals<G extends { skillId: string; source: "gap" | "user"; status: string }>(goals: G[], gapSkillIds: ReadonlySet<string>): { gaps: G[]; chosen: G[] } {
  return {
    gaps: goals.filter((g) => gapSkillIds.has(g.skillId)),
    chosen: goals.filter((g) => g.source === "user" && g.status !== "skipped" && !gapSkillIds.has(g.skillId)),
  };
}

/** A "Your choice" goal's name: the skill's own name. */
export const choiceName = (skillId: string) => skillNames.get(skillId) ?? skillId;

/**
 * The person's line as ride goals: their goals for the current analysis's gaps, in goal order, each with the courses
 * and practice task of the newest path's step for that skill. `chosen` holds their "Your choice" goals the same way;
 * they are kept apart because they never move the train, the ride or arrival. Null before there is a current
 * analysis. `sync: false` only reads the goals, for a tick, which must not write them.
 */
export async function rideGoalsFor(
  userId: string,
  db: Db = getDb(),
  { sync = true }: { sync?: boolean } = {},
): Promise<{ result: GapAnalysis; goals: RideGoal[]; chosen: RideGoal[]; path: RidePath } | null> {
  const analysis = await currentAnalysis(userId, db);
  if (!analysis) return null;
  const userGoals = sync ? await syncGoals(userId, analysis, db) : await goalsOf(userId, db);
  const notConfirmed = await notConfirmedSkills(userId, db);
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

  const line = lineGoals(userGoals, new Set(gapBySkill.keys()));
  // A goal swapped to another skill of its group ("Not for me", FR-48) learns that skill from the catalog.
  const swaps = await resourcesForSkills([...new Set(line.gaps.flatMap((g) => swappedSkill(g, skillGroupMembers) ?? []))], db);
  // Learn tasks come from the path's step for the skill; a "Your choice" goal the path has no step for gets the
  // fallback tasks (build the path, or study on your own), like any goal the path left out.
  const rideGoal = (g: (typeof userGoals)[number], name: string, status: RideGoal["status"], choice: RideGoal["choice"]): RideGoal => {
    const swapped = swappedSkill(g, skillGroupMembers);
    const step = swapped ? undefined : stepBySkill.get(g.skillId);
    return {
      goalId: g.id,
      skillId: g.skillId,
      name: swapped && !g.proved ? (skillNames.get(swapped) ?? name) : name,
      // An expired certificate turns the goal amber again (dev/proof-plan.md rule 4).
      status: g.status === "renew" ? "weak" : status,
      proved: g.proved,
      resources: swapped
        ? (swaps.get(swapped) ?? [])
        : (step?.resourceIds ?? []).flatMap((id) => {
            const r = byId.get(id);
            return r ? [r] : [];
          }),
      practice: step?.proofTask ?? null,
      learnDone: Boolean(step?.doneAt),
      skipped: g.status === "skipped",
      notForMe: choice ? null : offerFor(g, analysis.result.roleSlug, skillGroupMembers),
      proofSkills: fillingSkills(g, skillGroupMembers),
      renew: g.status === "renew",
      notConfirmed: !g.proved && fillingSkills(g, skillGroupMembers).some((id) => notConfirmed.has(id)),
      choice,
    };
  };
  const goals = line.gaps.map((g) => {
    const gap = gapBySkill.get(g.skillId)!;
    const status = gap.status === "missing" ? "missing" : gap.status === "outdated" ? "outdated" : "weak";
    return rideGoal(g, goalName(gap, g.proved, analysis.result.roleSlug), status, null);
  });
  const chosen = line.chosen.map((g) => rideGoal(g, choiceName(g.skillId), "missing", g.choice ?? { company: null }));
  return { result: analysis.result, goals, chosen, path: { href: `/resume/${analysis.resumeId}/path/${analysis.result.roleSlug}`, built: Boolean(path) } };
}

const rode = sql`cardinality(${rideDays.taskIds}) > 0`;

/**
 * The streak and this week's ride days, for the header chip and the ride card. Reads a count and this week's rows,
 * so it stays cheap however long someone rides.
 */
export async function rideStatsFor(userId: string, now: Date, db: Db = getDb()): Promise<{ streak: Streak; week: RideWeek; days: RideDay[] }> {
  const today = indiaDay(now);
  const [[total], days] = await Promise.all([
    db
      .select({ n: count() })
      .from(rideDays)
      .where(and(eq(rideDays.userId, userId), rode)),
    db
      .select({ day: rideDays.day, taskIds: rideDays.taskIds })
      .from(rideDays)
      .where(and(eq(rideDays.userId, userId), gte(rideDays.day, mondayOf(today)))),
  ]);
  return { streak: { days: total.n, todayCounted: streakFor(days, today).todayCounted }, week: weekFor(days, today), days };
}

/** Task ids the person ticked before today. They are done for good and can't be ticked again for a new ride day. */
async function doneBefore(userId: string, today: string, db: Pick<Db, "selectDistinct">): Promise<Set<string>> {
  const rows = await db
    .selectDistinct({ id: sql<string>`unnest(${rideDays.taskIds})` })
    .from(rideDays)
    .where(and(eq(rideDays.userId, userId), lt(rideDays.day, today)));
  return new Set(rows.map((r) => r.id));
}

/** Today's ride with the person's own ticks, their week and streak. Null before there are goals to ride. */
export async function todayRideFor(
  userId: string,
  now: Date,
  db: Db = getDb(),
  role = "",
): Promise<{ ride: Ride; goals: GoalsSummary; week: RideWeek; streak: Streak; roleSlug: string } | null> {
  const today = indiaDay(now);
  const [line, stats, before] = await Promise.all([rideGoalsFor(userId, db), rideStatsFor(userId, now, db), doneBefore(userId, today, db)]);
  if (!line) return null;
  const input = {
    goals: line.goals,
    path: line.path,
    doneBefore: before,
    doneToday: new Set(stats.days.find((d) => d.day === today)?.taskIds ?? []),
    doneThisWeek: new Set(stats.days.flatMap((d) => d.taskIds)),
  };
  const ride = buildRide(input);
  if (!ride) return null;
  const goals = buildGoalsSummary({ ...input, role: role || line.result.roleSlug, gaps: line.result.gaps, chosen: line.chosen });
  return { ride, goals, week: stats.week, streak: stats.streak, roleSlug: line.result.roleSlug };
}

/**
 * Ticks or unticks one of the person's ride tasks for today (India date). Only a task on today's ride counts, as the
 * person sees it: not another goal's task, not one done on an earlier day, and not one the app ticks itself. Only
 * today's ticks can be taken back. Ticking the same task twice in a day keeps one ride day.
 */
export async function tickTask(userId: string, taskId: string, on: boolean, now: Date, db: Db = getDb()): Promise<boolean> {
  if (typeof taskId !== "string" || taskId.length > 100) return false;
  const line = await rideGoalsFor(userId, db, { sync: false });
  if (!line) return false;
  const day = indiaDay(now);
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`cm-ride:${userId}`}))`);
    const [row] = await tx
      .select({ taskIds: rideDays.taskIds })
      .from(rideDays)
      .where(and(eq(rideDays.userId, userId), eq(rideDays.day, day)));
    const today = row?.taskIds ?? [];
    const ride = buildRide({
      goals: line.goals,
      path: line.path,
      doneBefore: await doneBefore(userId, day, tx),
      doneToday: new Set(today),
      doneThisWeek: new Set(),
    });
    const task = ride?.tasks.find((t) => t.id === taskId);
    if (!task || task.locked) return false;
    // Already as asked, say from another tab: nothing to write.
    if (task.done === on) return true;
    const taskIds = toggled(today, taskId, on);
    await tx
      .insert(rideDays)
      .values({ userId, day, taskIds, updatedAt: now })
      .onConflictDoUpdate({ target: [rideDays.userId, rideDays.day], set: { taskIds, updatedAt: now } });
    return true;
  });
}
