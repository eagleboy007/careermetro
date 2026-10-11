import "server-only";
import { and, asc, count, desc, eq, gte, inArray, isNotNull, sql, sum } from "drizzle-orm";
import { getDb } from "@/db";
import { withKeyLock, type Tx } from "@/db/lock";
import { aiCalls, gapAnalyses, paths, pathSteps, profiles, resources, resumes } from "@/db/schema";
import { skills } from "@/content";
import { recordAiCalls } from "@/lib/ai/log";
import { getGapsForOwner, type GapsForOwner } from "@/lib/gaps/store";
import { ownerKey, ownsResume, uploadedBy, type Owner } from "@/lib/owner";
import { singleFlight } from "@/lib/single-flight";
import type { GapStatus, PlannedPath, RoleProfile } from "@/lib/schemas";
import { buildPath } from "./build";
import { writePath, type ResourceTitles, type WriteClient } from "./write";

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
const startOfUtcDay = () => new Date(new Date().toISOString().slice(0, 10) + "T00:00:00Z");

/** True when this owner may spend on another worded path: under its daily count and under the wording budget. */
async function mayWrite(tx: Tx, owner: Owner): Promise<boolean> {
  const [[mine], [spent]] = await Promise.all([
    tx
      .select({ n: count() })
      .from(paths)
      .innerJoin(gapAnalyses, eq(gapAnalyses.id, paths.gapAnalysisId))
      .innerJoin(profiles, eq(profiles.id, gapAnalyses.profileId))
      .innerJoin(resumes, eq(resumes.id, profiles.resumeId))
      .where(and(uploadedBy(owner), isNotNull(paths.aiCallId), gte(paths.createdAt, startOfUtcDay()))),
    tx
      .select({ usd: sum(aiCalls.costUsd) })
      .from(aiCalls)
      .where(and(eq(aiCalls.purpose, "write-path"), gte(aiCalls.createdAt, startOfUtcDay()))),
  ]);
  return mine.n < PATH_LIMITS.wordedPerOwnerPerDay && Number(spent.usd ?? 0) < PATH_LIMITS.dailyBudgetUsd();
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
    path: await readPath(tx, pathId, weeklyHours, statusBySkill, gaps.analysis.gaps.length),
  });

  type Next = { done: PathForOwner } | { plan: PlannedPath; titles: ResourceTitles; write: boolean };
  const first = await withKeyLock(db, lockKey, PATH_LIMITS.lockTimeoutMs, async (tx): Promise<Next> => {
    const pathId = await storedPath(tx);
    if (pathId) return { done: await view(tx, pathId) };
    const catalog = await tx
      .select({ id: resources.id, skillIds: resources.skillIds, minutes: resources.minutes, free: resources.free, healthy: resources.healthy, title: resources.title, provider: resources.provider })
      .from(resources)
      .where(eq(resources.healthy, true));
    const plan = buildPath({ gaps: gaps.analysis.gaps, weeklyHours, resources: catalog });
    const titles: ResourceTitles = new Map(catalog.map((r) => [r.id, { title: r.title, provider: r.provider }]));
    return { plan, titles, write: await mayWrite(tx, owner) };
  });
  if (first === "busy") return { ok: false, reason: "busy" };
  if ("done" in first) return first.done;

  const worded = first.write
    ? await writePath(first.plan, role.title, first.titles, { gapAnalysisId: gaps.analysisId, weeklyHours: String(weeklyHours) }, deps.client)
    : { path: first.plan, calls: [] };

  const second = await withKeyLock(db, lockKey, PATH_LIMITS.lockTimeoutMs, async (tx): Promise<PathForOwner> => {
    const callIds = await recordAiCalls(worded.calls, tx);
    // Another server may have stored one meanwhile; then this call is logged and its wording dropped.
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
      .values({ gapAnalysisId: gaps.analysisId, weeklyHours, aiCallId: callIds.at(-1) ?? null })
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
): Promise<PathView> {
  const steps = await tx.select().from(pathSteps).where(eq(pathSteps.pathId, pathId)).orderBy(asc(pathSteps.position));
  const ids = [...new Set(steps.flatMap((s) => s.resourceIds))];
  const rows = ids.length
    ? await tx
        .select({ id: resources.id, title: resources.title, provider: resources.provider, kind: resources.kind, url: resources.url, minutes: resources.minutes })
        .from(resources)
        .where(inArray(resources.id, ids))
    : [];
  const byId = new Map(rows.map((r) => [r.id, r]));
  let hoursBefore = 0;
  const view = steps.map((s) => {
    const week = Math.floor(hoursBefore / weeklyHours) + 1;
    hoursBefore += s.hours;
    return {
      id: s.id,
      position: s.position,
      skillId: s.skillId,
      skillName: skillNames.get(s.skillId) ?? s.skillId,
      status: statusBySkill.get(s.skillId) ?? "missing",
      hours: s.hours,
      week,
      reason: s.reason,
      proofTask: s.proofTask,
      doneAt: s.doneAt ? s.doneAt.toISOString() : null,
      resources: s.resourceIds.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : [])),
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
