import "server-only";
import { and, count, desc, eq, gte, notInArray, sql, sum } from "drizzle-orm";
import { getDb } from "@/db";
import type { Tx } from "@/db/lock";
import { aiCalls, profiles, resumeDrafts, resumes, users } from "@/db/schema";
import { loadPrompt } from "@/lib/ai/prompts";
import { refIn, reserveCall, runReserved, usedToday } from "@/lib/ai/reserve";
import { HEALTH_PURPOSE } from "@/lib/health";
import { logEvent } from "@/lib/log";
import { LIMITS as PARSE_LIMITS } from "@/lib/resume/ingest";
import { nameHashes } from "@/lib/resume/name-match";
import { MAX_PROFILE_VERSIONS } from "@/lib/resume/store";
import { builderAnswers, builderMissing, EMPTY_BUILDER_ANSWERS, type BuilderAnswers, type BuilderIssues, type BuilderReword } from "@/lib/schemas";
import { LIMITS, takeShared } from "@/lib/shared-limit";
import { buildProfile, checkedLines, type BuilderLines } from "./profile";
import { BUILD_MODEL, rewordAnswers, type RewordClient } from "./reword";

/*
 * Build your resume (FR-36, docs/plans/resume-builder-plan.md): the draft and turning it into a resume and profile.
 * The answers are resume text: no log line, audit line or event here carries any of them, only counts.
 */

type Db = ReturnType<typeof getDb>;
type Deps = { db?: Db; now?: Date; client?: RewordClient };

/** A built resume: no file, so a type of its own instead of a file type. */
export const BUILDER_MIME = "application/vnd.careermetro.builder+json";

export type BuilderError = "limit" | "invalid" | "not_ready" | "not_true" | "no_account" | "too_many" | "busy";
export const BUILDER_ERROR_TEXT: Record<BuilderError, string> = {
  limit: "That's a lot of changes at once. Your answers are kept on this page; please wait a few minutes and try again.",
  invalid: "Some answers need a look. Check the fields marked in red.",
  not_ready: "A few sections still need answers.",
  not_true: "Tick \"Everything here is true and mine.\" first.",
  no_account: "Please sign in again.",
  too_many: "This resume has been saved as many times as it can be. Download it, or upload it as a new resume.",
  busy: "Your resume is being written in another tab. Please try again in a moment.",
};

const fail = (error: BuilderError) => ({ ok: false as const, error });

/** The person's draft, or empty answers when there is none. A stored draft that no longer fits the schema starts empty. */
export async function loadDraft(userId: string, db: Pick<Db, "select"> = getDb()): Promise<{ answers: BuilderAnswers; resumeId: string | null }> {
  const [row] = await db.select({ answers: resumeDrafts.answers, resumeId: resumeDrafts.resumeId }).from(resumeDrafts).where(eq(resumeDrafts.userId, userId));
  if (!row) return { answers: EMPTY_BUILDER_ANSWERS, resumeId: null };
  const parsed = builderAnswers.safeParse(row.answers);
  return { answers: parsed.success ? parsed.data : EMPTY_BUILDER_ANSWERS, resumeId: row.resumeId };
}

export type SaveResult = { ok: true } | { ok: false; error: BuilderError; issues?: BuilderIssues };

/** Zod's issues as field paths ("education.0.start") with the first message for each. */
const issuesOf = (issues: readonly { path: readonly PropertyKey[]; message: string }[]): BuilderIssues => {
  const out: BuilderIssues = {};
  for (const i of issues) {
    const key = i.path.map(String).join(".");
    if (key && !(key in out)) out[key] = i.message;
  }
  return out;
};

/**
 * Saves the draft as typed (on Next and after a field loses focus). Limited to `builderSavesPerUserHour`, shared by
 * every server; `counted: false` is for "Review", which has its own limit, so saves made while typing can't use it up.
 * An answer that can never be right comes back as field issues, and nothing is saved.
 */
export async function saveDraft(userId: string, raw: unknown, deps: Deps & { counted?: boolean } = {}): Promise<SaveResult> {
  const db = deps.db ?? getDb();
  const now = deps.now ?? new Date();
  const parsed = builderAnswers.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "invalid", issues: issuesOf(parsed.error.issues) };
  if (deps.counted !== false && !(await takeShared(LIMITS.builderSavesPerUserHour, userId, { db, now: now.getTime() }))) return fail("limit");
  await db
    .insert(resumeDrafts)
    .values({ userId, answers: parsed.data, updatedAt: now })
    .onConflictDoUpdate({ target: resumeDrafts.userId, set: { answers: parsed.data, updatedAt: now } });
  return { ok: true };
}

/** What a reword still running is assumed to cost when checking the budget. A typical one costs 2 to 5 cents. */
const IN_FLIGHT_BUILD_USD = 0.1;
const PURPOSE = "build-resume";

/**
 * Reserves a reword (H4, plan section 3.6) when the person has rewords left today and the shared daily parse budget
 * (AI-6) has room, and returns the reserved call's id; null means the person's own words. Runs under one lock for the
 * purpose, held for a few milliseconds, so parallel builds (any person, any server) see each other's reservations
 * before the model is called. Parses still running count at their own estimate, as the upload's check counts them.
 */
async function reserveReword(userId: string, db: Db, now: Date): Promise<string | null> {
  return db.transaction(async (tx: Tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('cm-ai:build-resume'))`);
    const day = new Date(now.toISOString().slice(0, 10) + "T00:00:00Z");
    const recent = new Date(now.getTime() - 10 * 60_000);
    const [used, [others], [parsing]] = await Promise.all([
      usedToday(tx, PURPOSE, IN_FLIGHT_BUILD_USD, refIn("userId", [userId])),
      tx
        .select({ usd: sum(aiCalls.costUsd) })
        .from(aiCalls)
        .where(and(gte(aiCalls.createdAt, day), notInArray(aiCalls.purpose, [HEALTH_PURPOSE, PURPOSE]))),
      tx.select({ n: count() }).from(resumes).where(and(eq(resumes.status, "parsing"), gte(resumes.createdAt, recent))),
    ]);
    const spent = Number(others.usd ?? 0) + used.usd + parsing.n * PARSE_LIMITS.inFlightParseUsd;
    if (spent >= PARSE_LIMITS.dailyBudgetUsd()) return null;
    if (!(await takeShared(LIMITS.builderRewordsPerUserDay, userId, { db: tx, now: now.getTime() }))) return null;
    return reserveCall(tx, { purpose: PURPOSE, model: BUILD_MODEL, promptVersion: loadPrompt(PURPOSE).id, inputRefs: { userId } });
  });
}

/** Postgres's unique-violation code, from a drizzle error or the driver's own. */
const pgCode = (error: unknown): string | undefined =>
  ((error instanceof Error ? error.cause : undefined) as { code?: string } | undefined)?.code ?? (error as { code?: string } | null)?.code;

export type BuildResult =
  | { ok: true; resumeId: string; lines: BuilderLines; suggestions: BuilderReword["suggestions"]; plain: boolean }
  | { ok: false; error: BuilderError };

/**
 * "Review": turns the saved draft into a resume and a profile waiting for the confirm step, as an upload does.
 * The first build makes the resume. A later one replaces the version still waiting for the confirm step, or after a
 * confirm adds the next version to the same resume, up to MAX_PROFILE_VERSIONS. The model rewords the
 * free-text answers when the limits allow and it answers; otherwise, or for any line it can't support, the person's
 * own sentences are used (`plain`). Suggestions are returned for the review page and never enter the profile.
 */
export async function buildResume(userId: string, deps: Deps = {}): Promise<BuildResult> {
  const db = deps.db ?? getDb();
  const now = deps.now ?? new Date();
  const [account] = await db.select({ name: users.name }).from(users).where(eq(users.id, userId));
  if (!account) return fail("no_account");
  const draft = await loadDraft(userId, db);
  if (Object.keys(builderMissing(draft.answers)).length) return fail("not_ready");

  let model: BuilderReword | null = null;
  let aiCallId: string | null = null;
  const reservedId = await reserveReword(userId, db, now);
  if (reservedId) {
    const reworded = await runReserved(db, reservedId, () => rewordAnswers(draft.answers, { userId }, deps.client));
    aiCallId = reworded.callId;
    model = reworded.reword;
  }
  const { lines, dropped } = checkedLines(draft.answers, model?.answers ?? null);
  const { profile } = buildProfile(draft.answers, lines, now);
  const size = Buffer.byteLength(JSON.stringify(draft.answers));

  let resumeId: string;
  try {
    resumeId = await db.transaction(async (tx) => {
      // One build at a time for a person, so a double click can't make two resumes or two versions.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`cm-builder:${userId}`}))`);
      // Read under the lock: a build that finished while this one waited may have made the resume.
      const [linked] = await tx.select({ resumeId: resumeDrafts.resumeId }).from(resumeDrafts).where(eq(resumeDrafts.userId, userId));
      const [mine] = linked?.resumeId
        ? await tx
            .select({ id: resumes.id })
            .from(resumes)
            .where(and(eq(resumes.id, linked.resumeId), eq(resumes.userId, userId), eq(resumes.source, "builder")))
        : [];
      if (mine) {
        const [latest] = await tx
          .select({ id: profiles.id, version: profiles.version, confirmed: profiles.confirmedByUser })
          .from(profiles)
          .where(eq(profiles.resumeId, mine.id))
          .orderBy(desc(profiles.version))
          .limit(1);
        if (latest && !latest.confirmed) {
          // Not confirmed yet, so nothing reads it but the confirm step: this build replaces it rather than adding a
          // version, and rebuilding before "Check my gaps" never grows the count.
          await tx.update(profiles).set({ data: profile, aiCallId, createdAt: now }).where(eq(profiles.id, latest.id));
        } else {
          // A confirmed version stays as it is (its gaps and goals point at it); the new build is the next version,
          // within the same cap as the confirm step's corrections.
          const version = (latest?.version ?? 0) + 1;
          if (version > MAX_PROFILE_VERSIONS) return "too_many" as const;
          await tx.insert(profiles).values({ resumeId: mine.id, version, data: profile, aiCallId });
        }
        await tx.update(resumes).set({ sizeBytes: size }).where(eq(resumes.id, mine.id));
        return mine.id;
      }
      // The name check passes as for an upload printed with the account's name: the hashes come from that name.
      const [made] = await tx
        .insert(resumes)
        .values({ userId, mimeType: BUILDER_MIME, sizeBytes: size, status: "parsed", source: "builder", nameHashes: nameHashes(account.name), createdAt: now })
        .returning({ id: resumes.id });
      await tx.insert(profiles).values({ resumeId: made.id, version: 1, data: profile, aiCallId });
      await tx.update(resumeDrafts).set({ resumeId: made.id }).where(eq(resumeDrafts.userId, userId));
      return made.id;
    });
  } catch (error) {
    // 23505 on profiles_resume_version: the confirm step saved a version of this resume at the same moment.
    if (pgCode(error) === "23505") return fail("busy");
    throw error;
  }
  if (resumeId === "too_many") return fail("too_many");
  logEvent("info", "resume_built", { lines: Object.values(lines).flat().length, dropped, plain: !model });
  return { ok: true, resumeId, lines, suggestions: model?.suggestions ?? [], plain: !model };
}

/**
 * "Review my resume" and "Update my resume": saves the answers on screen, then builds. Limited by
 * `builderBuildsPerUserHour`, taken first, so the save here doesn't count toward the typing saves' limit and saving
 * while typing can never stop a review.
 */
export async function reviewDraft(userId: string, raw: unknown, deps: Deps = {}): Promise<BuildResult | Extract<SaveResult, { ok: false }>> {
  const db = deps.db ?? getDb();
  const now = deps.now ?? new Date();
  if (!(await takeShared(LIMITS.builderBuildsPerUserHour, userId, { db, now: now.getTime() }))) return fail("limit");
  const saved = await saveDraft(userId, raw, { ...deps, db, now, counted: false });
  if (!saved.ok) return saved;
  return buildResume(userId, { ...deps, db, now });
}

/** For Download your data: the draft as stored. */
export async function exportDraft(userId: string, db: Pick<Db, "select"> = getDb()) {
  const [row] = await db.select({ answers: resumeDrafts.answers, updatedAt: resumeDrafts.updatedAt }).from(resumeDrafts).where(eq(resumeDrafts.userId, userId));
  return row ?? null;
}

/** "Check my gaps" from the review page: only with the tick, and only for the person's own built resume. */
export async function readyForGaps(userId: string, resumeId: string, truthful: boolean, db: Pick<Db, "select"> = getDb()): Promise<{ ok: true } | { ok: false; error: BuilderError }> {
  if (!truthful) return fail("not_true");
  const [row] = await db
    .select({ id: resumes.id })
    .from(resumes)
    .where(and(eq(resumes.id, resumeId), eq(resumes.userId, userId), eq(resumes.source, "builder")));
  return row ? { ok: true } : fail("not_ready");
}
