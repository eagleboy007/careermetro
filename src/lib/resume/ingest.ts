import "server-only";
import { and, count, eq, gte, isNull, lt, sql, sum } from "drizzle-orm";
import { getDb } from "@/db";
import { aiCalls, consents, profiles, resumes } from "@/db/schema";
import { recordAiCalls } from "@/lib/ai/log";
import { ANONYMOUS_TTL_HOURS } from "@/lib/session";
import { extractResumeText, ResumeError, type ResumeType } from "./extract";
import { maskPii } from "./mask";
import { PARSE_DEADLINE_MS, parseResume, type ParseClient } from "./parse";

export const RESUME_POLICY_VERSION = "2026-10-draft";
export const LIMITS = {
  perSessionPerDay: 3,
  perClientPerDay: 20,
  /** Total model spend per UTC day, across all users, before parsing pauses (AI-6). Override with PARSE_DAILY_BUDGET_USD. */
  dailyBudgetUsd: () => Number(process.env.PARSE_DAILY_BUDGET_USD ?? 5),
  /** What a parse still running is assumed to cost when checking the budget. A typical one costs 5 to 8 cents. */
  inFlightParseUsd: 0.2,
};

/** Serializes the limit check and the reservation, so parallel uploads can't all pass the same count. */
const RESERVE_LOCK_KEY = 0x63_6d_72_73; // "cmrs"
/** A row still "parsing" after this long belongs to a request that died; it no longer holds budget. */
const IN_FLIGHT_MINUTES = 10;

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
  /** When the request began, so extraction and waiting for the lock come out of the parse deadline. */
  startedAt?: number;
};

export type IngestResult =
  | { ok: true; resumeId: string }
  | { ok: false; status: 400 | 413 | 422 | 429 | 503; code: string; message: string };

type Db = ReturnType<typeof getDb>;

const dayAgo = () => new Date(Date.now() - ANONYMOUS_TTL_HOURS * 60 * 60 * 1000);
const startOfUtcDay = () => new Date(new Date().toISOString().slice(0, 10) + "T00:00:00Z");

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

const BUSY: IngestResult = {
  ok: false,
  status: 503,
  code: "busy",
  message: "We've reached today's capacity for the beta. Please try again tomorrow.",
};

async function checkLimits(tx: Db | Tx, sessionId: string, hash: string): Promise<IngestResult | null> {
  const recent = new Date(Date.now() - IN_FLIGHT_MINUTES * 60 * 1000);
  // Uploads still being parsed are rows already, so they count toward the per-session and per-client limits.
  const [[bySession], [byClient], [spent], [inFlight]] = await Promise.all([
    tx.select({ n: count() }).from(resumes).where(and(eq(resumes.anonymousSessionId, sessionId), gte(resumes.createdAt, dayAgo()))),
    tx.select({ n: count() }).from(resumes).where(and(eq(resumes.clientHash, hash), gte(resumes.createdAt, startOfUtcDay()))),
    tx.select({ usd: sum(aiCalls.costUsd) }).from(aiCalls).where(gte(aiCalls.createdAt, startOfUtcDay())),
    tx.select({ n: count() }).from(resumes).where(and(eq(resumes.status, "parsing"), gte(resumes.createdAt, recent))),
  ]);
  if (bySession.n >= LIMITS.perSessionPerDay || byClient.n >= LIMITS.perClientPerDay) {
    return { ok: false, status: 429, code: "rate_limited", message: "You've reached today's limit for resume uploads. Please try again tomorrow." };
  }
  if (Number(spent.usd ?? 0) + inFlight.n * LIMITS.inFlightParseUsd >= LIMITS.dailyBudgetUsd()) {
    return BUSY;
  }
  return null;
}

/** Checks limits and inserts the consent and a "parsing" resume row under one lock. Returns the resume id. */
function reserve(db: Db, input: IngestInput, type: ResumeType): Promise<IngestResult | string> {
  return db.transaction(async (tx) => {
    // Waiting uploads hold a pooled connection, so give up quickly rather than queue.
    await tx.execute(sql`set local lock_timeout = '5s'`);
    await tx.execute(sql`select pg_advisory_xact_lock(${RESERVE_LOCK_KEY})`);
    const limited = await checkLimits(tx, input.sessionId, input.clientHash);
    if (limited) return limited;

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
        mimeType: MIME[type],
        sizeBytes: input.bytes.length,
        status: "parsing",
      })
      .returning({ id: resumes.id });
    return resume.id;
  });
}

const pgCode = (error: unknown): string | undefined => {
  const cause = error instanceof Error ? (error.cause as { code?: string } | undefined) : undefined;
  return cause?.code ?? (error as { code?: string } | null)?.code;
};

/**
 * The upload flow (FR-4 to FR-6): read text in memory, mask, check limits and reserve a row, parse, verify and
 * store an unconfirmed profile. Resume text is never stored or logged; only the verified profile is kept.
 */
export async function ingestResume(input: IngestInput, deps: { db?: Db; client?: ParseClient } = {}): Promise<IngestResult> {
  const db = deps.db ?? getDb();
  const startedAt = input.startedAt ?? Date.now();

  // A quick check without the lock, so a client already over its limit can't make us extract file after file.
  const early = await checkLimits(db, input.sessionId, input.clientHash);
  if (early) return early;

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

  let reserved;
  try {
    reserved = await reserve(db, input, extracted.type);
  } catch (error) {
    // 55P03 is lock_not_available: too many uploads at once. Treat it like a busy day rather than a crash.
    if (pgCode(error) === "55P03") return BUSY;
    throw error;
  }
  if (typeof reserved !== "string") return reserved;
  const resumeId = reserved;

  try {
    const deadline = PARSE_DEADLINE_MS - (Date.now() - startedAt);
    const result = await parseResume(masked, { resumeId, purpose: "anonymous-upload" }, deps.client, deadline);
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
  } catch (error) {
    // Leave no row stuck in "parsing", where it would hold budget and show a spinner forever.
    await db
      .update(resumes)
      .set({ status: "failed" })
      .where(eq(resumes.id, resumeId))
      .catch(() => {});
    throw error;
  }
}

/** Deletes anonymous resumes older than 24 hours with their profiles and analyses (FR-2). Returns how many were removed. */
export async function deleteExpiredAnonymousResumes(db: Db = getDb()): Promise<number> {
  const deleted = await db
    .delete(resumes)
    .where(and(isNull(resumes.userId), lt(resumes.createdAt, dayAgo())))
    .returning({ id: resumes.id });
  return deleted.length;
}

