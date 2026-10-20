import "server-only";
import { asc, desc, eq, inArray } from "drizzle-orm";
import { getDb } from "@/db";
import { paths, pathSteps, resources, users } from "@/db/schema";
import { roleProfiles } from "@/content";
import { getResumeForOwner } from "@/lib/resume/store";
import type { LifeLine, MapGoal, MapLine } from "@/lib/schemas";
import { notConfirmedSkills, provedSkills, resourcesForSkills, syncGoals } from "@/lib/goals/store";
import { offerFor, swappedSkill } from "@/lib/goals/not-for-me";
import { nearbyLinesFor } from "@/lib/nearby/build";
import { nearbyOrNothing } from "@/lib/nearby/safe";
import { goalName } from "@/lib/goals/name";
import { fillingSkills } from "@/lib/goals/sync";
import { certificatesFor } from "@/lib/proofs/eligible";
import { choiceName, lineGoals } from "@/lib/ride/store";
import { skillGroupMembers } from "@/content";
import { clip, currentAnalysis, type Db } from "@/lib/today/state";
import { lifeFromProfile } from "./life";
import { otherLines } from "./other-lines";

export { otherLines };

/**
 * The signed-in person's line, from their current gap analysis, their goals and newest path. One goal per gap, in
 * the order of the person's goals, which stays put across new resumes. The person's "Your choice" goals come apart in
 * `choiceGoals`: never gaps, never on the line, never moving the train. A goal is proved only by accepted proof. Null
 * before there is a current analysis (the No resume map).
 */
export async function mapLineFor(userId: string, db: ReturnType<typeof getDb> = getDb(), now = new Date()): Promise<MapLine | null> {
  const analysis = await currentAnalysis(userId, db);
  if (!analysis) return null;
  const { result } = analysis;
  const userGoals = await syncGoals(userId, analysis, db);
  // Certificates rejected after review (FR-44): their goals say so until proved.
  const notConfirmed = await notConfirmedSkills(userId, db);
  const isNotConfirmed = (own: (typeof userGoals)[number] | undefined, skillId: string) =>
    !own?.proved && (own ? fillingSkills(own, skillGroupMembers) : [skillId]).some((id) => notConfirmed.has(id));

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
  // A goal swapped to another skill of its group ("Not for me", FR-48) learns that skill from the catalog.
  const swapped = (own: (typeof userGoals)[number] | undefined) => (own ? swappedSkill(own, skillGroupMembers) : null);
  const swaps = await resourcesForSkills([...new Set(result.gaps.flatMap((g) => swapped(goalBySkill.get(g.skillId)) ?? []))], db);
  const ordered = [...result.gaps].sort(
    (x, y) => (goalBySkill.get(x.skillId)?.position ?? Number.MAX_SAFE_INTEGER) - (goalBySkill.get(y.skillId)?.position ?? Number.MAX_SAFE_INTEGER),
  );
  const resourceItem = (r: { title: string; provider: string; kind: string; minutes: number }) => ({
    title: clip(r.title, 160),
    detail: clip(`${r.provider} · ${r.kind} · ${hours(r.minutes)}`, 120),
  });
  // A swapped goal keeps its learn stop's tick: it is the same goal and the same step on the path (T59).
  const swapItems = (rs: { title: string; provider: string; kind: string; minutes: number }[], step: (typeof steps)[number] | undefined) => ({
    learnDone: Boolean(step?.doneAt),
    resources: rs.slice(0, 3).map(resourceItem),
    practice: null,
  });
  const items = (step: (typeof steps)[number] | undefined) => ({
    learnDone: Boolean(step?.doneAt),
    resources: (step?.resourceIds ?? [])
      .flatMap((id) => {
        const r = byId.get(id);
        return r ? [resourceItem(r)] : [];
      })
      .slice(0, 3),
    practice: step?.proofTask.trim() ? clip(step.proofTask, 400) : null,
  });
  const gapGoals: MapGoal[] = ordered.map((g) => {
    const own = goalBySkill.get(g.skillId);
    const proved = own?.proved ?? false;
    const swap = swapped(own);
    const skipped = own?.status === "skipped";
    return {
      goalId: own?.id ?? null,
      certificates: certificatesFor(own ? fillingSkills(own, skillGroupMembers) : [g.skillId]),
      renew: own?.status === "renew",
      notConfirmed: isNotConfirmed(own, g.skillId),
      skillId: g.skillId,
      name: clip(swap && !proved ? choiceName(swap) : goalName(g, proved, result.roleSlug), 80),
      // An expired certificate turns the goal amber again (dev/proof-plan.md rule 4).
      status: own?.status === "renew" ? "weak" : g.status,
      proved,
      ...(swap ? swapItems(swaps.get(swap) ?? [], stepBySkill.get(g.skillId)) : items(stepBySkill.get(g.skillId))),
      skipped,
      notForMe: own ? offerFor(own, result.roleSlug, skillGroupMembers) : null,
    };
  });
  // "Your choice" goals, off the line: named by the skill, missing until proved, tagged with their job. They never
  // carry the train or count toward Match.
  const choiceGoals: MapGoal[] = lineGoals(userGoals, new Set(result.gaps.map((g) => g.skillId))).chosen.map((own) => ({
    goalId: own.id,
    certificates: certificatesFor(fillingSkills(own, skillGroupMembers)),
    renew: own.status === "renew",
    notConfirmed: isNotConfirmed(own, own.skillId),
    skillId: own.skillId,
    name: clip(choiceName(own.skillId), 80),
    status: own.status === "renew" ? "weak" : "missing",
    proved: own.proved,
    ...items(stepBySkill.get(own.skillId)),
    choice: own.choice ?? { company: null },
  }));

  const role = roleProfiles.find((r) => r.slug === result.roleSlug);
  // Nearby lines read the same confirmed profile and proof as the gaps; they only ever add crossings, never goals.
  const [resume, proved] = await Promise.all([getResumeForOwner(analysis.resumeId, { userId }, db), provedSkills(userId, db)]);
  // If they can't be worked out, the Map and Me render without them (logged as nearby_failed, field paths only).
  const nearby = resume
    ? nearbyOrNothing(() =>
        nearbyLinesFor({ profile: resume.profile, targetSlug: result.roleSlug, proved: new Set(proved), lineSkillIds: gapGoals.map((g) => g.skillId), now }),
      )
    : undefined;
  return {
    role: { slug: result.roleSlug, title: role?.title ?? result.roleSlug },
    resumeId: analysis.resumeId,
    skillsFound: result.metSkillIds.length,
    goals: gapGoals,
    choiceGoals,
    // Other lines cross at the line's gaps: Nearby lines first, as interchanges.
    otherLines: otherLines(result.roleSlug, gapGoals, nearby),
    nearby,
    pathOpened: Boolean(path),
  };
}

const hours = (minutes: number) => (minutes < 60 ? `${minutes} min` : `${Math.round(minutes / 30) / 2} h`);

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
  return lifeFromProfile(resume.profile, {
    joinedAt: user.createdAt,
    now,
    destination: role?.title ?? analysis.result.roleSlug,
    metSkillIds: analysis.result.metSkillIds,
  });
}
