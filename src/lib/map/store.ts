import "server-only";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
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
import type { CurrentAnalysis } from "@/lib/gaps/current";
import { clip, currentAnalysis, type Db } from "@/lib/today/state";
import { trackRank } from "@/lib/tracks/apply";
import { trackedCurrentAnalysis } from "@/lib/tracks/store";
import { interestsOf } from "@/lib/me/edit-store";
import { learningSkill, ownPitstopsByGoal, pitstopOptionsFor } from "@/lib/pitstops/store";
import { lifeFromProfile } from "./life";
import { otherLines } from "./other-lines";

export { otherLines };

/**
 * The signed-in person's line, from their current gap analysis as their track sees it (docs/plans/tracks-plan.md),
 * their goals and newest path. One goal per gap, in the track's order and then the order of the person's goals, which
 * stays put across new resumes. The person's "Your choice" goals come apart in
 * `choiceGoals`: never gaps, never on the line, never moving the train. A goal is proved only by accepted proof. Null
 * before there is a current analysis (the No resume map). `read` is `currentAnalysis` already read in this request
 * (null for none); left out, it is read here.
 */
export async function mapLineFor(
  userId: string,
  db: ReturnType<typeof getDb> = getDb(),
  now = new Date(),
  read?: CurrentAnalysis | null,
): Promise<MapLine | null> {
  const analysis = await trackedCurrentAnalysis(userId, db, undefined, read);
  if (!analysis) return null;
  const { result } = analysis;
  // The goals, the held certificates, the newest path with its steps and courses, the resume and the proof don't depend
  // on each other, so they are read together rather than one after another (docs/plans/perf-pass.md). Syncing writes
  // only goals and the steps' goal links, which none of the other reads use.
  const pathAndSteps = async () => {
    const [path] = await db.select({ id: paths.id }).from(paths).where(eq(paths.gapAnalysisId, analysis.id)).orderBy(desc(paths.createdAt)).limit(1);
    const steps = path
      ? await db
          .select({ skillId: pathSteps.skillId, resourceIds: pathSteps.resourceIds, proofTask: pathSteps.proofTask, doneAt: pathSteps.doneAt })
          .from(pathSteps)
          // The path's own steps; the person's own pitstops (FR-58) are read by goal below.
          .where(and(eq(pathSteps.pathId, path.id), eq(pathSteps.source, "app")))
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
            hiddenAt: resources.hiddenAt,
          })
          .from(resources)
          .where(inArray(resources.id, resourceIds))
      : [];
    return { path, steps, rows };
  };
  // Nearby lines read the same confirmed profile and proof as the gaps; they only ever add crossings, never goals.
  const [userGoals, notConfirmed, { path, steps, rows }, resume, proved, ownByGoal] = await Promise.all([
    syncGoals(userId, analysis, db),
    // Certificates rejected after review (FR-44): their goals say so until proved.
    notConfirmedSkills(userId, db),
    pathAndSteps(),
    getResumeForOwner(analysis.resumeId, { userId }, db),
    provedSkills(userId, db),
    ownPitstopsByGoal(userId, db),
  ]);
  const isNotConfirmed = (own: (typeof userGoals)[number] | undefined, skillId: string) =>
    !own?.proved && (own ? fillingSkills(own, skillGroupMembers) : [skillId]).some((id) => notConfirmed.has(id));

  // A link an admin hid (/admin/library) leaves the Map's stops at once, like a broken one.
  const byId = new Map(rows.filter((r) => r.healthy && !r.hiddenAt && r.title.trim()).map((r) => [r.id, r]));
  const stepBySkill = new Map(steps.map((s) => [s.skillId, s]));

  const goalBySkill = new Map(userGoals.map((g) => [g.skillId, g]));
  // A goal swapped to another skill of its group ("Not for me", FR-48) learns that skill from the catalog.
  const swapped = (own: (typeof userGoals)[number] | undefined) => (own ? swappedSkill(own, skillGroupMembers) : null);
  const swaps = await resourcesForSkills([...new Set(result.gaps.flatMap((g) => swapped(goalBySkill.get(g.skillId)) ?? []))], db);
  const rank = trackRank(analysis.track);
  const ordered = [...result.gaps].sort(
    (x, y) =>
      rank(x.skillId) - rank(y.skillId) ||
      (goalBySkill.get(x.skillId)?.position ?? Number.MAX_SAFE_INTEGER) - (goalBySkill.get(y.skillId)?.position ?? Number.MAX_SAFE_INTEGER),
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

  // The person's own pitstops (FR-58) on each goal, and for each open goal the free courses offered when adding one:
  // the next unused catalog links for the skill it is learning. They never change the line, the train or the counts.
  const goalById = new Map(userGoals.map((g) => [g.id, g]));
  const openGoals = [...gapGoals, ...choiceGoals].flatMap((g) => {
    const mine = g.goalId ? goalById.get(g.goalId) : undefined;
    const skillId = mine && !g.skipped ? learningSkill(mine) : null;
    if (!mine || !skillId) return [];
    const used = [...(stepBySkill.get(mine.skillId)?.resourceIds ?? []), ...(ownByGoal.get(mine.id) ?? []).flatMap((p) => (p.course ? [p.course.id] : []))];
    return [{ goalId: mine.id, skillId, used }];
  });
  const options = await pitstopOptionsFor(openGoals, db);
  const withOwn = (g: MapGoal): MapGoal => {
    if (!g.goalId) return g;
    const mine = ownByGoal.get(g.goalId) ?? [];
    const offered = options.get(g.goalId);
    return { ...g, ...(mine.length ? { ownPitstops: mine } : {}), ...(offered ? { pitstopOptions: offered } : {}) };
  };

  const role = roleProfiles.find((r) => r.slug === result.roleSlug);
  // If they can't be worked out, the Map and Me render without them (logged as nearby_failed, field paths only).
  const nearby = resume
    ? nearbyOrNothing(() =>
        nearbyLinesFor({ profile: resume.profile, targetSlug: result.roleSlug, proved: new Set(proved), lineSkillIds: gapGoals.map((g) => g.skillId), now }),
      )
    : undefined;
  return {
    role: { slug: result.roleSlug, title: role?.title ?? result.roleSlug },
    resumeId: analysis.resumeId,
    // What the resume shows against the whole role, as on the Gaps page; the track changes the line, not the reading.
    skillsFound: analysis.base.metSkillIds.length,
    goals: gapGoals.map(withOwn),
    choiceGoals: choiceGoals.map(withOwn),
    // Other lines cross at the line's gaps: Nearby lines first, as interchanges.
    otherLines: otherLines(result.roleSlug, gapGoals, nearby),
    nearby,
    pathOpened: Boolean(path),
  };
}

const hours = (minutes: number) => (minutes < 60 ? `${minutes} min` : `${Math.round(minutes / 30) / 2} h`);

/**
 * The signed-in person's Life line, from the latest saved profile of the resume behind their current gaps, the day
 * they joined and the interests they added on Me. Null before there is a current analysis, like the role line. `read` is `currentAnalysis` already read
 * in this request (null for none); left out, it is read here.
 */
export async function lifeLineFor(userId: string, now: Date, db: Db = getDb(), read?: CurrentAnalysis | null): Promise<LifeLine | null> {
  const analysis = read === undefined ? await currentAnalysis(userId, db) : read;
  if (!analysis) return null;
  const [resume, [user], interests] = await Promise.all([
    getResumeForOwner(analysis.resumeId, { userId }, db),
    db.select({ createdAt: users.createdAt }).from(users).where(eq(users.id, userId)).limit(1),
    interestsOf(userId, db),
  ]);
  if (!resume || !user) return null;
  const role = roleProfiles.find((r) => r.slug === analysis.result.roleSlug);
  return lifeFromProfile(resume.profile, {
    joinedAt: user.createdAt,
    now,
    destination: role?.title ?? analysis.result.roleSlug,
    metSkillIds: analysis.result.metSkillIds,
    interests,
  });
}
