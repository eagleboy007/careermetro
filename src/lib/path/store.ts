import "server-only";
import { and, asc, desc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { withKeyLock, type Tx } from "@/db/lock";
import { gapAnalyses, paths, pathSteps, profiles, resources, resumes } from "@/db/schema";
import { skillGroupMembers, skills } from "@/content";
import { loadPrompt } from "@/lib/ai/prompts";
import { refIn, reserveCall, runReserved, usedToday } from "@/lib/ai/reserve";
import { getGapsForOwner, type GapsForOwner } from "@/lib/gaps/store";
import { swappedSkill } from "@/lib/goals/not-for-me";
import { goalsOf, resourcesForSkills } from "@/lib/goals/store";
import { ownerKey, ownsResume, uploadedBy, type Owner } from "@/lib/owner";
import { singleFlight } from "@/lib/single-flight";
import type { GapStatus, PlannedPath, RoleProfile } from "@/lib/schemas";
import { buildPath } from "./build";
import { WRITE_PATH_MODEL, writePath, type ResourceTitles, type WriteClient } from "./write";

type Db = ReturnType<typeof getDb>;

export const PATH_LIMITS = {
  /** Model-worded paths per user or anonymous session per day; after that the path keeps template wording. */
  wordedPerOwnerPerDay: 15,
  /** Spend on path wording per UTC day, across all users, kept apart from the other budgets (AI-6). */
  dailyBudgetUsd: () => Number(process.env.WRITE_PATH_DAILY_BUDGET_USD ?? 2),
  lockTimeoutMs: 30_000,
};

export type PathStepView = {
  id: string;
  position: number;
  skillId: string;
  skillName: string;
  status: Exclude<GapStatus, "met">;
  hours: number;
  week: number;
  reason: string;
  proofTask: string;
  doneAt: string | null;
  resources: { id: string; title: string; provider: string; kind: string; url: string; minutes: number }[];
};

export type PathView = {
  pathId: string;
  weeklyHours: number;
  steps: PathStepView[];
  totalHours: number;
  weeks: number;
  doneCount: number;
  /** Gaps left out to keep the path to about 6 weeks. */
  deferredCount: number;
};

export type PathForOwner =
  | { ok: true; path: PathView }
  | { ok: false; reason: Extract<GapsForOwner, { ok: false }>["reason"] | "no_gaps" };

const skillNames = new Map(skills.map((s) => [s.id, s.name]));

/** What a path wording still running is assumed to cost when checking the budget. */
const IN_FLIGHT_WRITE_USD = 0.1;

/**
 * Reserves a worded path when this owner is under its daily count and the wording budget has room, and returns the
 * reserved call's id; null keeps template wording. Like the Gaps page, it runs under a short lock for the purpose.
 * Never called for the sample resume (T113): its path keeps template wording.
 */
async function reserveWording(tx: Tx, owner: Owner, gapAnalysisId: string, weeklyHours: number): Promise<string | null> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext('cm-ai:write-path'))`);
  const ownAnalyses = tx
    .select({ id: sql<string>`${gapAnalyses.id}::text` })
    .from(gapAnalyses)
    .innerJoin(profiles, eq(profiles.id, gapAnalyses.profileId))
    .innerJoin(resumes, eq(resumes.id, profiles.resumeId))
    .where(uploadedBy(owner));
  const used = await usedToday(tx, "write-path", IN_FLIGHT_WRITE_USD, refIn("gapAnalysisId", ownAnalyses));
  if (used.mine >= PATH_LIMITS.wordedPerOwnerPerDay || used.usd >= PATH_LIMITS.dailyBudgetUsd()) return null;
  return reserveCall(tx, {
    purpose: "write-path",
    model: WRITE_PATH_MODEL,
    promptVersion: loadPrompt("write-path").id,
    inputRefs: { gapAnalysisId, weeklyHours: String(weeklyHours) },
  });
}

/**
 * FR-15 to FR-18: this owner's learning path for a role at the chosen weekly hours. Reuses the stored path for
 * the same gap analysis and hours; otherwise builds it in code, asks the model to word it (or keeps template
 * wording past the limits) and stores it. Like the Gaps page, the model call runs between two short locked
 * transactions, never inside one, and concurrent loads of the same path on one server share one run.
 */
export async function getPathForOwner(
  resumeId: string,
  owner: Owner,
  role: RoleProfile,
  weeklyHours: number,
  deps: { db?: Db; client?: WriteClient; now?: Date } = {},
): Promise<PathForOwner> {
  return singleFlight(`cm-path:${ownerKey(owner)}:${resumeId}:${role.slug}:${weeklyHours}`, () =>
    buildForOwner(resumeId, owner, role, weeklyHours, deps),
  );
}

async function buildForOwner(
  resumeId: string,
  owner: Owner,
  role: RoleProfile,
  weeklyHours: number,
  deps: { db?: Db; client?: WriteClient; now?: Date },
): Promise<PathForOwner> {
  const db = deps.db ?? getDb();
  const gaps = await getGapsForOwner(resumeId, owner, role, { db, now: deps.now });
  if (!gaps.ok) return gaps;
  if (gaps.analysis.gaps.length === 0) return { ok: false, reason: "no_gaps" };
  const statusBySkill = new Map(gaps.analysis.gaps.map((g) => [g.skillId, g.status]));
  const lockKey = `cm-path:${ownerKey(owner)}`;
  const storedPath = async (tx: Tx) => {
    const [stored] = await tx
      .select({ id: paths.id })
      .from(paths)
      .where(and(eq(paths.gapAnalysisId, gaps.analysisId), eq(paths.weeklyHours, weeklyHours)))
      .orderBy(desc(paths.createdAt))
      .limit(1);
    return stored?.id;
  };
  const view = async (tx: Tx, pathId: string): Promise<PathForOwner> => ({
    ok: true,
    path: await readPath(tx, pathId, weeklyHours, statusBySkill, gaps.analysis.gaps.length, owner),
  });

  type Next = { done: PathForOwner } | { plan: PlannedPath; titles: ResourceTitles; reservedId: string | null };
  const first = await withKeyLock(db, lockKey, PATH_LIMITS.lockTimeoutMs, async (tx): Promise<Next> => {
    const pathId = await storedPath(tx);
    if (pathId) return { done: await view(tx, pathId) };
    const catalog = await tx
      .select({ id: resources.id, skillIds: resources.skillIds, minutes: resources.minutes, free: resources.free, healthy: resources.healthy, title: resources.title, provider: resources.provider })
      .from(resources)
      .where(and(eq(resources.healthy, true), isNull(resources.hiddenAt)));
    const plan = buildPath({ gaps: gaps.analysis.gaps, weeklyHours, resources: catalog });
    const titles: ResourceTitles = new Map(catalog.map((r) => [r.id, { title: r.title, provider: r.provider }]));
    // The sample resume's path keeps template wording (T113): no model call and none of the shared wording budget.
    const reservedId = gaps.sample ? null : await reserveWording(tx, owner, gaps.analysisId, weeklyHours);
    return { plan, titles, reservedId };
  });
  if (first === "busy") return { ok: false, reason: "busy" };
  if ("done" in first) return first.done;

  // Settled at once, outside any lock, so the cost counts even if storing fails below.
  const { plan, titles } = first;
  const worded = first.reservedId
    ? await runReserved(db, first.reservedId, () =>
        writePath(plan, role.title, titles, { gapAnalysisId: gaps.analysisId, weeklyHours: String(weeklyHours) }, deps.client),
      )
    : { path: plan, calls: [], callId: null };
  const callId = worded.callId;

  const second = await withKeyLock(db, lockKey, PATH_LIMITS.lockTimeoutMs, async (tx): Promise<PathForOwner> => {
    // Another request may have stored one meanwhile; then this call stays logged and its wording is dropped.
    const storedId = await storedPath(tx);
    if (storedId) return view(tx, storedId);
    // Steps already done stay done here (FR-18): at another hours setting, and on the person's earlier paths, so a
    // new upload or a corrected profile doesn't lose progress (T21). The earliest date is kept.
    const doneRows = await tx
      .select({ skillId: pathSteps.skillId, doneAt: pathSteps.doneAt })
      .from(pathSteps)
      .innerJoin(paths, eq(paths.id, pathSteps.pathId))
      .innerJoin(gapAnalyses, eq(gapAnalyses.id, paths.gapAnalysisId))
      .innerJoin(profiles, eq(profiles.id, gapAnalyses.profileId))
      .innerJoin(resumes, eq(resumes.id, profiles.resumeId))
      .where(and(ownsResume(owner), isNotNull(pathSteps.doneAt), eq(pathSteps.kind, "learn")))
      .orderBy(asc(pathSteps.doneAt));
    const doneBySkill = new Map<string, Date | null>();
    for (const r of doneRows) if (!doneBySkill.has(r.skillId)) doneBySkill.set(r.skillId, r.doneAt);
    const [row] = await tx
      .insert(paths)
      .values({ gapAnalysisId: gaps.analysisId, weeklyHours, aiCallId: callId })
      .returning({ id: paths.id });
    await tx.insert(pathSteps).values(
      worded.path.steps.map((s) => ({
        pathId: row.id,
        position: s.position,
        skillId: s.skillId,
        reason: s.reason,
        hours: s.hours,
        resourceIds: s.resourceIds,
        proofTask: s.proofTask,
        doneAt: doneBySkill.get(s.skillId) ?? null,
      })),
    );
    return view(tx, row.id);
  });
  return second === "busy" ? { ok: false, reason: "busy" } : second;
}

async function readPath(
  tx: Tx,
  pathId: string,
  weeklyHours: number,
  statusBySkill: ReadonlyMap<string, Exclude<GapStatus, "met">>,
  gapCount: number,
  owner: Owner,
): Promise<PathView> {
  const steps = await tx.select().from(pathSteps).where(eq(pathSteps.pathId, pathId)).orderBy(asc(pathSteps.position));
  // A goal swapped to another skill of its group ("Not for me", FR-48) learns that skill from the catalog here too,
  // as on the Map and Today (T58). Only a signed-in person has goals.
  const swapBySkill = new Map<string, string>();
  if (owner.userId !== undefined) {
    for (const g of await goalsOf(owner.userId, tx)) {
      const swap = swappedSkill(g, skillGroupMembers);
      if (swap) swapBySkill.set(g.skillId, swap);
    }
  }
  const swaps = await resourcesForSkills([...new Set(swapBySkill.values())], tx);
  const ids = [...new Set(steps.flatMap((s) => s.resourceIds))];
  const rows = ids.length
    ? await tx
        .select({ id: resources.id, title: resources.title, provider: resources.provider, kind: resources.kind, url: resources.url, minutes: resources.minutes })
        .from(resources)
        // A link an admin hid (/admin/library) leaves the path at once.
        .where(and(inArray(resources.id, ids), isNull(resources.hiddenAt)))
    : [];
  const byId = new Map(rows.map((r) => [r.id, r]));
  let hoursBefore = 0;
  const view = steps.map((s) => {
    const week = Math.floor(hoursBefore / weeklyHours) + 1;
    hoursBefore += s.hours;
    const swap = swapBySkill.get(s.skillId);
    return {
      id: s.id,
      position: s.position,
      skillId: s.skillId,
      skillName: skillNames.get(swap ?? s.skillId) ?? swap ?? s.skillId,
      status: statusBySkill.get(s.skillId) ?? "missing",
      hours: s.hours,
      week,
      // The worded reason and proof task were written for the goal's own skill.
      reason: swap ? `You chose ${skillNames.get(swap) ?? swap} instead. Any skill of the group fills this goal.` : s.reason,
      proofTask: swap ? "" : s.proofTask,
      doneAt: s.doneAt ? s.doneAt.toISOString() : null,
      resources: swap ? (swaps.get(swap) ?? []) : s.resourceIds.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : [])),
    };
  });
  return {
    pathId,
    weeklyHours,
    steps: view,
    totalHours: hoursBefore,
    weeks: Math.ceil(hoursBefore / weeklyHours),
    doneCount: view.filter((s) => s.doneAt).length,
    deferredCount: Math.max(0, gapCount - view.length),
  };
}

/**
 * FR-18: marks one of the owner's path steps done or not done (an anonymous one only within its 24 hours). The same
 * skill's step in the paths for other hours settings changes with it, so progress survives a change of hours.
 */
export async function markStepDone(stepId: string, owner: Owner, done: boolean, db: Db = getDb()): Promise<boolean> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(stepId)) return false;
  const [step] = await db
    .select({ skillId: pathSteps.skillId })
    .from(pathSteps)
    .innerJoin(paths, eq(paths.id, pathSteps.pathId))
    .innerJoin(gapAnalyses, eq(gapAnalyses.id, paths.gapAnalysisId))
    .innerJoin(profiles, eq(profiles.id, gapAnalyses.profileId))
    .innerJoin(resumes, eq(resumes.id, profiles.resumeId))
    .where(and(eq(pathSteps.id, stepId), ownsResume(owner)));
  if (!step) return false;
  // The same skill on every one of the person's paths (other hours, earlier uploads) moves together, so a path built
  // later starts from the same progress and an undo doesn't come back. Marking again keeps the first date.
  const ownPaths = db
    .select({ id: paths.id })
    .from(paths)
    .innerJoin(gapAnalyses, eq(gapAnalyses.id, paths.gapAnalysisId))
    .innerJoin(profiles, eq(profiles.id, gapAnalyses.profileId))
    .innerJoin(resumes, eq(resumes.id, profiles.resumeId))
    .where(ownsResume(owner));
  await db
    .update(pathSteps)
    .set({ doneAt: done ? sql`coalesce(${pathSteps.doneAt}, now())` : null })
    .where(and(eq(pathSteps.skillId, step.skillId), eq(pathSteps.kind, "learn"), inArray(pathSteps.pathId, ownPaths)));
  return true;
}
