import "server-only";
import { and, asc, desc, eq, inArray, isNull, ne } from "drizzle-orm";
import { getDb } from "@/db";
import { gapAnalyses, paths, pathSteps, profiles, resources, resumes } from "@/db/schema";
import { roleProfiles, skills } from "@/content";
import { gapAnalysis, type RideTask } from "@/lib/schemas";

type Db = Pick<ReturnType<typeof getDb>, "select">;

export type FirstTally = { skillsFound: number; gaps: number; goals: number; boardable: number };

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
    };

/**
 * No resume: nothing analysed yet. `unfinishedResumeId` is a resume that was read but whose gaps were never shown,
 * so Today can send the person back to finish it.
 * First sign-up: the latest resume has a gap analysis. Returning needs ride days (build step 6), so it is not picked
 * here yet.
 */
export async function todayStateFor(userId: string, db: Db = getDb()): Promise<TodayState> {
  const [latest] = await db
    .select({ resumeId: resumes.id })
    .from(resumes)
    .where(and(eq(resumes.userId, userId), ne(resumes.status, "failed")))
    .orderBy(desc(resumes.createdAt))
    .limit(1);
  if (!latest) return { state: "no_resume", unfinishedResumeId: null };

  const [analysis] = await db
    .select({ id: gapAnalyses.id, result: gapAnalyses.result })
    .from(gapAnalyses)
    .innerJoin(profiles, eq(profiles.id, gapAnalyses.profileId))
    .where(eq(profiles.resumeId, latest.resumeId))
    .orderBy(desc(gapAnalyses.createdAt))
    .limit(1);
  const parsed = analysis ? gapAnalysis.safeParse(analysis.result) : null;
  if (!analysis || !parsed?.success) return { state: "no_resume", unfinishedResumeId: latest.resumeId };

  const result = parsed.data;
  const role = roleProfiles.find((r) => r.slug === result.roleSlug);
  const gaps = result.gaps.length;
  return {
    state: "first",
    resumeId: latest.resumeId,
    role: { slug: result.roleSlug, title: role?.title ?? result.roleSlug },
    tally: { skillsFound: result.metSkillIds.length, gaps, goals: gaps, boardable: gaps === 0 ? 1 : 0 },
    lineHours: Math.max(1, result.readiness.estimatedHours),
    firstTasks: await firstTasks(analysis.id, result.gaps[0]?.skillId ?? null, db),
  };
}

const skillName = (id: string) => skills.find((s) => s.id === id)?.name ?? id;

/**
 * The first ride: the first unfinished step of the person's path, as a resource to start and part 1 of its proof task.
 * Before they open their path, one task points them to it.
 */
async function firstTasks(analysisId: string, firstGapSkill: string | null, db: Db): Promise<RideTask[]> {
  const [step] = await db
    .select({ id: pathSteps.id, skillId: pathSteps.skillId, resourceIds: pathSteps.resourceIds, proofTask: pathSteps.proofTask })
    .from(pathSteps)
    .innerJoin(paths, eq(paths.id, pathSteps.pathId))
    .where(and(eq(paths.gapAnalysisId, analysisId), isNull(pathSteps.doneAt)))
    .orderBy(desc(paths.createdAt), asc(pathSteps.position))
    .limit(1);
  if (!step) {
    const name = firstGapSkill ? skillName(firstGapSkill) : "your first goal";
    return [{ id: "open-path", title: `Open your path for ${name}`, detail: "Free courses picked for your gaps", minutes: 5, done: false, locked: false }];
  }
  const [resource] = step.resourceIds.length
    ? await db
        .select({ title: resources.title, provider: resources.provider, kind: resources.kind, minutes: resources.minutes })
        .from(resources)
        .where(inArray(resources.id, step.resourceIds.slice(0, 1)))
    : [];
  const tasks: RideTask[] = [];
  if (resource) {
    tasks.push({
      id: `${step.id}-learn`,
      title: resource.title.slice(0, 120),
      detail: `${resource.provider} · ${resource.kind}`.slice(0, 120),
      minutes: Math.min(240, Math.max(1, resource.minutes)),
      done: false,
      locked: false,
    });
  }
  tasks.push({
    id: `${step.id}-proof`,
    title: step.proofTask.slice(0, 120),
    detail: `Proof task, part 1 · ${skillName(step.skillId)}`.slice(0, 120),
    minutes: 15,
    done: false,
    locked: false,
  });
  return tasks;
}
