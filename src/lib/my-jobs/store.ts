import "server-only";
import { and, asc, count, desc, eq, inArray, isNotNull, lt, sql } from "drizzle-orm";
import { getDb } from "@/db";
import type { Tx } from "@/db/lock";
import { jobChecks, jobPosts, jobSaves, resumes } from "@/db/schema";
import { currentAnalysis } from "@/lib/gaps/current";
import { provedSkills } from "@/lib/goals/store";
import { jobCheckView } from "@/lib/jobs/groups";
import { checkPosting, type CreateJobCheckResult, type JobCheckDeps } from "@/lib/jobs/store";
import { getResumeForOwner } from "@/lib/resume/store";
import {
  addJobRequest,
  deleteJobRequest,
  jobStatusRequest,
  MY_JOB_STATUS_LABELS,
  MY_JOBS_MAX,
  saveJobRequest,
  updateJobRequest,
  type GapAnalysis,
  type JobPost,
  type MyJobExport,
  type MyJobRef,
  type MyJobView,
  type Profile,
} from "@/lib/schemas";
import { JOB_TEXT_MAX } from "@/lib/schemas/constants";
import { LIMITS, takeShared } from "@/lib/shared-limit";
import { readBoardPosting, listedCompany, type BoardReadResult } from "./board-read";
import { boardLinkOf, isClosed, isMoving, stageOf, statusOf, type BoardLink, type MyJobStatus } from "./rules";
import { checkFit, newestChange, postFit, type MyJobFit } from "./view";

/*
 * My jobs (handoff 12m, docs/plans/application-tracker-plan.md): the person's own list in job_saves, each row a feed
 * post or a job they added (a job check). Every write takes Zod-checked input, is scoped to the session user in its
 * WHERE clause, and counts against the same 200 changes a day as Departures. Nothing here logs: titles, links, notes
 * and descriptions never reach a log. Nothing moves a status on its own.
 */

type Db = ReturnType<typeof getDb>;
type Deps = { db?: Db; now?: Date; max?: number };

export const MY_JOB_ERRORS = ["invalid", "limit", "not_found", "full"] as const;
export type MyJobError = (typeof MY_JOB_ERRORS)[number];
export type MyJobResult = { ok: true } | { ok: false; error: MyJobError };

export const MY_JOB_MESSAGES: Record<MyJobError, string> = {
  invalid: "That didn't work. Please refresh the page and try again.",
  limit: "That's as many changes as we allow in a day. Try again tomorrow.",
  not_found: "That job isn't in My jobs any more. Refresh the page to see your list.",
  full: `You have ${MY_JOBS_MAX} jobs in My jobs, as many as we keep. Delete one you don't need first.`,
};

/** A day from a date field, as noon in IST, so it reads as the same day everywhere in India. */
const istDay = (day: string) => new Date(`${day}T12:00:00+05:30`);

/** The rows of this person that a ref names: their own only. */
const refWhere = (userId: string, ref: MyJobRef) =>
  and(eq(jobSaves.userId, userId), ref.kind === "post" ? eq(jobSaves.jobPostId, ref.postId) : eq(jobSaves.jobCheckId, ref.checkId));

/** This person's own job checks: those on their resumes. */
const ownCheck = (userId: string, checkId: string) =>
  and(eq(jobChecks.id, checkId), sql`exists (select 1 from ${resumes} where ${resumes.id} = ${jobChecks.resumeId} and ${resumes.userId} = ${userId})`);

/**
 * Runs one change in a transaction, counting the try against the day's 200 Departures changes first, then holding the
 * person's Departures lock, so a change here and one on Departures can't both pass a list's cap.
 */
async function change(userId: string, deps: Deps, fn: (tx: Tx, now: Date) => Promise<MyJobResult>): Promise<MyJobResult> {
  const db = deps.db ?? getDb();
  const now = deps.now ?? new Date();
  return db.transaction(async (tx) => {
    if (!(await takeShared(LIMITS.departureChangesPerUserDay, userId, { db: tx, now: now.getTime() }))) return { ok: false, error: "limit" };
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`cm-departures:${userId}`}))`);
    return fn(tx, now);
  });
}

async function listFull(tx: Tx, userId: string, max: number): Promise<boolean> {
  const [row] = await tx.select({ n: count() }).from(jobSaves).where(eq(jobSaves.userId, userId));
  return row.n >= max;
}

/** The dates a row takes for a new status: Applied on from the first move to Applied or later, Closed on with a closed status. */
function datesFor(status: MyJobStatus, was: { appliedAt: Date | null; closedAt: Date | null; stage: number | null }, now: Date) {
  return {
    stage: stageOf(status),
    appliedAt: isMoving(status) ? (was.appliedAt ?? now) : status === "saved" ? null : was.appliedAt,
    closedAt: isClosed(status) ? (was.stage !== null && isClosed(statusOf(was.stage)) && was.closedAt ? was.closedAt : now) : null,
  };
}

/* Add a job you found -------------------------------------------------------------------------------------------- */

/** "Check these, then save": the job as read, waiting for the person to check its company, title and city. */
export type AddedJob = { checkId: string; company: string; title: string; city: string | null; source: "you" | "board"; url: string | null; fit: MyJobFit | null };

export type AddJobResult =
  | { ok: true; kind: "check"; job: AddedJob }
  /** The board link's posting is already on Departures: it is saved as that feed job, with no second copy. */
  | { ok: true; kind: "post"; postId: string }
  | { ok: false; reason: Exclude<CreateJobCheckResult, { ok: true }>["reason"] | "invalid" | "no_analysis" | "board_unreadable" | "board_not_found" | "full" | "limit" };

/** The feed post a board link points to, when the daily feed already has it. */
async function feedPostOf(link: BoardLink, db: Pick<Db, "select">): Promise<string | null> {
  const [row] = await db
    .select({ id: jobPosts.id })
    .from(jobPosts)
    .where(and(eq(jobPosts.ats, link.ats), sql`lower(${jobPosts.boardToken}) = ${link.token.toLowerCase()}`, eq(jobPosts.externalId, link.id)))
    .limit(1);
  return row?.id ?? null;
}

/** Saves a feed post to the person's list as Saved, or leaves the row it already has. */
async function saveFeedPost(userId: string, postId: string, deps: Deps): Promise<MyJobResult> {
  return change(userId, deps, async (tx, now) => {
    const [row] = await tx.select({ savedAt: jobSaves.savedAt }).from(jobSaves).where(refWhere(userId, { kind: "post", postId })).limit(1);
    if (row) {
      if (!row.savedAt) await tx.update(jobSaves).set({ savedAt: now, updatedAt: now }).where(refWhere(userId, { kind: "post", postId }));
      return { ok: true };
    }
    if (await listFull(tx, userId, deps.max ?? MY_JOBS_MAX)) return { ok: false, error: "full" };
    await tx.insert(jobSaves).values({ userId, jobPostId: postId, savedAt: now, updatedAt: now }).onConflictDoNothing();
    return { ok: true };
  });
}

/** What fit is read against for an added job: the current analysis's confirmed profile, its target gaps and current proof. */
export type CheckFitContext = { profile: Profile; target: Pick<GapAnalysis, "gaps">; proved: ReadonlySet<string> };

/**
 * "Add a job you found": checks a pasted description, or a company job board's posting, against the person's current
 * resume and target role, and keeps the link, source, city and their own copy of the text with the check. The job joins
 * My jobs only once they press "Save to My jobs" (saveJob). A board link whose posting the feed already has saves that
 * feed job instead. The same limits as every job check (5 new a day, the daily budget); a board read counts as one.
 */
export async function addJob(
  userId: string,
  raw: unknown,
  deps: JobCheckDeps & { now?: Date; fetchImpl?: typeof fetch; readBoard?: (link: BoardLink) => Promise<BoardReadResult> } = {},
): Promise<AddJobResult> {
  const input = addJobRequest.safeParse(raw);
  if (!input.success) return { ok: false, reason: "invalid" };
  const { resumeId, text, url } = input.data;
  const db = deps.db ?? getDb();
  const analysis = await currentAnalysis(userId, db);
  if (!analysis || analysis.resumeId !== resumeId) return { ok: false, reason: "no_analysis" };
  const link = url ? boardLinkOf(url) : null;
  if (link) {
    const postId = await feedPostOf(link, db);
    if (postId) {
      const saved = await saveFeedPost(userId, postId, { db, now: deps.now });
      return saved.ok ? { ok: true, kind: "post", postId } : { ok: false, reason: saved.error === "invalid" || saved.error === "not_found" ? "invalid" : saved.error };
    }
  }
  let posting = { text, company: link ? listedCompany(link) : null, title: null as string | null, city: null as string | null };
  if (!text && link) {
    const read = await (deps.readBoard ?? ((l: BoardLink) => readBoardPosting(l, { fetchImpl: deps.fetchImpl })))(link);
    if (!read.ok) return { ok: false, reason: read.error === "not_found" ? "board_not_found" : "board_unreadable" };
    posting = { text: read.posting.text, company: read.posting.company ?? listedCompany(link), title: read.posting.title.slice(0, 120), city: read.posting.city };
  }
  const created = await checkPosting(
    {
      resumeId,
      roleSlug: analysis.result.roleSlug,
      company: posting.company?.slice(0, 100) ?? null,
      title: posting.title,
      text: posting.text.slice(0, JOB_TEXT_MAX),
      kept: { url, source: link ? "board" : "pasted", city: posting.city, description: posting.text },
    },
    { userId },
    { ...deps, db },
  );
  if (!created.ok) return created;
  const [check] = await db
    .select({ company: jobChecks.company, title: jobChecks.title, city: jobChecks.city, source: jobChecks.source, url: jobChecks.url })
    .from(jobChecks)
    .where(eq(jobChecks.id, created.id))
    .limit(1);
  if (!check) return { ok: false, reason: "not_found" };
  const views = await checkFits(userId, [created.id], db, deps.now);
  return {
    ok: true,
    kind: "check",
    job: { checkId: created.id, company: check.company, title: check.title, city: check.city, source: check.source === "board" ? "board" : "you", url: check.url, fit: views.get(created.id) ?? null },
  };
}

/** Each check's fit against the person's current resume and target role, from code; none without a confirmed resume. */
async function checkFits(userId: string, checkIds: string[], db: Db, now = new Date(), ctx?: CheckFitContext | null): Promise<Map<string, MyJobFit>> {
  if (!checkIds.length) return new Map();
  const context = ctx === undefined ? await fitContext(userId, db) : ctx;
  if (!context) return new Map();
  const rows = await db
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
    .where(and(inArray(jobChecks.id, checkIds), eq(resumes.userId, userId)));
  return new Map(rows.map((r) => [r.id, checkFit(jobCheckView(r, context.profile, context.target, context.proved, { now }))]));
}

/** The person's current analysis's confirmed profile, target gaps and current proof; null with no confirmed resume. */
export async function fitContext(userId: string, db: Db = getDb()): Promise<CheckFitContext | null> {
  const analysis = await currentAnalysis(userId, db);
  if (!analysis) return null;
  const [resume, proved] = await Promise.all([getResumeForOwner(analysis.resumeId, { userId }, db), provedSkills(userId, db)]);
  if (!resume?.confirmed) return null;
  return { profile: resume.profile, target: analysis.result, proved: new Set(proved) };
}

/** "Save to My jobs": the added job joins the list as Saved, with the company, title and city the person checked. */
export async function saveJob(userId: string, raw: unknown, deps: Deps = {}): Promise<MyJobResult> {
  const input = saveJobRequest.safeParse(raw);
  if (!input.success) return { ok: false, error: "invalid" };
  const { checkId, company, title, city } = input.data;
  return change(userId, deps, async (tx, now) => {
    const [check] = await tx.select({ id: jobChecks.id }).from(jobChecks).where(ownCheck(userId, checkId)).for("update");
    if (!check) return { ok: false, error: "not_found" };
    await tx.update(jobChecks).set({ company, title, city }).where(eq(jobChecks.id, checkId));
    const [row] = await tx.select({ savedAt: jobSaves.savedAt }).from(jobSaves).where(refWhere(userId, { kind: "check", checkId })).limit(1);
    if (row) {
      await tx.update(jobSaves).set({ savedAt: row.savedAt ?? now, updatedAt: now }).where(refWhere(userId, { kind: "check", checkId }));
      return { ok: true };
    }
    if (await listFull(tx, userId, deps.max ?? MY_JOBS_MAX)) return { ok: false, error: "full" };
    await tx.insert(jobSaves).values({ userId, jobCheckId: checkId, savedAt: now, updatedAt: now });
    return { ok: true };
  });
}

/* Status, the edit sheet and delete ---------------------------------------------------------------------------- */

async function rowFor(tx: Tx, userId: string, ref: MyJobRef) {
  const [row] = await tx
    .select({ id: jobSaves.id, savedAt: jobSaves.savedAt, stage: jobSaves.stage, appliedAt: jobSaves.appliedAt, closedAt: jobSaves.closedAt })
    .from(jobSaves)
    .where(refWhere(userId, ref))
    .limit(1)
    .for("update");
  return row ?? null;
}

/** The status chip's menu: sets the status and the dates it brings ("sets 28 Oct"). Saved keeps the job, unapplied. */
export async function setJobStatus(userId: string, raw: unknown, deps: Deps = {}): Promise<MyJobResult> {
  const input = jobStatusRequest.safeParse(raw);
  if (!input.success) return { ok: false, error: "invalid" };
  const { ref, status } = input.data;
  return change(userId, deps, async (tx, now) => {
    const row = await rowFor(tx, userId, ref);
    if (!row) return { ok: false, error: "not_found" };
    await tx
      .update(jobSaves)
      .set({ ...datesFor(status, row, now), savedAt: status === "saved" ? (row.savedAt ?? now) : row.savedAt, updatedAt: now })
      .where(eq(jobSaves.id, row.id));
    return { ok: true };
  });
}

/**
 * The edit sheet's Save: status, Applied on, Closed on and the private note, and on a job the person added its
 * company, title, link and city too. A feed job keeps the posting's. An empty date on a moving status keeps the one
 * already set (or today); Closed on counts only for a closed status.
 */
export async function updateJob(userId: string, raw: unknown, deps: Deps = {}): Promise<MyJobResult> {
  const input = updateJobRequest.safeParse(raw);
  if (!input.success) return { ok: false, error: "invalid" };
  const { ref, status, appliedOn, closedOn, note, company, title, url, city } = input.data;
  return change(userId, deps, async (tx, now) => {
    const row = await rowFor(tx, userId, ref);
    if (!row) return { ok: false, error: "not_found" };
    if (ref.kind === "check") {
      const labels = { company, title, url, city };
      const set = Object.fromEntries(Object.entries(labels).filter(([, v]) => v !== undefined));
      if (Object.keys(set).length) await tx.update(jobChecks).set(set).where(ownCheck(userId, ref.checkId));
    }
    const dates = datesFor(status, row, now);
    await tx
      .update(jobSaves)
      .set({
        stage: dates.stage,
        appliedAt: appliedOn ? istDay(appliedOn) : dates.appliedAt,
        closedAt: isClosed(status) && closedOn ? istDay(closedOn) : dates.closedAt,
        savedAt: status === "saved" ? (row.savedAt ?? now) : row.savedAt,
        note,
        updatedAt: now,
      })
      .where(eq(jobSaves.id, row.id));
    return { ok: true };
  });
}

/**
 * "Delete this job": nothing is kept. An added job goes with its check and description (the row goes with it, on
 * delete cascade); a feed job leaves the person's list, and the post stays on Departures.
 */
export async function deleteJob(userId: string, raw: unknown, deps: Deps = {}): Promise<MyJobResult> {
  const input = deleteJobRequest.safeParse(raw);
  if (!input.success) return { ok: false, error: "invalid" };
  const { ref } = input.data;
  return change(userId, deps, async (tx) => {
    const gone =
      ref.kind === "check"
        ? await tx.delete(jobChecks).where(ownCheck(userId, ref.checkId)).returning({ id: jobChecks.id })
        : await tx.delete(jobSaves).where(refWhere(userId, ref)).returning({ id: jobSaves.id });
    return gone.length ? { ok: true } : { ok: false, error: "not_found" };
  });
}

/** "Read the job again": the person's own copy of an added job's description, or null. Read only. */
export async function jobDescription(userId: string, checkId: string, db: Db = getDb()): Promise<string | null> {
  if (!/^[0-9a-f-]{36}$/i.test(checkId)) return null;
  const [row] = await db
    .select({ description: jobChecks.description })
    .from(jobChecks)
    .innerJoin(jobSaves, and(eq(jobSaves.jobCheckId, jobChecks.id), eq(jobSaves.userId, userId)))
    .where(ownCheck(userId, checkId))
    .limit(1);
  return row?.description ?? null;
}

/* The list ------------------------------------------------------------------------------------------------------ */

/**
 * My jobs for the page, newest change first, at most MY_JOBS_MAX. A feed job's fit comes from its Departures row
 * (`posts`, by id; `fitShown` false when Departures shows no fit); an added job's is worked out again here against the
 * current resume, so it stays right after a new upload with no model call. Read only.
 */
export async function myJobs(
  userId: string,
  { db = getDb(), now = new Date(), posts = new Map(), fitShown = true, ctx }: { db?: Db; now?: Date; posts?: ReadonlyMap<string, JobPost>; fitShown?: boolean; ctx?: CheckFitContext | null } = {},
): Promise<MyJobView[]> {
  const rows = await db
    .select({
      postId: jobSaves.jobPostId,
      checkId: jobSaves.jobCheckId,
      savedAt: jobSaves.savedAt,
      stage: jobSaves.stage,
      appliedAt: jobSaves.appliedAt,
      closedAt: jobSaves.closedAt,
      note: jobSaves.note,
      updatedAt: jobSaves.updatedAt,
      postTitle: jobPosts.title,
      postCompany: jobPosts.company,
      postCity: jobPosts.city,
      postUrl: jobPosts.url,
      postClosedAt: jobPosts.closedAt,
      checkTitle: jobChecks.title,
      checkCompany: jobChecks.company,
      checkCity: jobChecks.city,
      checkUrl: jobChecks.url,
      checkSource: jobChecks.source,
      hasDescription: sql<boolean>`${jobChecks.description} is not null`,
    })
    .from(jobSaves)
    .leftJoin(jobPosts, eq(jobPosts.id, jobSaves.jobPostId))
    .leftJoin(jobChecks, eq(jobChecks.id, jobSaves.jobCheckId))
    .where(eq(jobSaves.userId, userId))
    .orderBy(desc(jobSaves.updatedAt), asc(jobSaves.id))
    .limit(MY_JOBS_MAX);
  const fits = fitShown ? await checkFits(userId, rows.flatMap((r) => (r.checkId ? [r.checkId] : [])), db, now, ctx) : new Map<string, MyJobFit>();
  const iso = (d: Date | null) => d?.toISOString() ?? null;
  const views: MyJobView[] = [];
  for (const r of rows) {
    const base = {
      status: statusOf(r.stage),
      savedAt: iso(r.savedAt),
      appliedAt: iso(r.appliedAt),
      closedAt: iso(r.closedAt),
      note: r.note,
      updatedAt: r.updatedAt.toISOString(),
    };
    if (r.postId && r.postTitle !== null && r.postCompany !== null) {
      const post = posts.get(r.postId);
      views.push({
        ...base,
        key: `post:${r.postId}`,
        ref: { kind: "post", postId: r.postId },
        company: r.postCompany,
        title: r.postTitle,
        city: r.postCity,
        source: "board",
        url: r.postUrl,
        postClosed: r.postClosedAt !== null,
        hasDescription: false,
        fit: post ? postFit(post, fitShown) : null,
      });
    } else if (r.checkId && r.checkTitle !== null && r.checkCompany !== null) {
      views.push({
        ...base,
        key: `check:${r.checkId}`,
        ref: { kind: "check", checkId: r.checkId },
        company: r.checkCompany,
        title: r.checkTitle,
        city: r.checkCity,
        source: r.checkSource === "board" ? "board" : "you",
        url: r.checkUrl,
        postClosed: false,
        hasDescription: r.hasDescription,
        fit: fits.get(r.checkId) ?? null,
      });
    }
  }
  return views.sort(newestChange);
}

/** For Download your data (added in export version 33): every job in My jobs with its note and description, oldest change first. */
export async function exportMyJobs(userId: string, db: Db = getDb()): Promise<MyJobExport[]> {
  const rows = await db
    .select({
      postId: jobSaves.jobPostId,
      savedAt: jobSaves.savedAt,
      stage: jobSaves.stage,
      appliedAt: jobSaves.appliedAt,
      closedAt: jobSaves.closedAt,
      note: jobSaves.note,
      postTitle: jobPosts.title,
      postCompany: jobPosts.company,
      postCity: jobPosts.city,
      postUrl: jobPosts.url,
      checkTitle: jobChecks.title,
      checkCompany: jobChecks.company,
      checkCity: jobChecks.city,
      checkUrl: jobChecks.url,
      checkSource: jobChecks.source,
      description: jobChecks.description,
    })
    .from(jobSaves)
    .leftJoin(jobPosts, eq(jobPosts.id, jobSaves.jobPostId))
    .leftJoin(jobChecks, eq(jobChecks.id, jobSaves.jobCheckId))
    .where(eq(jobSaves.userId, userId))
    .orderBy(asc(jobSaves.updatedAt), asc(jobSaves.id));
  const iso = (d: Date | null) => d?.toISOString() ?? null;
  return rows.map((r) => ({
    source: r.postId || r.checkSource === "board" ? "company_job_board" : "you_added",
    company: r.postCompany ?? r.checkCompany ?? "",
    title: r.postTitle ?? r.checkTitle ?? "",
    city: r.postCity ?? r.checkCity,
    url: r.postUrl ?? r.checkUrl,
    status: MY_JOB_STATUS_LABELS[statusOf(r.stage)],
    saved_at: iso(r.savedAt),
    applied_at: iso(r.appliedAt),
    closed_at: iso(r.closedAt),
    note: r.note,
    description: r.description,
  }));
}

/** How long an added job's text stays on a check the person never saved to My jobs. */
export const UNSAVED_TEXT_KEEP_HOURS = 24;

/**
 * The daily cleanup: a check from "Add a job you found" that never joined My jobs loses its description and link after
 * 24 hours; its skills stay with the resume like any job check. `checkIds` limits it to one test's rows.
 */
export async function clearUnsavedJobText(db: Db = getDb(), now = new Date(), checkIds?: string[]): Promise<{ unsavedJobTextCleared: number }> {
  if (checkIds && checkIds.length === 0) return { unsavedJobTextCleared: 0 };
  const cleared = await db
    .update(jobChecks)
    .set({ description: null, url: null })
    .where(
      and(
        isNotNull(jobChecks.description),
        lt(jobChecks.createdAt, new Date(now.getTime() - UNSAVED_TEXT_KEEP_HOURS * 3600_000)),
        sql`not exists (select 1 from ${jobSaves} where ${jobSaves.jobCheckId} = ${jobChecks.id})`,
        checkIds ? inArray(jobChecks.id, checkIds) : undefined,
      ),
    )
    .returning({ id: jobChecks.id });
  return { unsavedJobTextCleared: cleared.length };
}
