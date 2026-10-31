import "server-only";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { withKeyLock, type Tx } from "@/db/lock";
import { gapAnalyses, profiles, resumes, roleProfiles } from "@/db/schema";
import { loadPrompt } from "@/lib/ai/prompts";
import { refIn, reserveCall, runReserved, usedToday } from "@/lib/ai/reserve";
import { ownerKey, ownsResume, uploadedBy, type Owner } from "@/lib/owner";
import { hasOwnAnalysis } from "@/lib/resume/sample";
import { getResumeForOwner } from "@/lib/resume/store";
import { singleFlight } from "@/lib/single-flight";
import { gapAnalysis, MAX_GAPS, type GapAnalysis, type RoleProfile } from "@/lib/schemas";
import { buildGapAnalysis, SHOWN_GAPS } from "./analysis";
import { currentAnalysis, type Db as CurrentDb } from "./current";
import { EXPLAIN_MODEL, explainGaps, type ExplainClient } from "./explain";
import { sampleExplanations } from "./sample-explanations";
import { MATCHER_VERSION, matchProfile, metSkillIds, type MatchResult } from "./match";

type Db = ReturnType<typeof getDb>;

export const GAP_LIMITS = {
  /** Model-written explanations per user or anonymous session per day; after that the page uses template sentences. */
  explainedPerOwnerPerDay: 15,
  /** Spend on explanations per UTC day, across all users, kept apart from the parsing budget (AI-6). */
  dailyBudgetUsd: () => Number(process.env.EXPLAIN_DAILY_BUDGET_USD ?? 2),
  /** How long a second load of the same owner's Gaps page waits for the first before answering "busy". */
  lockTimeoutMs: 30_000,
};

export type GapsForOwner =
  /** `sample`: the resume is the sample (T113), so what is made from it keeps checked-in or template words. */
  | { ok: true; analysisId: string; analysis: GapAnalysis; rating: number | null; sample: boolean }
  | { ok: false; reason: "not_found" | "not_confirmed" | "busy" };

/** What an explanation still running is assumed to cost when checking the budget. A typical one costs 2 to 4 cents. */
const IN_FLIGHT_EXPLAIN_USD = 0.1;

/**
 * Reserves an explanation when this owner is under its daily count and the explanation budget has room, and returns
 * the reserved call's id; null means template sentences. Runs under a lock for the purpose, held for a few
 * milliseconds, so parallel requests (any owner, any server) see each other's reservations before the model is called.
 */
async function reserveExplanation(tx: Tx, owner: Owner, profileId: string, roleSlug: string): Promise<string | null> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext('cm-ai:explain-gaps'))`);
  const ownProfiles = tx
    .select({ id: sql<string>`${profiles.id}::text` })
    .from(profiles)
    .innerJoin(resumes, eq(resumes.id, profiles.resumeId))
    .where(uploadedBy(owner));
  const used = await usedToday(tx, "explain-gaps", IN_FLIGHT_EXPLAIN_USD, refIn("profileId", ownProfiles));
  if (used.mine >= GAP_LIMITS.explainedPerOwnerPerDay || used.usd >= GAP_LIMITS.dailyBudgetUsd()) return null;
  return reserveCall(tx, {
    purpose: "explain-gaps",
    model: EXPLAIN_MODEL,
    promptVersion: loadPrompt("explain-gaps").id,
    inputRefs: { profileId, roleSlug },
  });
}

type StoredAnalysis = Omit<Extract<GapsForOwner, { ok: true }>, "sample">;

/**
 * The stored analysis for this profile and role, if one still says what today's matcher says. Prefers today's
 * matcher, else the newest older one, which carries over (with its words, rating and goals) when the rules agree.
 */
async function storedAnalysis(
  tx: Tx,
  profileId: string,
  roleRowId: string | null,
  role: RoleProfile,
  match: MatchResult,
): Promise<StoredAnalysis | null> {
  const [stored] = await tx
    .select({ id: gapAnalyses.id, result: gapAnalyses.result, rating: gapAnalyses.userRating, matcherVersion: gapAnalyses.matcherVersion })
    .from(gapAnalyses)
    .where(
      and(
        eq(gapAnalyses.profileId, profileId),
        roleRowId ? eq(gapAnalyses.roleProfileId, roleRowId) : sql`${gapAnalyses.result}->>'roleSlug' = ${role.slug}`,
      ),
    )
    .orderBy(sql`${gapAnalyses.matcherVersion} = ${MATCHER_VERSION} desc`, desc(gapAnalyses.createdAt))
    .limit(1);
  const storedResult = stored ? gapAnalysis.safeParse(stored.result) : null;
  const current = stored?.matcherVersion === MATCHER_VERSION;
  if (!stored || !storedResult?.success || !(current || sameReading(storedResult.data, match))) return null;
  const rebuilt = withEveryGap(storedResult.data, match);
  // The person's track (docs/plans/tracks-plan.md) and when they last picked the role stay with the analysis when an
  // old cut is rebuilt.
  const analysis = rebuilt === storedResult.data ? rebuilt : keepChoices(rebuilt, storedResult.data);
  // Kept under the same id, so the rating and the goals made from it carry over.
  if (analysis !== storedResult.data || !current) {
    await tx.update(gapAnalyses).set({ result: analysis, matcherVersion: MATCHER_VERSION }).where(eq(gapAnalyses.id, stored.id));
  }
  return { ok: true, analysisId: stored.id, analysis, rating: stored.rating };
}

/**
 * FR-11 to FR-13: the gap analysis of this owner's resume against a role. Reuses the stored analysis of the
 * latest confirmed profile for the same role version and matcher rules; otherwise matches, asks for explanations
 * (or uses templates past the limits), and stores the result. Anyone else's resume reads as not found.
 *
 * The model call runs between two short locked transactions, never inside one, so a slow answer holds no database
 * connection: the first reads and checks the limits, the second stores the result unless another load stored one
 * meanwhile. Concurrent loads of the same page on one server share one run; across servers a rare duplicate call is
 * logged and its result dropped.
 */
export async function getGapsForOwner(
  resumeId: string,
  owner: Owner,
  role: RoleProfile,
  deps: { db?: Db; client?: ExplainClient; now?: Date } = {},
): Promise<GapsForOwner> {
  return singleFlight(`cm-gaps:${ownerKey(owner)}:${resumeId}:${role.slug}`, () => analyse(resumeId, owner, role, deps));
}

async function analyse(
  resumeId: string,
  owner: Owner,
  role: RoleProfile,
  deps: { db?: Db; client?: ExplainClient; now?: Date },
): Promise<GapsForOwner> {
  const db = deps.db ?? getDb();
  const lockKey = `cm-gaps:${ownerKey(owner)}`;

  type Next = { done: GapsForOwner } | { profileId: string; roleRowId: string | null; match: MatchResult; reservedId: string | null; sample: boolean };
  const first = await withKeyLock(db, lockKey, GAP_LIMITS.lockTimeoutMs, async (tx): Promise<Next> => {
    const resume = await getResumeForOwner(resumeId, owner, tx);
    if (!resume) return { done: { ok: false, reason: "not_found" } };
    if (!resume.confirmed) return { done: { ok: false, reason: "not_confirmed" } };
    // Once the person's own resume has gaps, the sample is refused (T114), here too: its Gaps page would otherwise make
    // the made-up person current again. It reads as not found, like a resume that is gone.
    if (resume.sample && (await hasOwnAnalysis(owner, tx))) return { done: { ok: false, reason: "not_found" } };
    // The stored role row pins the role's version, so an edited role profile gets a fresh analysis.
    const [roleRow] = await tx
      .select({ id: roleProfiles.id })
      .from(roleProfiles)
      .where(eq(roleProfiles.slug, role.slug))
      .orderBy(desc(roleProfiles.version))
      .limit(1);
    const match = matchProfile(resume.profile, role, deps.now);
    const stored = await storedAnalysis(tx, resume.profileId, roleRow?.id ?? null, role, match);
    // Coming back to a role picked before makes it the destination again, as a role opened for the first time is
    // (docs/plans/change-destination-plan.md). Never for the sample, which is a made-up person's.
    if (stored && owner.userId !== undefined && !resume.sample) return { done: { ...(await pickAgain(tx, owner.userId, stored)), sample: false } };
    if (stored) return { done: { ...stored, sample: resume.sample } };
    // A role the person fully meets needs no words from the model, so it uses none of their explanations. Nor does the
    // sample resume (T113): it gets checked-in words or the template, never the model or the shared budget.
    const reservedId = match.gaps.length > 0 && !resume.sample ? await reserveExplanation(tx, owner, resume.profileId, role.slug) : null;
    return { profileId: resume.profileId, roleRowId: roleRow?.id ?? null, match, reservedId, sample: resume.sample };
  });
  if (first === "busy") return { ok: false, reason: "busy" };
  if ("done" in first) return first.done;
  const { profileId, roleRowId, match } = first;

  // Settled at once, outside any lock, so the cost counts even if storing fails below.
  const explained = first.reservedId
    ? await runReserved(db, first.reservedId, () =>
        explainGaps(match, role.title, { profileId, roleSlug: role.slug }, deps.client),
      )
    : { analysis: buildGapAnalysis(match, first.sample ? sampleExplanations(match) : null), calls: [], callId: null };
  const callId = explained.callId;

  const second = await withKeyLock(db, lockKey, GAP_LIMITS.lockTimeoutMs, async (tx) => {
    // Another request may have stored one meanwhile; then this call stays logged and its words are dropped.
    const stored = await storedAnalysis(tx, profileId, roleRowId, role, match);
    if (stored) return { ...stored, sample: first.sample };
    const [row] = await tx
      .insert(gapAnalyses)
      .values({ profileId, roleProfileId: roleRowId, result: explained.analysis, matcherVersion: MATCHER_VERSION, aiCallId: callId })
      .returning({ id: gapAnalyses.id });
    return { ok: true, analysisId: row.id, analysis: explained.analysis, rating: null, sample: first.sample } as const;
  });
  return second === "busy" ? { ok: false, reason: "busy" } : second;
}

/** What the person chose on an analysis (its track, when they last picked its role), carried onto a rebuilt one. */
export function keepChoices(rebuilt: GapAnalysis, stored: GapAnalysis): GapAnalysis {
  const out = { ...rebuilt };
  if (stored.trackId !== undefined) out.trackId = stored.trackId;
  if (stored.chosenAt !== undefined) out.chosenAt = stored.chosenAt;
  return out;
}

/**
 * When a stored analysis is not the person's current one, marks it picked now (`chosenAt`), so it is current again:
 * Today, the Map and Me follow the role the person came back to, and the role they leave becomes the Map's earlier
 * line. The time is the database's, the clock `created_at` comes from, so the two always compare. Writes nothing when
 * it is already current. Runs inside the Gaps lock.
 */
async function pickAgain(tx: Tx, userId: string, stored: StoredAnalysis): Promise<StoredAnalysis> {
  const current = await currentAnalysis(userId, tx as unknown as CurrentDb);
  if (!current || current.id === stored.analysisId) return stored;
  const [row] = await tx
    .update(gapAnalyses)
    .set({ result: sql`jsonb_set(${gapAnalyses.result}, '{chosenAt}', to_jsonb(to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')))` })
    .where(eq(gapAnalyses.id, stored.analysisId))
    .returning({ result: gapAnalyses.result });
  const parsed = row ? gapAnalysis.safeParse(row.result) : null;
  return parsed?.success ? { ...stored, analysis: parsed.data } : stored;
}

/**
 * True when an analysis an older matcher stored says what today's matcher says: the same gaps in the same order, state
 * and resume line (or the old top-five cut of them), the same met skills and the same nice-to-haves. Then it carries
 * over under today's version with its words, rating and goals; otherwise the person gets a fresh analysis.
 */
export function sameReading(stored: GapAnalysis, match: MatchResult): boolean {
  const gaps = match.gaps.slice(0, MAX_GAPS);
  const n = stored.gaps.length;
  if (n !== gaps.length && !(n === SHOWN_GAPS && gaps.length > SHOWN_GAPS)) return false;
  if (stored.gaps.some((g, i) => g.skillId !== gaps[i].skillId || g.status !== gaps[i].status || g.resumeQuote !== gaps[i].resumeQuote)) {
    return false;
  }
  const met = new Set(metSkillIds(match));
  if (stored.metSkillIds.length !== met.size || stored.metSkillIds.some((id) => !met.has(id))) return false;
  const nice = new Map(match.niceToHave.map((m) => [m.skillId, m.status]));
  return stored.niceToHave.length === nice.size && stored.niceToHave.every((m) => nice.get(m.skillId) === m.status);
}

/**
 * Analyses stored before every gap was kept hold only the top five. When the matcher now finds more and agrees on those
 * five, the rest are added with template words and the stored wording stays; no model call. Otherwise unchanged.
 */
export function withEveryGap(stored: GapAnalysis, match: MatchResult): GapAnalysis {
  // Only an exact old cut: five gaps, the same five in the same state, the same met skills. A match the date has moved
  // since (a skill now outdated) keeps the stored analysis as it was rather than mixing old words with new numbers.
  if (stored.gaps.length !== SHOWN_GAPS || match.gaps.length <= SHOWN_GAPS) return stored;
  if (stored.gaps.some((g, i) => g.skillId !== match.gaps[i].skillId || g.status !== match.gaps[i].status)) return stored;
  const met = new Set(metSkillIds(match));
  if (stored.metSkillIds.length !== met.size || stored.metSkillIds.some((id) => !met.has(id))) return stored;
  const bySkill = new Map(stored.gaps.map((g) => [g.skillId, g.explanation]));
  return buildGapAnalysis(match, { readiness: stored.readiness.explanation, bySkill });
}

/**
 * Saves the user's 1 to 5 answer to "Are these gaps right?", the beta's accuracy measure. Only for the owner's own
 * analyses (an anonymous one only while its resume is within its 24 hours).
 */
export async function rateAnalysis(analysisId: string, owner: Owner, rating: number, db: Db = getDb()): Promise<boolean> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(analysisId) || !Number.isInteger(rating) || rating < 1 || rating > 5)
    return false;
  const own = db.select({ id: profiles.id }).from(profiles).innerJoin(resumes, eq(resumes.id, profiles.resumeId)).where(ownsResume(owner));
  const updated = await db
    .update(gapAnalyses)
    .set({ userRating: rating })
    .where(and(eq(gapAnalyses.id, analysisId), inArray(gapAnalyses.profileId, own)))
    .returning({ id: gapAnalyses.id });
  return updated.length === 1;
}
