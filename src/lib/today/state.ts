import "server-only";
import { and, desc, eq, inArray } from "drizzle-orm";
import { getDb } from "@/db";
import { resumes } from "@/db/schema";
import { roleProfiles } from "@/content";
import { currentAnalysis, type CurrentAnalysis, type Db } from "@/lib/gaps/current";
import { boardTask } from "@/lib/ride/build";
import { todayRideFor, type TodaySignal } from "@/lib/ride/store";
import { clip } from "@/lib/text";
import type { FirstTally, GoalsSummary, Ride, RideTask, RideWeek, Streak } from "@/lib/schemas";

export type { Db, FirstTally };
export { clip, currentAnalysis };

/** What Today needs to know about a signed-in person, picked on the server (handoff section 4). */
export type TodayState =
  | { state: "no_resume"; unfinishedResumeId: string | null }
  | {
      state: "first";
      resumeId: string;
      role: { slug: string; title: string };
      tally: FirstTally;
      lineHours: number;
      firstTasks: RideTask[];
      /** Null when the line has no goals. */
      goals: GoalsSummary | null;
      signal: TodaySignal | null;
      /** The goal today's ride is on, for "On your line". Null when there is none. */
      current: { skillId: string; name: string } | null;
    }
  | {
      state: "returning";
      resumeId: string;
      role: { slug: string; title: string };
      ride: Ride;
      goals: GoalsSummary;
      week: RideWeek;
      streak: Streak;
      signal: TodaySignal | null;
      current: { skillId: string; name: string } | null;
    };

/**
 * First sign-up: the person has a gap analysis that is still current, made by today's matcher from the latest saved
 * version of a resume's profile. A newer upload that is still being read, or was left half-done, doesn't hide it.
 * No resume: nothing current yet. `unfinishedResumeId` is the newest resume that was read but has no current gaps
 * (never shown, or the profile was corrected since), so Today can send the person back to finish it.
 * Returning: the person has ridden at least one day (ticked a task), or has proved every goal. First's tasks are
 * the first ride's tasks, so a tick there carries over.
 */
export async function todayStateFor(
  userId: string,
  now: Date,
  db: ReturnType<typeof getDb> = getDb(),
  /** `currentAnalysis` already read in this request (null for none), so it is read once; left out, it is read here. */
  read?: CurrentAnalysis | null,
): Promise<TodayState> {
  const analysis = read === undefined ? await currentAnalysis(userId, db) : read;
  if (!analysis) {
    const [unfinished] = await db
      .select({ id: resumes.id })
      .from(resumes)
      .where(and(eq(resumes.userId, userId), inArray(resumes.status, ["parsed", "partial"])))
      .orderBy(desc(resumes.createdAt))
      .limit(1);
    return { state: "no_resume", unfinishedResumeId: unfinished?.id ?? null };
  }

  const result = analysis.result;
  const role = { slug: result.roleSlug, title: roleProfiles.find((r) => r.slug === result.roleSlug)?.title ?? result.roleSlug };
  const today = await todayRideFor(userId, now, db, role.title, { analysis });
  if (today && (today.streak.days > 0 || today.ride.pitstop > today.ride.pitstopCount)) {
    return {
      state: "returning",
      resumeId: analysis.resumeId,
      role,
      ride: today.ride,
      goals: today.goals,
      week: today.week,
      streak: today.streak,
      signal: today.signal,
      current: today.current,
    };
  }
  const gaps = result.gaps.length;
  return {
    state: "first",
    resumeId: analysis.resumeId,
    role,
    tally: { skillsFound: result.metSkillIds.length, gaps, goals: gaps, boardable: gaps === 0 ? 1 : 0 },
    lineHours: Math.max(1, result.readiness.estimatedHours),
    // No goals at all: the resume already shows every required skill.
    firstTasks: today?.ride.tasks ?? [boardTask("Your resume shows every core skill this role requires")],
    goals: today?.goals ?? null,
    signal: today?.signal ?? null,
    current: today?.current ?? null,
  };
}

