import "server-only";
import { and, asc, count, desc, eq, gt, gte, inArray, isNotNull, or, sql, sum } from "drizzle-orm";
import { getDb } from "@/db";
import { aiCalls, gapAnalyses, paths, pathSteps, profiles, resources, resumes } from "@/db/schema";
import { skills } from "@/content";
import { recordAiCalls } from "@/lib/ai/log";
import { getGapsForSession, type GapsForSession } from "@/lib/gaps/store";
import type { GapStatus, RoleProfile } from "@/lib/schemas";
import { ANONYMOUS_TTL_HOURS } from "@/lib/session";
import { buildPath } from "./build";
import { writePath, type WriteClient } from "./write";

type Db = ReturnType<typeof getDb>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export const PATH_LIMITS = {
  /** Model-worded paths per anonymous session per day; after that the path keeps template wording. */
  wordedPerSessionPerDay: 15,
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

export type PathForSession =
  | { ok: true; path: PathView }
  | { ok: false; reason: Extract<GapsForSession, { ok: false }>["reason"] | "no_gaps" };

const skillNames = new Map(skills.map((s) => [s.id, s.name]));
const startOfUtcDay = () => new Date(new Date().toISOString().slice(0, 10) + "T00:00:00Z");
const notExpired = () => or(gt(resumes.createdAt, new Date(Date.now() - ANONYMOUS_TTL_HOURS * 3600_000)), isNotNull(resumes.userId));

/** True when this session may spend on another worded path: under its daily count and under the wording budget. */
async function mayWrite(tx: Tx, sessionId: string): Promise<boolean> {
  const [[mine], [spent]] = await Promise.all([
    tx
      .select({ n: count() })
      .from(paths)
      .innerJoin(gapAnalyses, eq(gapAnalyses.id, paths.gapAnalysisId))
      .innerJoin(profiles, eq(profiles.id, gapAnalyses.profileId))
      .innerJoin(resumes, eq(resumes.id, profiles.resumeId))
      .where(and(eq(resumes.anonymousSessionId, sessionId), isNotNull(paths.aiCallId), gte(paths.createdAt, startOfUtcDay()))),
    tx
      .select({ usd: sum(aiCalls.costUsd) })
      .from(aiCalls)
      .where(and(eq(aiCalls.purpose, "write-path"), gte(aiCalls.createdAt, startOfUtcDay()))),
  ]);
  return mine.n < PATH_LIMITS.wordedPerSessionPerDay && Number(spent.usd ?? 0) < PATH_LIMITS.dailyBudgetUsd();
}

/**
 * FR-15 to FR-18: this session's learning path for a role at the chosen weekly hours. Reuses the stored path for
 * the same gap analysis and hours; otherwise builds it in code, asks the model to word it (or keeps template
 * wording past the limits) and stores it. Runs under a per-session lock, like the Gaps page.
 */
export async function getPathForSession(
  resumeId: string,
  sessionId: string,
  role: RoleProfile,
  weeklyHours: number,
  deps: { db?: Db; client?: WriteClient; now?: Date } = {},
): Promise<PathForSession> {
  const db = deps.db ?? getDb();
  const gaps = await getGapsForSession(resumeId, sessionId, role, { db, now: deps.now });
  if (!gaps.ok) return gaps;
  if (gaps.analysis.gaps.length === 0) return { ok: false, reason: "no_gaps" };
  const statusBySkill = new Map(gaps.analysis.gaps.map((g) => [g.skillId, g.status]));

  try {
    return await db.transaction(async (tx) => {
      await tx.execute(sql.raw(`set local lock_timeout = ${Math.trunc(PATH_LIMITS.lockTimeoutMs)}`));
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`cm-path:${sessionId}`}))`);

      const [stored] = await tx
        .select({ id: paths.id })
        .from(paths)
        .where(and(eq(paths.gapAnalysisId, gaps.analysisId), eq(paths.weeklyHours, weeklyHours)))
        .orderBy(desc(paths.createdAt))
        .limit(1);
      let pathId = stored?.id;

      if (!pathId) {
        const catalog = await tx
          .select({ id: resources.id, skillIds: resources.skillIds, minutes: resources.minutes, free: resources.free, healthy: resources.healthy, title: resources.title, provider: resources.provider })
          .from(resources)
          .where(eq(resources.healthy, true));
        // The model call holds this transaction's connection for up to 20 s, as on the Gaps page. Fine for the beta;
        // later, call the model outside the transaction and re-check for a stored path after taking the lock.
        const plan = buildPath({ gaps: gaps.analysis.gaps, weeklyHours, resources: catalog });
        const titles = new Map(catalog.map((r) => [r.id, { title: r.title, provider: r.provider }]));
        const worded = (await mayWrite(tx, sessionId))
          ? await writePath(plan, role.title, titles, { gapAnalysisId: gaps.analysisId, weeklyHours: String(weeklyHours) }, deps.client)
          : { path: plan, calls: [] };
        const callIds = await recordAiCalls(worded.calls, tx);
        // Steps already done at another hours setting stay done here (FR-18).
        const doneRows = await tx
          .select({ skillId: pathSteps.skillId, doneAt: pathSteps.doneAt })
          .from(pathSteps)
          .innerJoin(paths, eq(paths.id, pathSteps.pathId))
          .where(and(eq(paths.gapAnalysisId, gaps.analysisId), isNotNull(pathSteps.doneAt)));
        const doneBySkill = new Map(doneRows.map((r) => [r.skillId, r.doneAt]));
        const [row] = await tx
          .insert(paths)
          .values({ gapAnalysisId: gaps.analysisId, weeklyHours, aiCallId: callIds[0] ?? null })
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
        pathId = row.id;
      }

      return { ok: true, path: await readPath(tx, pathId, weeklyHours, statusBySkill, gaps.analysis.gaps.length) } as const;
    });
  } catch (error) {
    // 55P03: another load of this session's Path page held the lock for too long.
    if ((error as { cause?: { code?: string } })?.cause?.code === "55P03") return { ok: false, reason: "busy" };
    throw error;
  }
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
 * FR-18: marks one of this session's path steps done or not done, while its resume is within its 24 hours. The same
 * skill's step in the paths for other hours settings changes with it, so progress survives a change of hours.
 */
export async function markStepDone(stepId: string, sessionId: string, done: boolean, db: Db = getDb()): Promise<boolean> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(stepId)) return false;
  const [step] = await db
    .select({ skillId: pathSteps.skillId, gapAnalysisId: paths.gapAnalysisId })
    .from(pathSteps)
    .innerJoin(paths, eq(paths.id, pathSteps.pathId))
    .innerJoin(gapAnalyses, eq(gapAnalyses.id, paths.gapAnalysisId))
    .innerJoin(profiles, eq(profiles.id, gapAnalyses.profileId))
    .innerJoin(resumes, eq(resumes.id, profiles.resumeId))
    .where(and(eq(pathSteps.id, stepId), eq(resumes.anonymousSessionId, sessionId), notExpired()));
  if (!step) return false;
  const sameAnalysis = db.select({ id: paths.id }).from(paths).where(eq(paths.gapAnalysisId, step.gapAnalysisId));
  await db
    .update(pathSteps)
    .set({ doneAt: done ? new Date() : null })
    .where(and(eq(pathSteps.skillId, step.skillId), inArray(pathSteps.pathId, sameAnalysis)));
  return true;
}
