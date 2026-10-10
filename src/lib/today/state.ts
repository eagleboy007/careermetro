import "server-only";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { gapAnalyses, paths, pathSteps, profiles, resources, resumes } from "@/db/schema";
import { roleProfiles, skills } from "@/content";
import { MATCHER_VERSION } from "@/lib/gaps/match";
import { gapAnalysis, rideTask, type FirstTally, type RideTask } from "@/lib/schemas";

type Db = Pick<ReturnType<typeof getDb>, "select">;

export type { FirstTally };

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
 * First sign-up: the person has a gap analysis that is still current, made by today's matcher from the latest saved
 * version of a resume's profile. A newer upload that is still being read, or was left half-done, doesn't hide it.
 * No resume: nothing current yet. `unfinishedResumeId` is the newest resume that was read but has no current gaps
 * (never shown, or the profile was corrected since), so Today can send the person back to finish it.
 * Returning needs ride days (build step 6), so it is not picked here yet.
 */
export async function todayStateFor(userId: string, db: Db = getDb()): Promise<TodayState> {
  const [analysis] = await db
    .select({ id: gapAnalyses.id, result: gapAnalyses.result, resumeId: resumes.id })
    .from(gapAnalyses)
    .innerJoin(profiles, eq(profiles.id, gapAnalyses.profileId))
    .innerJoin(resumes, eq(resumes.id, profiles.resumeId))
    .where(
      and(
        eq(resumes.userId, userId),
        eq(gapAnalyses.matcherVersion, MATCHER_VERSION),
        sql`${profiles.version} = (select max(p2.version) from profiles p2 where p2.resume_id = ${profiles.resumeId})`,
      ),
    )
    .orderBy(desc(gapAnalyses.createdAt))
    .limit(1);
  const parsed = analysis ? gapAnalysis.safeParse(analysis.result) : null;
  if (!analysis || !parsed?.success) {
    const [unfinished] = await db
      .select({ id: resumes.id })
      .from(resumes)
      .where(and(eq(resumes.userId, userId), inArray(resumes.status, ["parsed", "partial"])))
      .orderBy(desc(resumes.createdAt))
      .limit(1);
    return { state: "no_resume", unfinishedResumeId: unfinished?.id ?? null };
  }

  const result = parsed.data;
  const role = roleProfiles.find((r) => r.slug === result.roleSlug);
  const gaps = result.gaps.length;
  return {
    state: "first",
    resumeId: analysis.resumeId,
    role: { slug: result.roleSlug, title: role?.title ?? result.roleSlug },
    tally: { skillsFound: result.metSkillIds.length, gaps, goals: gaps, boardable: gaps === 0 ? 1 : 0 },
    lineHours: Math.max(1, result.readiness.estimatedHours),
    firstTasks: await firstTasks(analysis.id, result.gaps[0]?.skillId ?? null, db),
  };
}

const skillName = (id: string) => skills.find((s) => s.id === id)?.name ?? id;

/** Shortens to `max` characters at a word break, with an ellipsis. */
export function clip(text: string, max: number): string {
  const t = text.trim().replace(/\s+/g, " ");
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > max / 2 ? cut.slice(0, space) : cut).replace(/[\s.,;:·-]+$/, "")}…`;
}

/**
 * The first ride: the first unfinished step of the person's newest path, as a resource to start and part 1 of its
 * proof task. Before they open a path, one task points them to it; once every step is done, one task says so.
 */
async function firstTasks(analysisId: string, firstGapSkill: string | null, db: Db): Promise<RideTask[]> {
  const [path] = await db
    .select({ id: paths.id })
    .from(paths)
    .where(eq(paths.gapAnalysisId, analysisId))
    .orderBy(desc(paths.createdAt))
    .limit(1);
  const openPath: RideTask = {
    id: "open-path",
    title: clip(`Open your path for ${firstGapSkill ? skillName(firstGapSkill) : "your first goal"}`, 120),
    detail: "Free courses picked for your gaps",
    minutes: 5,
    done: false,
    locked: false,
  };
  if (!path) return [openPath];
  const [step] = await db
    .select({ id: pathSteps.id, skillId: pathSteps.skillId, resourceIds: pathSteps.resourceIds, proofTask: pathSteps.proofTask })
    .from(pathSteps)
    .where(and(eq(pathSteps.pathId, path.id), isNull(pathSteps.doneAt)))
    .orderBy(asc(pathSteps.position))
    .limit(1);
  if (!step) {
    return [{ id: "path-done", title: "Every step on your path is done", detail: "Prove a goal to fill its gap", minutes: 5, done: false, locked: false }];
  }
  const [resource] = step.resourceIds.length
    ? await db
        .select({ title: resources.title, provider: resources.provider, kind: resources.kind, minutes: resources.minutes })
        .from(resources)
        .where(and(inArray(resources.id, step.resourceIds.slice(0, 1)), eq(resources.healthy, true)))
    : [];
  const tasks: RideTask[] = [];
  if (resource) {
    tasks.push({
      id: `${step.id}-learn`,
      title: clip(resource.title, 120),
      detail: clip(`${resource.provider} · ${resource.kind}`, 120),
      minutes: Math.min(240, Math.max(1, resource.minutes)),
      done: false,
      locked: false,
    });
  }
  tasks.push({
    id: `${step.id}-proof`,
    title: clip(step.proofTask, 120),
    detail: clip(`Proof task, part 1 · ${skillName(step.skillId)}`, 120),
    minutes: 15,
    done: false,
    locked: false,
  });
  // Drop any task the ride schema would reject, for example one made from an empty title.
  const valid = tasks.filter((t) => rideTask.safeParse(t).success);
  return valid.length ? valid : [openPath];
}
