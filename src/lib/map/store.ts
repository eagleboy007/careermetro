import "server-only";
import { asc, desc, eq, inArray } from "drizzle-orm";
import { getDb } from "@/db";
import { paths, pathSteps, resources, users } from "@/db/schema";
import { roleProfiles } from "@/content";
import { getResumeForOwner } from "@/lib/resume/store";
import type { LifeLine, MapGoal, MapLine } from "@/lib/schemas";
import { syncGoals } from "@/lib/goals/store";
import { clip, currentAnalysis, type Db } from "@/lib/today/state";
import { lifeFromProfile } from "./life";

const MAX_OTHER_LINES = 2;

/**
 * The signed-in person's line, from their current gap analysis, their goals and newest path. One goal per gap, in
 * the order of the person's goals, which stays put across new resumes. A goal is proved only by accepted proof.
 * Null before there is a current analysis (the No resume map).
 */
export async function mapLineFor(userId: string, db: ReturnType<typeof getDb> = getDb()): Promise<MapLine | null> {
  const analysis = await currentAnalysis(userId, db);
  if (!analysis) return null;
  const { result } = analysis;
  const userGoals = await syncGoals(userId, analysis, db);

  const [path] = await db.select({ id: paths.id }).from(paths).where(eq(paths.gapAnalysisId, analysis.id)).orderBy(desc(paths.createdAt)).limit(1);
  const steps = path
    ? await db
        .select({ skillId: pathSteps.skillId, resourceIds: pathSteps.resourceIds, proofTask: pathSteps.proofTask, doneAt: pathSteps.doneAt })
        .from(pathSteps)
        .where(eq(pathSteps.pathId, path.id))
        .orderBy(asc(pathSteps.position))
    : [];
  const resourceIds = [...new Set(steps.flatMap((s) => s.resourceIds.slice(0, 3)))];
  const rows = resourceIds.length
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
        .where(inArray(resources.id, resourceIds))
    : [];
  const byId = new Map(rows.filter((r) => r.healthy && r.title.trim()).map((r) => [r.id, r]));
  const stepBySkill = new Map(steps.map((s) => [s.skillId, s]));

  const goalBySkill = new Map(userGoals.map((g) => [g.skillId, g]));
  const ordered = [...result.gaps].sort(
    (x, y) => (goalBySkill.get(x.skillId)?.position ?? Infinity) - (goalBySkill.get(y.skillId)?.position ?? Infinity),
  );
  const goals: MapGoal[] = ordered.map((g) => {
    const step = stepBySkill.get(g.skillId);
    return {
      skillId: g.skillId,
      name: clip(g.skillName, 80),
      status: g.status,
      learnDone: Boolean(step?.doneAt),
      proved: goalBySkill.get(g.skillId)?.proved ?? false,
      resources: (step?.resourceIds ?? [])
        .flatMap((id) => {
          const r = byId.get(id);
          return r ? [{ title: clip(r.title, 160), detail: clip(`${r.provider} · ${r.kind} · ${hours(r.minutes)}`, 120) }] : [];
        })
        .slice(0, 3),
      practice: step?.proofTask.trim() ? clip(step.proofTask, 400) : null,
    };
  });

  const role = roleProfiles.find((r) => r.slug === result.roleSlug);
  return {
    role: { slug: result.roleSlug, title: role?.title ?? result.roleSlug },
    resumeId: analysis.resumeId,
    skillsFound: result.metSkillIds.length,
    goals,
    otherLines: otherLines(result.roleSlug, goals),
    pathOpened: Boolean(path),
  };
}

const hours = (minutes: number) => (minutes < 60 ? `${minutes} min` : `${Math.round(minutes / 30) / 2} h`);

/**
 * Other role profiles that need one of this line's gap skills: the roles sharing the most gaps first. Each crosses at a
 * different goal. People counts come with opted-in profiles (build step 11).
 */
export function otherLines(roleSlug: string, goals: MapGoal[]): MapLine["otherLines"] {
  const gapIds = goals.map((g) => g.skillId);
  const candidates = roleProfiles
    .filter((r) => r.slug !== roleSlug)
    .map((r) => {
      const required = new Set(r.skills.filter((s) => s.importance === "required").map((s) => s.skillId));
      return { role: r, shared: gapIds.filter((id) => required.has(id)) };
    })
    .filter((c) => c.shared.length > 0)
    .sort((a, b) => b.shared.length - a.shared.length || a.role.title.localeCompare(b.role.title));
  const used = new Set<string>();
  const out: MapLine["otherLines"] = [];
  for (const c of candidates) {
    // Cross late on the line, where fewer labels sit, at a goal no other line uses.
    const at = [...c.shared].reverse().find((id) => !used.has(id));
    if (!at) continue;
    used.add(at);
    out.push({ slug: c.role.slug, title: c.role.title, skillId: at });
    if (out.length === MAX_OTHER_LINES) break;
  }
  return out;
}

/**
 * The signed-in person's Life line, from the latest saved profile of the resume behind their current gaps and the day
 * they joined. Null before there is a current analysis, like the role line.
 */
export async function lifeLineFor(userId: string, now: Date, db: Db = getDb()): Promise<LifeLine | null> {
  const analysis = await currentAnalysis(userId, db);
  if (!analysis) return null;
  const [resume, [user]] = await Promise.all([
    getResumeForOwner(analysis.resumeId, { userId }, db),
    db.select({ createdAt: users.createdAt }).from(users).where(eq(users.id, userId)).limit(1),
  ]);
  if (!resume || !user) return null;
  const role = roleProfiles.find((r) => r.slug === analysis.result.roleSlug);
  return lifeFromProfile(resume.profile, { joinedAt: user.createdAt, now, destination: role?.title ?? analysis.result.roleSlug });
}
