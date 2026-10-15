import "server-only";
import { and, asc, count, desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { jobs, organizations, paths, pathSteps, roleProfiles as roleRows } from "@/db/schema";
import { currentAnalysis } from "@/lib/gaps/current";
import { provedSkills } from "@/lib/goals/store";
import { errorFields, logEvent } from "@/lib/log";
import { getResumeForOwner } from "@/lib/resume/store";
import type { MatchList } from "@/lib/schemas";
import { matchListFor } from "./build";
import { matchHoursFor } from "./group";

type Db = ReturnType<typeof getDb>;

/**
 * Open jobs in Departures by role slug: the jobs Departures lists (open, from a verified company), counted by the role
 * profile they started from. Company names and job text are never read here.
 */
export async function openJobsByRole(db: Db = getDb()): Promise<Map<string, number>> {
  const rows = await db
    .select({ slug: roleRows.slug, n: count() })
    .from(jobs)
    .innerJoin(organizations, eq(organizations.id, jobs.orgId))
    .innerJoin(roleRows, eq(roleRows.id, jobs.roleProfileId))
    .where(and(eq(jobs.status, "open"), eq(organizations.reviewStatus, "verified")))
    .groupBy(roleRows.slug);
  return new Map(rows.map((r) => [r.slug, Number(r.n)]));
}

/** The counts are an extra: if they can't be read, Match still shows, with a plain link to Departures. */
async function openJobsOrNull(db: Db): Promise<Map<string, number> | null> {
  try {
    return await openJobsByRole(db);
  } catch (error) {
    logEvent("error", "match_jobs_failed", errorFields(error));
    return null;
  }
}

/**
 * Learning hours left on the newest path for the person's current analysis, by skill: a step's hours, or 0 once it is
 * marked done. The analysis is already the person's own (read by their user id), so its path is too.
 */
async function pathHoursFor(gapAnalysisId: string, db: Db): Promise<Map<string, number>> {
  const [path] = await db.select({ id: paths.id }).from(paths).where(eq(paths.gapAnalysisId, gapAnalysisId)).orderBy(desc(paths.createdAt)).limit(1);
  if (!path) return new Map();
  const steps = await db
    .select({ skillId: pathSteps.skillId, hours: pathSteps.hours, doneAt: pathSteps.doneAt })
    .from(pathSteps)
    .where(eq(pathSteps.pathId, path.id))
    .orderBy(asc(pathSteps.position));
  return new Map(steps.map((s) => [s.skillId, s.doneAt ? 0 : s.hours]));
}

/**
 * The signed-in person's Match (FR-24): from the confirmed profile behind their current gaps, their current accepted
 * proof, their newest path's hours and the open jobs in Departures. Every read is scoped to `userId`. Null before
 * there is a current analysis (the "No roles to show yet" state). `savedHours` is their hours a week from Today.
 */
export async function matchFor(userId: string, savedHours: number | null, db: Db = getDb(), now = new Date()): Promise<MatchList | null> {
  const analysis = await currentAnalysis(userId, db);
  if (!analysis) return null;
  const [resume, proved, pathHours, openJobs] = await Promise.all([
    getResumeForOwner(analysis.resumeId, { userId }, db),
    provedSkills(userId, db),
    pathHoursFor(analysis.id, db),
    openJobsOrNull(db),
  ]);
  if (!resume) return null;
  return matchListFor({
    profile: resume.profile,
    targetSlug: analysis.result.roleSlug,
    resumeId: analysis.resumeId,
    weeklyHours: matchHoursFor(savedHours),
    proved: new Set(proved),
    pathHours,
    openJobs,
    now,
  });
}
