import "server-only";
import { and, count, desc, eq, gte, inArray, isNotNull, sql, sum } from "drizzle-orm";
import { getDb } from "@/db";
import { aiCalls, gapAnalyses, profiles, resumes, roleProfiles } from "@/db/schema";
import { recordAiCalls } from "@/lib/ai/log";
import { LIMITS as PARSE_LIMITS } from "@/lib/resume/ingest";
import { getResumeForSession } from "@/lib/resume/store";
import type { GapAnalysis, RoleProfile } from "@/lib/schemas";
import { buildGapAnalysis } from "./analysis";
import { explainGaps, type ExplainClient } from "./explain";
import { MATCHER_VERSION, matchProfile } from "./match";

type Db = ReturnType<typeof getDb>;

export const GAP_LIMITS = {
  /** Model-written explanations per anonymous session per day; after that the page uses template sentences. */
  explainedPerSessionPerDay: 15,
};

export type GapsForSession =
  | { ok: true; analysisId: string; analysis: GapAnalysis; rating: number | null }
  | { ok: false; reason: "not_found" | "not_confirmed" };

const startOfUtcDay = () => new Date(new Date().toISOString().slice(0, 10) + "T00:00:00Z");

/** True when this session may spend on another explanation: under its daily count and under the shared daily budget (AI-6). */
async function mayExplain(db: Db, sessionId: string): Promise<boolean> {
  const [[mine], [spent]] = await Promise.all([
    db
      .select({ n: count() })
      .from(gapAnalyses)
      .innerJoin(profiles, eq(profiles.id, gapAnalyses.profileId))
      .innerJoin(resumes, eq(resumes.id, profiles.resumeId))
      .where(and(eq(resumes.anonymousSessionId, sessionId), isNotNull(gapAnalyses.aiCallId), gte(gapAnalyses.createdAt, startOfUtcDay()))),
    db.select({ usd: sum(aiCalls.costUsd) }).from(aiCalls).where(gte(aiCalls.createdAt, startOfUtcDay())),
  ]);
  return mine.n < GAP_LIMITS.explainedPerSessionPerDay && Number(spent.usd ?? 0) < PARSE_LIMITS.dailyBudgetUsd();
}

/**
 * FR-11 to FR-13: the gap analysis of this session's resume against a role. Reuses the stored analysis of the
 * latest confirmed profile when the matcher rules are unchanged; otherwise matches, asks for explanations (or
 * uses templates past the limits), and stores the result with its call log. Anyone else's resume reads as not found.
 */
export async function getGapsForSession(
  resumeId: string,
  sessionId: string,
  role: RoleProfile,
  deps: { db?: Db; client?: ExplainClient; now?: Date } = {},
): Promise<GapsForSession> {
  const db = deps.db ?? getDb();
  const resume = await getResumeForSession(resumeId, sessionId, db);
  if (!resume) return { ok: false, reason: "not_found" };
  if (!resume.confirmed) return { ok: false, reason: "not_confirmed" };

  const [stored] = await db
    .select({ id: gapAnalyses.id, result: gapAnalyses.result, rating: gapAnalyses.userRating })
    .from(gapAnalyses)
    .where(
      and(
        eq(gapAnalyses.profileId, resume.profileId),
        eq(gapAnalyses.matcherVersion, MATCHER_VERSION),
        sql`${gapAnalyses.result}->>'roleSlug' = ${role.slug}`,
      ),
    )
    .orderBy(desc(gapAnalyses.createdAt))
    .limit(1);
  if (stored) return { ok: true, analysisId: stored.id, analysis: stored.result, rating: stored.rating };

  const match = matchProfile(resume.profile, role, deps.now);
  const explained = (await mayExplain(db, sessionId))
    ? await explainGaps(match, role.title, { profileId: resume.profileId, roleSlug: role.slug }, deps.client)
    : { analysis: buildGapAnalysis(match, null), calls: [] };
  const callIds = await recordAiCalls(explained.calls, db);
  const [roleRow] = await db
    .select({ id: roleProfiles.id })
    .from(roleProfiles)
    .where(eq(roleProfiles.slug, role.slug))
    .orderBy(desc(roleProfiles.version))
    .limit(1);
  const [row] = await db
    .insert(gapAnalyses)
    .values({
      profileId: resume.profileId,
      roleProfileId: roleRow?.id ?? null,
      result: explained.analysis,
      matcherVersion: MATCHER_VERSION,
      aiCallId: callIds[0] ?? null,
    })
    .returning({ id: gapAnalyses.id });
  return { ok: true, analysisId: row.id, analysis: explained.analysis, rating: null };
}

/** Saves the user's 1 to 5 answer to "Are these gaps right?", the beta's accuracy measure. Only for this session's own analyses. */
export async function rateAnalysis(analysisId: string, sessionId: string, rating: number, db: Db = getDb()): Promise<boolean> {
  if (!/^[0-9a-f-]{36}$/i.test(analysisId) || !Number.isInteger(rating) || rating < 1 || rating > 5) return false;
  const own = db
    .select({ id: profiles.id })
    .from(profiles)
    .innerJoin(resumes, eq(resumes.id, profiles.resumeId))
    .where(eq(resumes.anonymousSessionId, sessionId));
  const updated = await db
    .update(gapAnalyses)
    .set({ userRating: rating })
    .where(and(eq(gapAnalyses.id, analysisId), inArray(gapAnalyses.profileId, own)))
    .returning({ id: gapAnalyses.id });
  return updated.length === 1;
}
