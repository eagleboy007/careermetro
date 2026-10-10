import "server-only";
import {
  and,
  count,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  sql,
  sum,
} from "drizzle-orm";
import { getDb } from "@/db";
import {
  aiCalls,
  gapAnalyses,
  profiles,
  resumes,
  roleProfiles,
} from "@/db/schema";
import { recordAiCalls } from "@/lib/ai/log";
import { ownerKey, ownsResume, uploadedBy, type Owner } from "@/lib/owner";
import { getResumeForOwner } from "@/lib/resume/store";
import {
  gapAnalysis,
  MAX_GAPS,
  type GapAnalysis,
  type RoleProfile,
} from "@/lib/schemas";
import { buildGapAnalysis, SHOWN_GAPS } from "./analysis";
import { explainGaps, type ExplainClient } from "./explain";
import {
  MATCHER_VERSION,
  matchProfile,
  metSkillIds,
  type MatchResult,
} from "./match";

type Db = ReturnType<typeof getDb>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export const GAP_LIMITS = {
  /** Model-written explanations per user or anonymous session per day; after that the page uses template sentences. */
  explainedPerOwnerPerDay: 15,
  /** Spend on explanations per UTC day, across all users, kept apart from the parsing budget (AI-6). */
  dailyBudgetUsd: () => Number(process.env.EXPLAIN_DAILY_BUDGET_USD ?? 2),
  /** How long a second load of the same owner's Gaps page waits for the first before answering "busy". */
  lockTimeoutMs: 30_000,
};

export type GapsForOwner =
  | {
      ok: true;
      analysisId: string;
      analysis: GapAnalysis;
      rating: number | null;
    }
  | { ok: false; reason: "not_found" | "not_confirmed" | "busy" };

const startOfUtcDay = () =>
  new Date(new Date().toISOString().slice(0, 10) + "T00:00:00Z");

/** True when this owner may spend on another explanation: under its daily count and under the explanation budget. */
async function mayExplain(tx: Tx, owner: Owner): Promise<boolean> {
  const [[mine], [spent]] = await Promise.all([
    tx
      .select({ n: count() })
      .from(gapAnalyses)
      .innerJoin(profiles, eq(profiles.id, gapAnalyses.profileId))
      .innerJoin(resumes, eq(resumes.id, profiles.resumeId))
      .where(
        and(
          uploadedBy(owner),
          isNotNull(gapAnalyses.aiCallId),
          gte(gapAnalyses.createdAt, startOfUtcDay()),
        ),
      ),
    tx
      .select({ usd: sum(aiCalls.costUsd) })
      .from(aiCalls)
      .where(
        and(
          eq(aiCalls.purpose, "explain-gaps"),
          gte(aiCalls.createdAt, startOfUtcDay()),
        ),
      ),
  ]);
  return (
    mine.n < GAP_LIMITS.explainedPerOwnerPerDay &&
    Number(spent.usd ?? 0) < GAP_LIMITS.dailyBudgetUsd()
  );
}

/**
 * FR-11 to FR-13: the gap analysis of this owner's resume against a role. Reuses the stored analysis of the
 * latest confirmed profile for the same role version and matcher rules; otherwise matches, asks for explanations
 * (or uses templates past the limits), and stores the result. One owner's analyses run one at a time under a
 * lock, so parallel loads can't each call the model or slip past the daily count. Anyone else's resume reads as not found.
 */
export async function getGapsForOwner(
  resumeId: string,
  owner: Owner,
  role: RoleProfile,
  deps: { db?: Db; client?: ExplainClient; now?: Date } = {},
): Promise<GapsForOwner> {
  const db = deps.db ?? getDb();
  try {
    return await db.transaction(async (tx) => {
      await tx.execute(
        sql.raw(
          `set local lock_timeout = ${Math.trunc(GAP_LIMITS.lockTimeoutMs)}`,
        ),
      );
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${`cm-gaps:${ownerKey(owner)}`}))`,
      );

      const resume = await getResumeForOwner(resumeId, owner, tx);
      if (!resume) return { ok: false, reason: "not_found" } as const;
      if (!resume.confirmed)
        return { ok: false, reason: "not_confirmed" } as const;

      // The stored role row pins the role's version, so an edited role profile gets a fresh analysis.
      const [roleRow] = await tx
        .select({ id: roleProfiles.id })
        .from(roleProfiles)
        .where(eq(roleProfiles.slug, role.slug))
        .orderBy(desc(roleProfiles.version))
        .limit(1);
      // Today's matcher first; else the newest older one, which carries over when today's rules agree with it.
      const [stored] = await tx
        .select({
          id: gapAnalyses.id,
          result: gapAnalyses.result,
          rating: gapAnalyses.userRating,
          matcherVersion: gapAnalyses.matcherVersion,
        })
        .from(gapAnalyses)
        .where(
          and(
            eq(gapAnalyses.profileId, resume.profileId),
            roleRow
              ? eq(gapAnalyses.roleProfileId, roleRow.id)
              : sql`${gapAnalyses.result}->>'roleSlug' = ${role.slug}`,
          ),
        )
        .orderBy(
          sql`${gapAnalyses.matcherVersion} = ${MATCHER_VERSION} desc`,
          desc(gapAnalyses.createdAt),
        )
        .limit(1);
      const storedResult = stored ? gapAnalysis.safeParse(stored.result) : null;
      const match = matchProfile(resume.profile, role, deps.now);
      const current = stored?.matcherVersion === MATCHER_VERSION;
      if (
        stored &&
        storedResult?.success &&
        (current || sameReading(storedResult.data, match))
      ) {
        const analysis = withEveryGap(storedResult.data, match);
        // Kept under the same id, so the rating and the goals made from it carry over.
        if (analysis !== storedResult.data || !current) {
          await tx
            .update(gapAnalyses)
            .set({ result: analysis, matcherVersion: MATCHER_VERSION })
            .where(eq(gapAnalyses.id, stored.id));
        }
        return {
          ok: true,
          analysisId: stored.id,
          analysis,
          rating: stored.rating,
        } as const;
      }

      const explained = (await mayExplain(tx, owner))
        ? await explainGaps(
            match,
            role.title,
            { profileId: resume.profileId, roleSlug: role.slug },
            deps.client,
          )
        : { analysis: buildGapAnalysis(match, null), calls: [] };
      // Inside the transaction: a second connection here could wait forever on a pool the lock holders have filled.
      const callIds = await recordAiCalls(explained.calls, tx);
      const [row] = await tx
        .insert(gapAnalyses)
        .values({
          profileId: resume.profileId,
          roleProfileId: roleRow?.id ?? null,
          result: explained.analysis,
          matcherVersion: MATCHER_VERSION,
          aiCallId: callIds[0] ?? null,
        })
        .returning({ id: gapAnalyses.id });
      return {
        ok: true,
        analysisId: row.id,
        analysis: explained.analysis,
        rating: null,
      } as const;
    });
  } catch (error) {
    // 55P03: another load of this owner's Gaps page held the lock for too long.
    if ((error as { cause?: { code?: string } })?.cause?.code === "55P03")
      return { ok: false, reason: "busy" };
    throw error;
  }
}

/**
 * True when an analysis an older matcher stored says what today's matcher says: the same gaps in the same order, state
 * and resume line (or the old top-five cut of them), the same met skills and the same nice-to-haves. Then it carries
 * over under today's version with its words, rating and goals; otherwise the person gets a fresh analysis.
 */
export function sameReading(stored: GapAnalysis, match: MatchResult): boolean {
  const gaps = match.gaps.slice(0, MAX_GAPS);
  const n = stored.gaps.length;
  if (n !== gaps.length && !(n === SHOWN_GAPS && gaps.length > SHOWN_GAPS))
    return false;
  if (
    stored.gaps.some(
      (g, i) =>
        g.skillId !== gaps[i].skillId ||
        g.status !== gaps[i].status ||
        g.resumeQuote !== gaps[i].resumeQuote,
    )
  ) {
    return false;
  }
  const met = new Set(metSkillIds(match));
  if (
    stored.metSkillIds.length !== met.size ||
    stored.metSkillIds.some((id) => !met.has(id))
  )
    return false;
  const nice = new Map(match.niceToHave.map((m) => [m.skillId, m.status]));
  return (
    stored.niceToHave.length === nice.size &&
    stored.niceToHave.every((m) => nice.get(m.skillId) === m.status)
  );
}

/**
 * Analyses stored before every gap was kept hold only the top five. When the matcher now finds more and agrees on those
 * five, the rest are added with template words and the stored wording stays; no model call. Otherwise unchanged.
 */
export function withEveryGap(
  stored: GapAnalysis,
  match: MatchResult,
): GapAnalysis {
  // Only an exact old cut: five gaps, the same five in the same state, the same met skills. A match the date has moved
  // since (a skill now outdated) keeps the stored analysis as it was rather than mixing old words with new numbers.
  if (stored.gaps.length !== SHOWN_GAPS || match.gaps.length <= SHOWN_GAPS)
    return stored;
  if (
    stored.gaps.some(
      (g, i) =>
        g.skillId !== match.gaps[i].skillId ||
        g.status !== match.gaps[i].status,
    )
  )
    return stored;
  const met = new Set(metSkillIds(match));
  if (
    stored.metSkillIds.length !== met.size ||
    stored.metSkillIds.some((id) => !met.has(id))
  )
    return stored;
  const bySkill = new Map(stored.gaps.map((g) => [g.skillId, g.explanation]));
  return buildGapAnalysis(match, {
    readiness: stored.readiness.explanation,
    bySkill,
  });
}

/**
 * Saves the user's 1 to 5 answer to "Are these gaps right?", the beta's accuracy measure. Only for the owner's own
 * analyses (an anonymous one only while its resume is within its 24 hours).
 */
export async function rateAnalysis(
  analysisId: string,
  owner: Owner,
  rating: number,
  db: Db = getDb(),
): Promise<boolean> {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      analysisId,
    ) ||
    !Number.isInteger(rating) ||
    rating < 1 ||
    rating > 5
  )
    return false;
  const own = db
    .select({ id: profiles.id })
    .from(profiles)
    .innerJoin(resumes, eq(resumes.id, profiles.resumeId))
    .where(ownsResume(owner));
  const updated = await db
    .update(gapAnalyses)
    .set({ userRating: rating })
    .where(
      and(eq(gapAnalyses.id, analysisId), inArray(gapAnalyses.profileId, own)),
    )
    .returning({ id: gapAnalyses.id });
  return updated.length === 1;
}
