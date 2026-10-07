import "server-only";
import { and, count, eq, gte, isNull, lt, sum } from "drizzle-orm";
import { getDb } from "@/db";
import { aiCalls, consents, profiles, resumes } from "@/db/schema";
import { recordAiCalls } from "@/lib/ai/log";
import { ANONYMOUS_TTL_HOURS } from "@/lib/session";
import { extractResumeText, ResumeError, type ResumeType } from "./extract";
import { maskPii } from "./mask";
import { parseResume, type ParseClient } from "./parse";

export const RESUME_POLICY_VERSION = "2026-10-draft";
export const LIMITS = {
  perSessionPerDay: 3,
  perClientPerDay: 20,
  /** Total model spend per UTC day, across all users, before parsing pauses (AI-6). Override with PARSE_DAILY_BUDGET_USD. */
  dailyBudgetUsd: () => Number(process.env.PARSE_DAILY_BUDGET_USD ?? 5),
};

const MIME: Record<ResumeType, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  text: "text/plain",
};

export type IngestInput = {
  bytes: Uint8Array;
  as?: "text";
  sessionId: string;
  clientHash: string;
};

export type IngestResult =
  | { ok: true; resumeId: string }
  | { ok: false; status: 400 | 413 | 422 | 429 | 503; code: string; message: string };

type Db = ReturnType<typeof getDb>;

const dayAgo = () => new Date(Date.now() - ANONYMOUS_TTL_HOURS * 60 * 60 * 1000);
const startOfUtcDay = () => new Date(new Date().toISOString().slice(0, 10) + "T00:00:00Z");

async function checkLimits(db: Db, sessionId: string, hash: string): Promise<IngestResult | null> {
  const [[bySession], [byClient], [spent]] = await Promise.all([
    db.select({ n: count() }).from(resumes).where(and(eq(resumes.anonymousSessionId, sessionId), gte(resumes.createdAt, dayAgo()))),
    db.select({ n: count() }).from(resumes).where(and(eq(resumes.clientHash, hash), gte(resumes.createdAt, startOfUtcDay()))),
    db.select({ usd: sum(aiCalls.costUsd) }).from(aiCalls).where(gte(aiCalls.createdAt, startOfUtcDay())),
  ]);
  if (bySession.n >= LIMITS.perSessionPerDay || byClient.n >= LIMITS.perClientPerDay) {
    return { ok: false, status: 429, code: "rate_limited", message: "You've reached today's limit for resume uploads. Please try again tomorrow." };
  }
  if (Number(spent.usd ?? 0) >= LIMITS.dailyBudgetUsd()) {
    return { ok: false, status: 503, code: "busy", message: "We've reached today's capacity for the beta. Please try again tomorrow." };
  }
  return null;
}

/**
 * The upload flow (FR-4 to FR-6): limits, read text in memory, mask, parse, verify and store an unconfirmed profile.
 * Resume text is never stored or logged; only the verified profile is kept.
 */
export async function ingestResume(input: IngestInput, deps: { db?: Db; client?: ParseClient } = {}): Promise<IngestResult> {
  const db = deps.db ?? getDb();

  const limited = await checkLimits(db, input.sessionId, input.clientHash);
  if (limited) return limited;

  let extracted;
  try {
    extracted = await extractResumeText(input.bytes, input.as);
  } catch (error) {
    if (error instanceof ResumeError) {
      return { ok: false, status: error.code === "too_large" ? 413 : 422, code: error.code, message: error.message };
    }
    throw error;
  }
  const masked = maskPii(extracted.text).text;

  const resumeId = await db.transaction(async (tx) => {
    const [consent] = await tx
      .insert(consents)
      .values({ purpose: "resume_analysis", policyVersion: RESUME_POLICY_VERSION })
      .returning({ id: consents.id });
    const [resume] = await tx
      .insert(resumes)
      .values({
        anonymousSessionId: input.sessionId,
        clientHash: input.clientHash,
        consentId: consent.id,
        mimeType: MIME[extracted.type],
        sizeBytes: input.bytes.length,
        status: "parsing",
      })
      .returning({ id: resumes.id });
    return resume.id;
  });

  const result = await parseResume(masked, { resumeId, purpose: "anonymous-upload" }, deps.client);
  const callIds = await recordAiCalls(result.calls, db);

  if (!result.ok) {
    await db.update(resumes).set({ status: "failed" }).where(eq(resumes.id, resumeId));
    return result.reason === "unavailable"
      ? { ok: false, status: 503, code: "unavailable", message: "Our resume reader is unavailable right now. Please try again in a few minutes." }
      : { ok: false, status: 422, code: "unparsed", message: "We couldn't read this resume. Try another format, or paste the text instead." };
  }

  await db.transaction(async (tx) => {
    await tx.insert(profiles).values({ resumeId, version: 1, data: result.profile, aiCallId: callIds.at(-1) });
    await tx.update(resumes).set({ status: "parsed" }).where(eq(resumes.id, resumeId));
  });
  return { ok: true, resumeId };
}

/** Deletes anonymous resumes older than 24 hours with their profiles and analyses (FR-2). Returns how many were removed. */
export async function deleteExpiredAnonymousResumes(db: Db = getDb()): Promise<number> {
  const deleted = await db
    .delete(resumes)
    .where(and(isNull(resumes.userId), lt(resumes.createdAt, dayAgo())))
    .returning({ id: resumes.id });
  return deleted.length;
}

