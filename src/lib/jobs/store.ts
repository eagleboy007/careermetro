import "server-only";
import { createHmac } from "node:crypto";
import { and, desc, eq, gte, isNull, or, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { withKeyLock, type Tx } from "@/db/lock";
import { gapProofs, jobChecks, resumes } from "@/db/schema";
import { loadPrompt } from "@/lib/ai/prompts";
import { refIn, reserveCall, runReserved, usedToday } from "@/lib/ai/reserve";
import { indiaToday } from "@/lib/goals/store";
import { jobTextHashKey } from "@/lib/hash-keys";
import { ownerKey, ownsResume, uploadedBy, type Owner } from "@/lib/owner";
import { getResumeForOwner } from "@/lib/resume/store";
import type { GapAnalysis, JobCheckRequest } from "@/lib/schemas";
import { jobCheckView, type JobCheckView, type StoredJobCheck } from "./groups";
import { PARSE_JD_MODEL, parseJobPosting, type ParseJdClient } from "./parse";

type Db = ReturnType<typeof getDb>;

export const JOB_CHECK_LIMITS = {
  /** New job checks per user or anonymous session per day. A posting checked before doesn't count again. */
  perOwnerPerDay: 5,
  /** Spend on reading postings per UTC day, across all users. It also counts toward the parsing budget (AI-6). */
  dailyBudgetUsd: () => Number(process.env.JOB_CHECK_DAILY_BUDGET_USD ?? 2),
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
  | { ok: false; reason: "not_found" | "not_confirmed" | "limit" | "budget" | "busy" | "unavailable" | "refused" | "malformed" | "no_skills" };

/**
 * Reserves the model call for a job check when this owner is under its daily count and the budget has room, and
 * returns the reserved call's id, or why not. Under its own lock, held for a few milliseconds, so parallel requests
 * (any owner, any server) see each other's reservations before the model is called.
 */
async function reserveJobCheck(tx: Tx, owner: Owner, resumeId: string, roleSlug: string): Promise<string | "limit" | "budget"> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext('cm-ai:parse-jd'))`);
  const ownResumes = tx.select({ id: sql<string>`${resumes.id}::text` }).from(resumes).where(uploadedBy(owner));
  const used = await usedToday(tx, "parse-jd", IN_FLIGHT_JD_USD, refIn("resumeId", ownResumes));
  if (used.mine >= JOB_CHECK_LIMITS.perOwnerPerDay) return "limit";
  if (used.usd >= JOB_CHECK_LIMITS.dailyBudgetUsd()) return "budget";
  return reserveCall(tx, { purpose: "parse-jd", model: PARSE_JD_MODEL, promptVersion: loadPrompt("parse-jd").id, inputRefs: { resumeId, roleSlug } });
}

async function existingCheck(tx: Tx, resumeId: string, roleSlug: string, textHash: string): Promise<string | null> {
  const [row] = await tx
    .select({ id: jobChecks.id })
    .from(jobChecks)
    .where(and(eq(jobChecks.resumeId, resumeId), eq(jobChecks.roleSlug, roleSlug), eq(jobChecks.textHash, textHash)))
    .limit(1);
  return row?.id ?? null;
}

/**
 * "Check against a job" (role-suggest-plan.md part B): reads the skills a pasted posting names and saves them for this
 * owner's resume and target role. Only the skill ids, unknown names and a keyed hash of the text are saved; never the
 * text. It never touches goals, analyses, paths or the ride. The same text for the same resume and role returns the
 * saved check without a model call. Over the daily limit, or when the model fails, nothing is saved.
 *
 * The model call runs between two short locked transactions, never inside one, like the Gaps page's explanations.
 */
export async function createJobCheck(
  input: JobCheckRequest,
  owner: Owner,
  deps: { db?: Db; client?: ParseJdClient; env?: Record<string, string | undefined> } = {},
): Promise<CreateJobCheckResult> {
  const db = deps.db ?? getDb();
  const { resumeId, roleSlug, company, title, text } = input;
  const textHash = jobTextHash(text, deps.env);
  const lockKey = `cm-jobs:${ownerKey(owner)}`;

  const first = await withKeyLock(db, lockKey, JOB_CHECK_LIMITS.lockTimeoutMs, async (tx): Promise<CreateJobCheckResult | { reservedId: string }> => {
    const resume = await getResumeForOwner(resumeId, owner, tx);
    if (!resume) return { ok: false, reason: "not_found" };
    if (!resume.confirmed) return { ok: false, reason: "not_confirmed" };
    const existing = await existingCheck(tx, resumeId, roleSlug, textHash);
    if (existing) return { ok: true, id: existing, reused: true };
    const reserved = await reserveJobCheck(tx, owner, resumeId, roleSlug);
    return reserved === "limit" || reserved === "budget" ? { ok: false, reason: reserved } : { reservedId: reserved };
  });
  if (first === "busy") return { ok: false, reason: "busy" };
  if (!("reservedId" in first)) return first;

  // Settled at once, outside any lock, so the cost counts even if saving fails below.
  const parsed = await runReserved(db, first.reservedId, () => parseJobPosting(text, { resumeId, roleSlug }, deps.client));
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
