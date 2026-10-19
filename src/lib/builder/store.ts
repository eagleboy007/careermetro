import "server-only";
import { and, eq, gte, max, ne, sum } from "drizzle-orm";
import { getDb } from "@/db";
import { aiCalls, profiles, resumeDrafts, resumes, users } from "@/db/schema";
import { recordAiCalls } from "@/lib/ai/log";
import { HEALTH_PURPOSE } from "@/lib/health";
import { logEvent } from "@/lib/log";
import { LIMITS as PARSE_LIMITS } from "@/lib/resume/ingest";
import { nameHashes } from "@/lib/resume/name-match";
import { builderAnswers, builderMissing, EMPTY_BUILDER_ANSWERS, type BuilderAnswers, type BuilderReword } from "@/lib/schemas";
import { LIMITS, takeShared } from "@/lib/shared-limit";
import { buildProfile, checkedLines, type BuilderLines } from "./profile";
import { rewordAnswers, type RewordClient } from "./reword";

/*
 * Build your resume (FR-36, docs/plans/resume-builder-plan.md): the draft and turning it into a resume and profile.
 * The answers are resume text: no log line, audit line or event here carries any of them, only counts.
 */

type Db = ReturnType<typeof getDb>;
type Deps = { db?: Db; now?: Date; client?: RewordClient };

/** A built resume: no file, so a type of its own instead of a file type. */
export const BUILDER_MIME = "application/vnd.careermetro.builder+json";

export type BuilderError = "limit" | "invalid" | "not_ready" | "not_true" | "no_account";
export const BUILDER_ERROR_TEXT: Record<BuilderError, string> = {
  limit: "That's a lot of changes at once. Please wait a few minutes and try again.",
  invalid: "Some answers need a look. Check the fields marked in red.",
  not_ready: "A few sections still need answers.",
  not_true: "Tick \"Everything here is true and mine.\" first.",
  no_account: "Please sign in again.",
};

const fail = (error: BuilderError) => ({ ok: false as const, error });

/** The person's draft, or empty answers when there is none. A stored draft that no longer fits the schema starts empty. */
export async function loadDraft(userId: string, db: Pick<Db, "select"> = getDb()): Promise<{ answers: BuilderAnswers; resumeId: string | null }> {
  const [row] = await db.select({ answers: resumeDrafts.answers, resumeId: resumeDrafts.resumeId }).from(resumeDrafts).where(eq(resumeDrafts.userId, userId));
  if (!row) return { answers: EMPTY_BUILDER_ANSWERS, resumeId: null };
  const parsed = builderAnswers.safeParse(row.answers);
  return { answers: parsed.success ? parsed.data : EMPTY_BUILDER_ANSWERS, resumeId: row.resumeId };
}

/** Saves the draft as typed (on Next and on blur). Limited to 60 saves an hour a person, shared by every server. */
export async function saveDraft(userId: string, raw: unknown, deps: Deps = {}) {
  const db = deps.db ?? getDb();
  const now = deps.now ?? new Date();
  const parsed = builderAnswers.safeParse(raw);
  if (!parsed.success) return { ...fail("invalid"), issues: parsed.error.issues.map((i) => i.path.join(".")) };
  if (!(await takeShared(LIMITS.builderSavesPerUserHour, userId, { db, now: now.getTime() }))) return fail("limit");
  await db
    .insert(resumeDrafts)
    .values({ userId, answers: parsed.data, updatedAt: now })
    .onConflictDoUpdate({ target: resumeDrafts.userId, set: { answers: parsed.data, updatedAt: now } });
  return { ok: true as const };
}

/** Whether the model may be called: the person's 5 rewords a day, and the shared daily parse budget (AI-6). */
async function mayReword(userId: string, db: Db, now: Date): Promise<boolean> {
  const day = new Date(now.toISOString().slice(0, 10) + "T00:00:00Z");
  const [spent] = await db
    .select({ usd: sum(aiCalls.costUsd) })
    .from(aiCalls)
    .where(and(gte(aiCalls.createdAt, day), ne(aiCalls.purpose, HEALTH_PURPOSE)));
  if (Number(spent?.usd ?? 0) >= PARSE_LIMITS.dailyBudgetUsd()) return false;
  return takeShared(LIMITS.builderRewordsPerUserDay, userId, { db, now: now.getTime() });
}

export type BuildResult =
  | { ok: true; resumeId: string; lines: BuilderLines; suggestions: BuilderReword["suggestions"]; plain: boolean }
  | { ok: false; error: BuilderError };

/**
 * "Review": turns the saved draft into a resume and a profile waiting for the confirm step, as an upload does.
 * The first build makes the resume; each later one adds a profile version to the same resume. The model rewords the
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
  if (await mayReword(userId, db, now)) {
    const { reword, calls } = await rewordAnswers(draft.answers, { userId }, deps.client);
    aiCallId = (await recordAiCalls(calls, db)).at(-1) ?? null;
    model = reword;
  }
  const { lines, dropped } = checkedLines(draft.answers, model?.answers ?? null);
  const { profile } = buildProfile(draft.answers, lines, now);
  const size = Buffer.byteLength(JSON.stringify(draft.answers));

  const resumeId = await db.transaction(async (tx) => {
    const [mine] = draft.resumeId
      ? await tx
          .select({ id: resumes.id })
          .from(resumes)
          .where(and(eq(resumes.id, draft.resumeId), eq(resumes.userId, userId), eq(resumes.source, "builder")))
      : [];
    if (mine) {
      const [{ v }] = await tx.select({ v: max(profiles.version) }).from(profiles).where(eq(profiles.resumeId, mine.id));
      await tx.insert(profiles).values({ resumeId: mine.id, version: (v ?? 0) + 1, data: profile, aiCallId });
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
  logEvent("info", "resume_built", { lines: Object.values(lines).flat().length, dropped, plain: !model });
  return { ok: true, resumeId, lines, suggestions: model?.suggestions ?? [], plain: !model };
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
