import "server-only";
import { createHmac } from "node:crypto";
import { and, desc, eq, gte, inArray, isNull, or, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { withKeyLock, type Tx } from "@/db/lock";
import { gapProofs, jobChecks, resumes, userGoals } from "@/db/schema";
import { roleProfiles } from "@/content";
import { loadPrompt } from "@/lib/ai/prompts";
import { refIn, reserveCall, runReserved, usedToday } from "@/lib/ai/reserve";
import { buildGapAnalysis } from "@/lib/gaps/analysis";
import { matchProfile } from "@/lib/gaps/match";
import { indiaToday, lockPerson } from "@/lib/goals/store";
import { jobTextHashKey } from "@/lib/hash-keys";
import { ownerKey, ownsResume, uploadedBy, type Owner } from "@/lib/owner";
import { hasOwnAnalysis } from "@/lib/resume/sample";
import { getResumeForOwner } from "@/lib/resume/store";
import { LIMITS, takeShared } from "@/lib/shared-limit";
import { MAX_CHOICE_GOALS, MAX_GAPS, type GapAnalysis, type JobCheckRequest } from "@/lib/schemas";
import { jobCheckView, type JobCheckView, type StoredJobCheck } from "./groups";
import { PARSE_JD_MODEL, parseJobPosting, type ParseJdClient } from "./parse";
import { standInView, type StandInView } from "./stand-in";

type Db = ReturnType<typeof getDb>;

export const JOB_CHECK_LIMITS = {
  /** New job checks per user or anonymous session per day. A posting checked before doesn't count again. */
  perOwnerPerDay: 5,
  /** Spend on reading postings per UTC day, across all users. It also counts toward the parsing budget (AI-6). */
  // A value that isn't a number falls back to the default, so a typo can never switch the budget off.
  dailyBudgetUsd: () => {
    const usd = Number(process.env.JOB_CHECK_DAILY_BUDGET_USD ?? 2);
    return Number.isFinite(usd) && usd >= 0 ? usd : 2;
  },
  /** How long a second check by the same owner waits for the first before answering "busy". */
  lockTimeoutMs: 30_000,
  /** Saved checks shown for one resume and role, newest first. */
  shown: 20,
};

/** What a posting still being read is assumed to cost when checking the budget. A typical one costs 2 to 4 cents. */
const IN_FLIGHT_JD_USD = 0.1;

/**
 * Keyed hash of a posting's text, so the same posting sent again for the same resume and role reuses its check.
 * Spacing doesn't matter. The text itself is never stored.
 */
export function jobTextHash(text: string, env: Record<string, string | undefined> = process.env): string {
  return createHmac("sha256", jobTextHashKey(env)).update(text.replace(/\s+/g, " ").trim()).digest("base64url");
}

export type CreateJobCheckResult =
  | { ok: true; id: string; reused: boolean }
  | {
      ok: false;
      reason: "not_found" | "not_confirmed" | "limit" | "sample_limit" | "budget" | "busy" | "unavailable" | "refused" | "malformed" | "no_skills";
    };

/**
 * Reserves the model call for a job check when this owner is under its daily count and the budget has room, and
 * returns the reserved call's id, or why not. Under its own lock, held for a few milliseconds, so parallel requests
 * (any owner, any server) see each other's reservations before the model is called.
 */
/** The ids an AI call is logged with: the resume, and the role unless the check stands in for one we don't have. */
const callRefs = (resumeId: string, roleSlug: string | null): Record<string, string> => (roleSlug ? { resumeId, roleSlug } : { resumeId });

async function reserveJobCheck(tx: Tx, owner: Owner, resumeId: string, roleSlug: string | null): Promise<string | "limit" | "budget"> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext('cm-ai:parse-jd'))`);
  const ownResumes = tx.select({ id: sql<string>`${resumes.id}::text` }).from(resumes).where(uploadedBy(owner));
  const used = await usedToday(tx, "parse-jd", IN_FLIGHT_JD_USD, refIn("resumeId", ownResumes));
  if (used.mine >= JOB_CHECK_LIMITS.perOwnerPerDay) return "limit";
  if (used.usd >= JOB_CHECK_LIMITS.dailyBudgetUsd()) return "budget";
  return reserveCall(tx, { purpose: "parse-jd", model: PARSE_JD_MODEL, promptVersion: loadPrompt("parse-jd").id, inputRefs: callRefs(resumeId, roleSlug) });
}

async function existingCheck(tx: Tx, resumeId: string, roleSlug: string | null, textHash: string): Promise<string | null> {
  const [row] = await tx
    .select({ id: jobChecks.id })
    .from(jobChecks)
    .where(and(eq(jobChecks.resumeId, resumeId), roleSlug ? eq(jobChecks.roleSlug, roleSlug) : isNull(jobChecks.roleSlug), eq(jobChecks.textHash, textHash)))
    .limit(1);
  return row?.id ?? null;
}

/**
 * "Check against a job" (role-suggest-plan.md part B): reads the skills a pasted posting names and saves them for this
 * owner's resume and target role. Only the skill ids, unknown names and a keyed hash of the text are saved; never the
 * text. It never touches goals, analyses, paths or the ride. A null role saves a check that stands in as the target for
 * a role our library doesn't have yet; it never makes goals either. The same text for the same resume and role returns the
 * saved check without a model call. Over the daily limit, or when the model fails, nothing is saved.
 *
 * The model call runs between two short locked transactions, never inside one, like the Gaps page's explanations.
 */
export async function createJobCheck(
  input: JobCheckRequest,
  owner: Owner,
  deps: { db?: Db; client?: ParseJdClient; env?: Record<string, string | undefined>; clientHash?: string } = {},
): Promise<CreateJobCheckResult> {
  const db = deps.db ?? getDb();
  const { resumeId, roleSlug, company, title, text } = input;
  const textHash = jobTextHash(text, deps.env);
  const lockKey = `cm-jobs:${ownerKey(owner)}`;

  const first = await withKeyLock(db, lockKey, JOB_CHECK_LIMITS.lockTimeoutMs, async (tx): Promise<CreateJobCheckResult | { reservedId: string }> => {
    const resume = await getResumeForOwner(resumeId, owner, tx);
    if (!resume) return { ok: false, reason: "not_found" };
    if (!resume.confirmed) return { ok: false, reason: "not_confirmed" };
    // Once the person's own resume has gaps, the sample is refused (T114), here too (T117), as analyse() in
    // src/lib/gaps/store.ts does: before any reservation or model call, and as not found, like a resume that is gone.
    if (resume.sample && (await hasOwnAnalysis(owner, tx))) return { ok: false, reason: "not_found" };
    const existing = await existingCheck(tx, resumeId, roleSlug, textHash);
    if (existing) return { ok: true, id: existing, reused: true };
    // A new check of the sample resume also counts against its address (T113): every new anonymous session brings a
    // fresh per-owner count, so without it a script could spend the parse budget through the sample. Each new try is
    // counted, like the sample's own limits.
    if (resume.sample && !(await takeShared(LIMITS.sampleJobChecksPerIp, deps.clientHash ?? "unknown", { db: tx }))) {
      return { ok: false, reason: "sample_limit" };
    }
    const reserved = await reserveJobCheck(tx, owner, resumeId, roleSlug);
    return reserved === "limit" || reserved === "budget" ? { ok: false, reason: reserved } : { reservedId: reserved };
  });
  if (first === "busy") return { ok: false, reason: "busy" };
  if (!("reservedId" in first)) return first;

  // Settled at once, outside any lock, so the cost counts even if saving fails below.
  const parsed = await runReserved(db, first.reservedId, () => parseJobPosting(text, callRefs(resumeId, roleSlug), deps.client));
  if (!parsed.ok) return { ok: false, reason: parsed.reason };
  if (parsed.requiredSkillIds.length + parsed.niceSkillIds.length + parsed.unknownSkills.length === 0) return { ok: false, reason: "no_skills" };

  const second = await withKeyLock(db, lockKey, JOB_CHECK_LIMITS.lockTimeoutMs, async (tx): Promise<CreateJobCheckResult> => {
    // The resume may have been deleted meanwhile, or the same text saved by a second tab.
    if (!(await getResumeForOwner(resumeId, owner, tx))) return { ok: false, reason: "not_found" };
    const existing = await existingCheck(tx, resumeId, roleSlug, textHash);
    if (existing) return { ok: true, id: existing, reused: true };
    const [row] = await tx
      .insert(jobChecks)
      .values({
        resumeId,
        roleSlug,
        company,
        title,
        requiredSkillIds: parsed.requiredSkillIds,
        niceSkillIds: parsed.niceSkillIds,
        unknownSkills: parsed.unknownSkills,
        textHash,
        aiCallId: parsed.callId,
      })
      .returning({ id: jobChecks.id });
    return { ok: true, id: row.id, reused: false };
  });
  return second === "busy" ? { ok: false, reason: "busy" } : second;
}

/** This owner's saved checks of one resume against one role, newest first. Anyone else's resume has none. */
export async function listJobChecks(resumeId: string, owner: Owner, roleSlug: string, db: Pick<Db, "select"> = getDb()): Promise<StoredJobCheck[]> {
  return db
    .select({
      id: jobChecks.id,
      company: jobChecks.company,
      title: jobChecks.title,
      requiredSkillIds: jobChecks.requiredSkillIds,
      niceSkillIds: jobChecks.niceSkillIds,
      unknownSkills: jobChecks.unknownSkills,
      createdAt: jobChecks.createdAt,
    })
    .from(jobChecks)
    .innerJoin(resumes, eq(resumes.id, jobChecks.resumeId))
    .where(and(eq(jobChecks.resumeId, resumeId), eq(jobChecks.roleSlug, roleSlug), ownsResume(owner)))
    .orderBy(desc(jobChecks.createdAt), desc(jobChecks.id))
    .limit(JOB_CHECK_LIMITS.shown);
}

/** This owner's saved checks that stand in for a role we don't have, newest first. Anyone else's resume has none. */
export async function listStandInChecks(
  resumeId: string,
  owner: Owner,
  db: Pick<Db, "select"> = getDb(),
): Promise<{ id: string; company: string; title: string; createdAt: Date }[]> {
  return db
    .select({ id: jobChecks.id, company: jobChecks.company, title: jobChecks.title, createdAt: jobChecks.createdAt })
    .from(jobChecks)
    .innerJoin(resumes, eq(resumes.id, jobChecks.resumeId))
    .where(and(eq(jobChecks.resumeId, resumeId), isNull(jobChecks.roleSlug), ownsResume(owner)))
    .orderBy(desc(jobChecks.createdAt), desc(jobChecks.id))
    .limit(JOB_CHECK_LIMITS.shown);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * One saved check standing in for a role we don't have, as its Gaps page shows it, against the confirmed profile. Null
 * when it isn't this owner's, isn't on this resume, belongs to a library role, or the resume isn't confirmed. Read-only.
 */
export async function standInForPage(
  resumeId: string,
  checkId: string,
  owner: Owner,
  { db = getDb(), now = new Date() }: { db?: Db; now?: Date } = {},
): Promise<StandInView | null> {
  if (!UUID.test(checkId)) return null;
  const resume = await getResumeForOwner(resumeId, owner, db);
  if (!resume?.confirmed) return null;
  const [check] = await db
    .select({
      id: jobChecks.id,
      company: jobChecks.company,
      title: jobChecks.title,
      requiredSkillIds: jobChecks.requiredSkillIds,
      niceSkillIds: jobChecks.niceSkillIds,
      unknownSkills: jobChecks.unknownSkills,
      createdAt: jobChecks.createdAt,
    })
    .from(jobChecks)
    .innerJoin(resumes, eq(resumes.id, jobChecks.resumeId))
    .where(and(eq(jobChecks.id, checkId), eq(jobChecks.resumeId, resumeId), isNull(jobChecks.roleSlug), ownsResume(owner)));
  if (!check) return null;
  return standInView(check, resume.profile, await provedSkills(owner, db), { now });
}

/**
 * Skills with current accepted proof, for a signed-in account only: proof belongs to the account, and an anonymous
 * resume has none.
 */
async function provedSkills(owner: Owner, db: Pick<Db, "selectDistinct">, today = indiaToday()): Promise<Set<string>> {
  if (owner.userId === undefined) return new Set();
  const rows = await db
    .selectDistinct({ skillId: gapProofs.skillId })
    .from(gapProofs)
    .where(and(eq(gapProofs.userId, owner.userId), eq(gapProofs.status, "accepted"), or(isNull(gapProofs.expiresOn), gte(gapProofs.expiresOn, today))));
  return new Set(rows.map((r) => r.skillId));
}

/**
 * The saved checks for the Gaps page, each sorted into its groups against the confirmed profile and the target role's
 * stored analysis. Read-only.
 */
export async function jobChecksForPage(
  resumeId: string,
  owner: Owner,
  roleSlug: string,
  target: Pick<GapAnalysis, "gaps">,
  { db = getDb(), now = new Date() }: { db?: Db; now?: Date } = {},
): Promise<JobCheckView[]> {
  const resume = await getResumeForOwner(resumeId, owner, db);
  if (!resume?.confirmed) return [];
  const [checks, proved] = await Promise.all([listJobChecks(resumeId, owner, roleSlug, db), provedSkills(owner, db)]);
  return checks.map((c) => jobCheckView(c, resume.profile, target, proved, { now }));
}

/* "Add as my goal", "Plan for this job" and "Remove this check" (role-suggest-plan.md part B, part 2) ------------- */

/** One saved check with the resume and role it was made for, sorted into its groups. */
export type OwnJobCheck = { resumeId: string; roleSlug: string; view: JobCheckView };

/**
 * One of this owner's saved checks, sorted into its groups by the same code as the Gaps page. The target role's gaps
 * come from the deterministic matcher over the resume's confirmed profile, which is what the page's stored analysis
 * says. Null for anyone else's check, an unknown id, a role no longer in the library or an unconfirmed resume.
 * Read-only.
 */
export async function ownJobCheck(checkId: string, owner: Owner, { db = getDb(), now = new Date() }: { db?: Db; now?: Date } = {}): Promise<OwnJobCheck | null> {
  if (!UUID.test(checkId)) return null;
  const [row] = await db
    .select({
      id: jobChecks.id,
      resumeId: jobChecks.resumeId,
      roleSlug: jobChecks.roleSlug,
      company: jobChecks.company,
      title: jobChecks.title,
      requiredSkillIds: jobChecks.requiredSkillIds,
      niceSkillIds: jobChecks.niceSkillIds,
      unknownSkills: jobChecks.unknownSkills,
      createdAt: jobChecks.createdAt,
    })
    .from(jobChecks)
    .innerJoin(resumes, eq(resumes.id, jobChecks.resumeId))
    .where(and(eq(jobChecks.id, checkId), ownsResume(owner)))
    .limit(1);
  const role = row ? roleProfiles.find((r) => r.slug === row.roleSlug) : undefined;
  if (!row || !role) return null;
  const resume = await getResumeForOwner(row.resumeId, owner, db);
  if (!resume?.confirmed) return null;
  const match = matchProfile(resume.profile, role, now);
  const target = buildGapAnalysis({ ...match, gaps: match.gaps.slice(0, MAX_GAPS) }, null);
  const proved = await provedSkills(owner, db);
  // A check standing in for a role we don't have has no library role, so it returned null above and makes no goals.
  return { resumeId: row.resumeId, roleSlug: role.slug, view: jobCheckView(row, resume.profile, target, proved, { now }) };
}

export type AddJobCheckGoalResult = { ok: true; goalId: string } | { ok: false; reason: "not_found" | "not_this_job" | "already" | "limit" };

/**
 * "Add as my goal": makes one skill of a saved check's "Only for this job" group a "Your choice" goal of the account,
 * tagged with the check, after the person's last goal. The group is worked out again here, so only a skill that
 * really is "Only for this job" can be added. A "Your choice" goal never changes the match, readiness, gaps or the
 * analysis, and goal syncing leaves it alone (src/lib/goals/sync.ts).
 */
export async function addJobCheckGoal(
  checkId: string,
  skillId: string,
  userId: string,
  { db = getDb(), now = new Date() }: { db?: Db; now?: Date } = {},
): Promise<AddJobCheckGoalResult> {
  const own = await ownJobCheck(checkId, { userId }, { db, now });
  if (!own) return { ok: false, reason: "not_found" };
  if (!own.view.onlyThisJob.some((s) => s.skillId === skillId)) return { ok: false, reason: "not_this_job" };
  return db.transaction(async (tx): Promise<AddJobCheckGoalResult> => {
    await lockPerson(tx, userId);
    // The check may have been removed since it was read; locking its row keeps it until this goal points at it.
    const [check] = await tx.select({ id: jobChecks.id }).from(jobChecks).where(eq(jobChecks.id, checkId)).for("share");
    if (!check) return { ok: false, reason: "not_found" };
    const [already] = await tx
      .select({ id: userGoals.id, source: userGoals.source, status: userGoals.status })
      .from(userGoals)
      .where(and(eq(userGoals.userId, userId), eq(userGoals.skillId, skillId)))
      .limit(1);
    // A "Your choice" goal the person removed (skipped) can be added again; any other goal for the skill stands.
    if (already && !(already.source === "user" && already.status === "skipped")) return { ok: false, reason: "already" };
    const [{ chosen, last }] = await tx
      .select({
        chosen: sql<number>`count(*) filter (where ${userGoals.source} = 'user' and ${userGoals.status} <> 'skipped')::int`,
        last: sql<number>`coalesce(max(${userGoals.position}), 0)::int`,
      })
      .from(userGoals)
      .where(eq(userGoals.userId, userId));
    if (chosen >= MAX_CHOICE_GOALS) return { ok: false, reason: "limit" };
    if (already) {
      await tx
        .update(userGoals)
        .set({ status: "active", skippedAt: null, metAt: null, position: last + 1, jobCheckId: checkId })
        .where(eq(userGoals.id, already.id));
      return { ok: true, goalId: already.id };
    }
    const [row] = await tx
      .insert(userGoals)
      .values({ userId, skillId, source: "user", status: "active", position: last + 1, jobCheckId: checkId })
      .onConflictDoNothing()
      .returning({ id: userGoals.id });
    return row ? { ok: true, goalId: row.id } : { ok: false, reason: "already" };
  });
}

/**
 * The account's goals as a job check shows them: `skills` on its goals ("On your goals"), and `chosen`, its "Your
 * choice" goals by skill, which can be removed from there. A removed (skipped) "Your choice" goal is in neither.
 * Plain data, so a client component can take it.
 */
export async function goalSkillsOf(userId: string, db: Pick<Db, "select"> = getDb()): Promise<{ skills: string[]; chosen: Record<string, string> }> {
  const rows = await db
    .select({ id: userGoals.id, skillId: userGoals.skillId, source: userGoals.source, status: userGoals.status })
    .from(userGoals)
    .where(eq(userGoals.userId, userId))
    // Line order, so callers (and tests) see the same order every time; without it Postgres returns any order.
    .orderBy(userGoals.position, userGoals.id);
  const open = rows.filter((r) => !(r.source === "user" && r.status === "skipped"));
  return {
    skills: open.map((r) => r.skillId),
    chosen: Object.fromEntries(open.filter((r) => r.source === "user").map((r) => [r.skillId, r.id])),
  };
}

/**
 * "Remove this check": deletes one of this owner's saved checks. Goals added from it stay; they only lose the tag
 * (the foreign key sets their job_check_id to null). False for anyone else's check or an unknown id.
 */
export async function deleteJobCheck(checkId: string, owner: Owner, db: Db = getDb()): Promise<boolean> {
  if (!UUID.test(checkId)) return false;
  const own = db.select({ id: resumes.id }).from(resumes).where(ownsResume(owner));
  const gone = await db
    .delete(jobChecks)
    .where(and(eq(jobChecks.id, checkId), inArray(jobChecks.resumeId, own)))
    .returning({ id: jobChecks.id });
  return gone.length > 0;
}
