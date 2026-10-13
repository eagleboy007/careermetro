import "server-only";
import { and, asc, count, desc, eq, inArray, isNotNull, isNull, ne, or, gte } from "drizzle-orm";
import { getDb } from "@/db";
import { applicationEvents, applications, auditLogs, consents, gapProofs, jobs, jobTeam, organizations, profiles, users } from "@/db/schema";
import { displayName } from "@/lib/account/name";
import { currentAnalysis } from "@/lib/gaps/current";
import { indiaToday } from "@/lib/goals/store";
import { openApplicationChat } from "@/lib/inbox/store";
import { logEvent } from "@/lib/log";
import { storedProfile, type Profile } from "@/lib/schemas";
import { applicationIdInput, applyInput, moveInput } from "@/lib/schemas/corporate";
import { CAN_JOIN_LABELS } from "@/lib/schemas/constants";
import { LIMITS, takeShared } from "@/lib/shared-limit";
import { jobMatch, publicProfile } from "./match";
import { acceptsApplications, canMoveApplications, canSeeBoard, moveRefusal, type MoveRefusal } from "./rules";
import { activeMembership } from "./store";
import type {
  ApplicationEventKind,
  ApplicationEventView,
  ApplicationStage,
  ApplyState,
  BoardCardView,
  CandidateView,
  JobBoardView,
  JobTeamRole,
  MyApplicationView,
} from "./types";

/*
 * Applications and the board (dev/corporate-plan.md build step 4; handoff 12e and section 9). A person applies to a
 * job posted on CareerMetro with a consent naming the company; the job's team moves them through six lanes; every
 * move is an event the person reads on Arrivals. Company-side reads and writes take the signed-in person's id and
 * re-read their live `org_members` row, role and job team, as the rest of Corporate does. The company sees the
 * person's public profile and Match to this job only (src/lib/corporate/match.ts). Applying never fills a goal and the
 * job's skills never touch the person's goals. Logs carry event names and reasons only: never names, notes or text.
 */

type Db = ReturnType<typeof getDb>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export type ApplicationDeps = { db?: Db; now?: Date };

const DAY = 86_400_000;
/** A company's access to an application ends this long after it closes (plan, Privacy rules). */
export const COMPANY_ACCESS_DAYS = 180;
/** The consent's purpose and policy version: one consent row per application, naming the company through it. */
export const APPLICATION_CONSENT_PURPOSE = "job_application";
export const APPLICATION_POLICY_VERSION = "2026-10-draft";

export type ApplicationError =
  | "invalid"
  | "limit"
  | "not_open"
  | "already"
  | "no_resume"
  | "not_member"
  | "not_allowed"
  | "not_found"
  | MoveRefusal;

export const APPLICATION_ERROR_TEXT: Record<ApplicationError, string> = {
  invalid: "Check the details and try again.",
  limit: "You've applied to a lot of jobs today. Try again tomorrow.",
  not_open: "This job isn't taking applications now.",
  already: "You've already applied to this job. Follow it on Arrivals.",
  no_resume: "Add your resume first, so the company can see how you match this job.",
  not_member: "You don't have access to this company.",
  not_allowed: "Only Recruiter admins, and Hiring HR on this job, can move candidates.",
  not_found: "That application isn't available any more.",
  same_stage: "They're already in that lane.",
  ai_off: "The L1 AI interview is off for this job.",
  withdrawn: "That application isn't available any more.",
  job_closed: "This job is closed. Its candidates can only be moved to Not this time.",
};

export type ApplicationResult<T = object> = ({ ok: true } & T) | { ok: false; error: ApplicationError; message?: string };

const fail = (error: ApplicationError, message?: string) => ({ ok: false as const, error, ...(message ? { message } : {}) });
const isoDay = (d: Date) => d.toISOString().slice(0, 10);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Still within the company's 180 days after closing (or open). */
const companyMaySee = (app: { closedAt: Date | null; companyAccessEndsAt: Date | null }, now: Date) =>
  (!app.companyAccessEndsAt || app.companyAccessEndsAt > now) && (!app.closedAt || now.getTime() - app.closedAt.getTime() < COMPANY_ACCESS_DAYS * DAY);

/* Reading helpers ------------------------------------------------------------------------------------------------- */

/** The latest saved profile of each resume. */
async function latestProfiles(resumeIds: string[], db: Db | Tx): Promise<Map<string, Profile>> {
  if (!resumeIds.length) return new Map();
  const rows = await db
    .select({ resumeId: profiles.resumeId, data: profiles.data })
    .from(profiles)
    .where(inArray(profiles.resumeId, resumeIds))
    .orderBy(asc(profiles.resumeId), desc(profiles.version));
  const out = new Map<string, Profile>();
  for (const r of rows) if (!out.has(r.resumeId)) out.set(r.resumeId, storedProfile(r.data));
  return out;
}

/** Skills with current accepted proof, per person. */
async function provedByUser(userIds: string[], db: Db | Tx, now: Date): Promise<Map<string, Set<string>>> {
  const out = new Map<string, Set<string>>(userIds.map((id) => [id, new Set()]));
  if (!userIds.length) return out;
  const rows = await db
    .selectDistinct({ userId: gapProofs.userId, skillId: gapProofs.skillId })
    .from(gapProofs)
    .where(and(inArray(gapProofs.userId, userIds), eq(gapProofs.status, "accepted"), or(isNull(gapProofs.expiresOn), gte(gapProofs.expiresOn, indiaToday(now)))));
  for (const r of rows) out.get(r.userId)?.add(r.skillId);
  return out;
}

/** Every event of these applications, oldest first. Who made a move is never shown. */
async function eventsOf(applicationIds: string[], db: Db | Tx): Promise<Map<string, ApplicationEventView[]>> {
  const out = new Map<string, ApplicationEventView[]>(applicationIds.map((id) => [id, []]));
  if (!applicationIds.length) return out;
  const rows = await db
    .select({ applicationId: applicationEvents.applicationId, kind: applicationEvents.kind, stage: applicationEvents.stage, note: applicationEvents.note, createdAt: applicationEvents.createdAt })
    .from(applicationEvents)
    .where(inArray(applicationEvents.applicationId, applicationIds))
    .orderBy(asc(applicationEvents.createdAt), asc(applicationEvents.id));
  for (const r of rows) out.get(r.applicationId)?.push({ kind: r.kind, stage: r.stage, on: isoDay(r.createdAt), note: r.note });
  return out;
}

const teamRoleOf = async (jobId: string, userId: string, db: Db | Tx): Promise<JobTeamRole | null> =>
  (await db.select({ role: jobTeam.role }).from(jobTeam).where(and(eq(jobTeam.jobId, jobId), eq(jobTeam.userId, userId))))[0]?.role ?? null;

const event = (tx: Tx, applicationId: string, kind: ApplicationEventKind, stage: ApplicationStage, byUserId: string, now: Date, note: string | null = null) =>
  tx.insert(applicationEvents).values({ applicationId, kind, stage, byUserId, note, createdAt: now });

/* The candidate --------------------------------------------------------------------------------------------------- */

/**
 * Apply to a job posted on CareerMetro: open, from a verified company. Needs the consent tick and a resume read on
 * CareerMetro (the one sent is the current one). Writes the consent, the application and its first event. Someone
 * applying to their own company's job is taken off that job's team, so they never see their own application from the
 * company side. Nothing here reads or writes goals. 20 applications a day per person.
 */
export async function applyToJob(userId: string, raw: unknown, deps: ApplicationDeps = {}): Promise<ApplicationResult<{ applicationId: string }>> {
  const db = deps.db ?? getDb();
  const now = deps.now ?? new Date();
  const parsed = applyInput.safeParse(raw);
  if (!parsed.success) return fail("invalid", parsed.error.issues[0]?.message);
  const input = parsed.data;
  if (!(await takeShared(LIMITS.applicationsPerUserDay, userId, { db, now: now.getTime() }))) {
    logEvent("warn", "application_limited");
    return fail("limit");
  }
  const result = await db
    .transaction(async (tx): Promise<ApplicationResult<{ applicationId: string }>> => {
      const [job] = await tx
        .select({ id: jobs.id, orgId: jobs.orgId, status: jobs.status, orgStatus: organizations.reviewStatus })
        .from(jobs)
        .innerJoin(organizations, eq(organizations.id, jobs.orgId))
        .where(eq(jobs.id, input.jobId))
        .for("share");
      if (!job || !acceptsApplications(job.status, job.orgStatus)) return fail("not_open");
      const [already] = await tx.select({ id: applications.id }).from(applications).where(and(eq(applications.jobId, job.id), eq(applications.userId, userId)));
      if (already) return fail("already");
      const analysis = await currentAnalysis(userId, tx);
      if (!analysis) return fail("no_resume");
      const [consent] = await tx
        .insert(consents)
        .values({ userId, purpose: APPLICATION_CONSENT_PURPOSE, policyVersion: APPLICATION_POLICY_VERSION, givenAt: now })
        .returning({ id: consents.id });
      const [app] = await tx
        .insert(applications)
        .values({ jobId: job.id, orgId: job.orgId, userId, consentId: consent.id, canJoin: input.canJoin, resumeId: analysis.resumeId, createdAt: now })
        .returning({ id: applications.id });
      await event(tx, app.id, "applied", "applied", userId, now);
      // The application's chat with the company, in the person's Inbox from now on (build step 5).
      await openApplicationChat(tx, { applicationId: app.id, orgId: job.orgId, userId }, now);
      // An employee's own job search stays hidden from their company's side: off this job's team.
      const me = await activeMembership(userId, tx);
      if (me?.orgId === job.orgId) await tx.delete(jobTeam).where(and(eq(jobTeam.jobId, job.id), eq(jobTeam.userId, userId)));
      return { ok: true, applicationId: app.id };
    })
    .catch((error: unknown) => {
      // 23505: a second tab applied first.
      if ((error as { cause?: { code?: string } })?.cause?.code === "23505") return fail("already");
      throw error;
    });
  logEvent("info", result.ok ? "application_made" : "application_refused", result.ok ? {} : { reason: result.error });
  return result;
}

/** Withdraw an application: it closes, its consent is withdrawn, and the company sees only that one was withdrawn. */
export async function withdrawApplication(userId: string, raw: unknown, deps: ApplicationDeps = {}): Promise<ApplicationResult> {
  const db = deps.db ?? getDb();
  const now = deps.now ?? new Date();
  const parsed = applicationIdInput.safeParse(raw);
  if (!parsed.success) return fail("invalid");
  const result = await db.transaction(async (tx): Promise<ApplicationResult> => {
    const [app] = await tx
      .select({ id: applications.id, stage: applications.stage, consentId: applications.consentId, withdrawnAt: applications.withdrawnAt, closedAt: applications.closedAt })
      .from(applications)
      .where(and(eq(applications.id, parsed.data.applicationId), eq(applications.userId, userId)))
      .for("update");
    if (!app) return fail("not_found");
    if (app.withdrawnAt) return { ok: true };
    await tx.update(applications).set({ withdrawnAt: now, closedAt: app.closedAt ?? now }).where(eq(applications.id, app.id));
    await tx.update(consents).set({ withdrawnAt: now }).where(and(eq(consents.id, app.consentId), isNull(consents.withdrawnAt)));
    await event(tx, app.id, "withdrawn", app.stage, userId, now);
    return { ok: true };
  });
  logEvent("info", result.ok ? "application_withdrawn" : "application_withdraw_refused", result.ok ? {} : { reason: result.error });
  return result;
}

/** The person's own applications for Arrivals, newest first, each with every event. */
export async function myApplications(userId: string, deps: { db?: Db } = {}): Promise<MyApplicationView[]> {
  const db = deps.db ?? getDb();
  const rows = await db
    .select({
      id: applications.id,
      title: jobs.title,
      company: organizations.name,
      city: jobs.city,
      stage: applications.stage,
      canJoin: applications.canJoin,
      createdAt: applications.createdAt,
      withdrawnAt: applications.withdrawnAt,
    })
    .from(applications)
    .innerJoin(jobs, eq(jobs.id, applications.jobId))
    .innerJoin(organizations, eq(organizations.id, applications.orgId))
    .where(eq(applications.userId, userId))
    .orderBy(desc(applications.createdAt));
  const events = await eventsOf(
    rows.map((r) => r.id),
    db,
  );
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    company: r.company,
    city: r.city,
    stage: r.stage,
    canJoin: r.canJoin,
    appliedOn: isoDay(r.createdAt),
    withdrawn: r.withdrawnAt !== null,
    events: events.get(r.id) ?? [],
  }));
}

/** Whether the person can apply to each of these posted jobs on Departures, or already has. */
export async function applyStates(userId: string | null, jobIds: string[], deps: { db?: Db } = {}): Promise<Record<string, ApplyState>> {
  if (!userId) return Object.fromEntries(jobIds.map((id) => [id, { kind: "signed_out" } as const]));
  const db = deps.db ?? getDb();
  const [mine, analysis] = await Promise.all([
    jobIds.length
      ? db
          .select({ jobId: applications.jobId, stage: applications.stage, withdrawnAt: applications.withdrawnAt })
          .from(applications)
          .where(and(eq(applications.userId, userId), inArray(applications.jobId, jobIds)))
      : Promise.resolve([]),
    currentAnalysis(userId, db),
  ]);
  const byJob = new Map(mine.map((a) => [a.jobId, a]));
  return Object.fromEntries(
    jobIds.map((id): [string, ApplyState] => {
      const a = byJob.get(id);
      if (a) return [id, { kind: "applied", stage: a.stage, withdrawn: a.withdrawnAt !== null }];
      return [id, analysis ? { kind: "can_apply" } : { kind: "no_resume" }];
    }),
  );
}

/* The company ----------------------------------------------------------------------------------------------------- */

type Access = { me: NonNullable<Awaited<ReturnType<typeof activeMembership>>>; teamRole: JobTeamRole | null; canMove: boolean };

/** The person's live access to one of their company's jobs, or why not. */
async function jobAccess(userId: string, jobId: string, db: Db | Tx): Promise<ApplicationResult<Access>> {
  const me = await activeMembership(userId, db);
  if (!me) return fail("not_member");
  const teamRole = await teamRoleOf(jobId, userId, db);
  if (!canSeeBoard(me.role, teamRole)) return fail("not_allowed");
  return { ok: true, me, teamRole, canMove: canMoveApplications(me.role, teamRole) };
}

/**
 * A job's board: its open and closed applications in six lanes, each with the candidate's name, headline, Can join and
 * Match to this job. Never the person's own application, withdrawn ones (only their count), deleted accounts, or
 * applications closed more than 180 days ago. Interviewers see only candidates assigned to them; assignments come
 * with interviews (build step 6), so until then they see none.
 */
export async function jobBoard(userId: string, jobId: string, deps: ApplicationDeps = {}): Promise<ApplicationResult<{ board: JobBoardView }>> {
  const db = deps.db ?? getDb();
  const now = deps.now ?? new Date();
  if (!UUID.test(jobId)) return fail("not_found");
  const me = await activeMembership(userId, db);
  if (!me) return fail("not_member");
  const [job] = await db
    .select({ id: jobs.id, title: jobs.title, city: jobs.city, workType: jobs.workType, status: jobs.status, aiRound: jobs.aiRound, requirements: jobs.requirements })
    .from(jobs)
    .where(and(eq(jobs.id, jobId), eq(jobs.orgId, me.orgId)));
  if (!job) return fail("not_found");
  const access = await jobAccess(userId, jobId, db);
  if (!access.ok) return access;
  const assignedOnly = !access.canMove;
  const rows = assignedOnly
    ? []
    : await db
        .select({
          id: applications.id,
          userId: applications.userId,
          name: users.name,
          stage: applications.stage,
          canJoin: applications.canJoin,
          resumeId: applications.resumeId,
          createdAt: applications.createdAt,
          closedAt: applications.closedAt,
          companyAccessEndsAt: applications.companyAccessEndsAt,
        })
        .from(applications)
        .innerJoin(users, eq(users.id, applications.userId))
        .where(and(eq(applications.jobId, jobId), ne(applications.userId, userId), isNull(applications.withdrawnAt), isNull(users.deletionRequestedAt)))
        .orderBy(asc(applications.createdAt));
  const seen = rows.filter((r) => companyMaySee(r, now));
  const [profileOf, proved, [withdrawn]] = await Promise.all([
    latestProfiles([...new Set(seen.map((r) => r.resumeId).filter((id): id is string => !!id))], db),
    provedByUser(
      seen.map((r) => r.userId),
      db,
      now,
    ),
    db
      .select({ n: count() })
      .from(applications)
      .where(and(eq(applications.jobId, jobId), isNotNull(applications.withdrawnAt), ne(applications.userId, userId))),
  ]);
  const cards: BoardCardView[] = seen.map((r) => {
    const profile = r.resumeId ? (profileOf.get(r.resumeId) ?? null) : null;
    return {
      applicationId: r.id,
      name: displayName(r.name),
      headline: publicProfile(displayName(r.name), profile, now).headline,
      stage: r.stage,
      canJoin: r.canJoin,
      appliedOn: isoDay(r.createdAt),
      match: jobMatch(job.requirements, profile, proved.get(r.userId) ?? new Set(), now),
    };
  });
  return {
    ok: true,
    board: {
      job: { id: job.id, title: job.title, city: job.city, workType: job.workType, status: job.status, aiRound: job.aiRound, company: me.orgName },
      canMove: access.canMove,
      assignedOnly,
      cards,
      withdrawn: assignedOnly ? 0 : (withdrawn?.n ?? 0),
    },
  };
}

/**
 * One application the person may see on the company side, with its job and the company's state, or why not. Shared
 * with company chats (chats-store.ts), so the board and Messages answer to the same live access rules.
 */
export async function visibleApplication(userId: string, applicationId: string, db: Db | Tx, now: Date, lock = false) {
  if (!UUID.test(applicationId)) return fail("not_found");
  const me = await activeMembership(userId, db);
  if (!me) return fail("not_member");
  const q = db
    .select({
      id: applications.id,
      jobId: applications.jobId,
      userId: applications.userId,
      stage: applications.stage,
      canJoin: applications.canJoin,
      resumeId: applications.resumeId,
      createdAt: applications.createdAt,
      closedAt: applications.closedAt,
      companyAccessEndsAt: applications.companyAccessEndsAt,
      withdrawnAt: applications.withdrawnAt,
      name: users.name,
      deleted: users.deletionRequestedAt,
      aiRound: jobs.aiRound,
      jobStatus: jobs.status,
      requirements: jobs.requirements,
      jobTitle: jobs.title,
      orgId: applications.orgId,
      orgStatus: organizations.reviewStatus,
    })
    .from(applications)
    .innerJoin(jobs, eq(jobs.id, applications.jobId))
    .innerJoin(users, eq(users.id, applications.userId))
    .innerJoin(organizations, eq(organizations.id, applications.orgId))
    .where(and(eq(applications.id, applicationId), eq(applications.orgId, me.orgId)));
  const [app] = lock ? await q.for("update", { of: applications }) : await q;
  // The person's own application, a deleted account, or one past the company's 180 days reads as not there.
  if (!app || app.userId === userId || app.deleted || !companyMaySee(app, now)) return fail("not_found");
  const access = await jobAccess(userId, app.jobId, db);
  if (!access.ok) return fail(access.error);
  // Interviewers see only candidates assigned to them; none are until interviews exist (build step 6).
  if (!access.canMove) return fail("not_found");
  return { ok: true as const, app, access };
}

/**
 * The candidate drawer: public profile, Match to this job and Activity. Each opening writes one audit line (who,
 * which application, when; nothing of the person). A withdrawn application shows nothing.
 */
export async function openCandidate(userId: string, raw: unknown, deps: ApplicationDeps = {}): Promise<ApplicationResult<{ candidate: CandidateView }>> {
  const db = deps.db ?? getDb();
  const now = deps.now ?? new Date();
  const parsed = applicationIdInput.safeParse(raw);
  if (!parsed.success) return fail("invalid");
  const found = await visibleApplication(userId, parsed.data.applicationId, db, now);
  if (!found.ok) return found;
  const { app, access } = found;
  // A withdrawn application gives nothing away: the company sees only a count of them.
  if (app.withdrawnAt) return fail("not_found");
  const [profileOf, proved, events] = await Promise.all([
    latestProfiles(app.resumeId ? [app.resumeId] : [], db),
    provedByUser([app.userId], db, now),
    eventsOf([app.id], db),
  ]);
  const profile = app.resumeId ? (profileOf.get(app.resumeId) ?? null) : null;
  await db.insert(auditLogs).values({ actor: `member:${access.me.memberId}`, action: "candidate_viewed", target: `application:${app.id}`, createdAt: now });
  logEvent("info", "candidate_viewed");
  return {
    ok: true,
    candidate: {
      applicationId: app.id,
      stage: app.stage,
      canJoin: app.canJoin,
      appliedOn: isoDay(app.createdAt),
      profile: publicProfile(displayName(app.name), profile, now),
      match: jobMatch(app.requirements, profile, proved.get(app.userId) ?? new Set(), now),
      events: events.get(app.id) ?? [],
    },
  };
}

/**
 * Move a candidate to another lane. Recruiter admins, and Hiring HR on the job; never Interviewers. Not this time needs
 * a note the candidate reads on Arrivals and closes the application; moving it on opens it again. The L1 AI lane is
 * refused while the job's AI round is off. Each move writes one event.
 */
export async function moveApplication(userId: string, raw: unknown, deps: ApplicationDeps = {}): Promise<ApplicationResult> {
  const db = deps.db ?? getDb();
  const now = deps.now ?? new Date();
  const parsed = moveInput.safeParse(raw);
  if (!parsed.success) return fail("invalid", parsed.error.issues[0]?.message);
  const { applicationId, to, note } = parsed.data;
  const result = await db.transaction(async (tx): Promise<ApplicationResult> => {
    const found = await visibleApplication(userId, applicationId, tx, now, true);
    if (!found.ok) return found;
    const { app, access } = found;
    if (!access.canMove) return fail("not_allowed");
    if (app.withdrawnAt) return fail("not_found");
    const refusal = moveRefusal(app.stage, to, { aiRound: app.aiRound, withdrawn: false, jobStatus: app.jobStatus });
    if (refusal) return fail(refusal);
    const closing = to === "not_this_time";
    await tx
      .update(applications)
      .set({ stage: to, closedAt: closing ? now : null, companyAccessEndsAt: null })
      .where(eq(applications.id, app.id));
    await event(tx, app.id, "moved", to, userId, now, closing ? note : null);
    return { ok: true };
  });
  logEvent("info", result.ok ? "application_moved" : "application_move_refused", result.ok ? { to } : { to, reason: result.error });
  return result;
}

/** The person's applications and their events, for "Download your data": which companies have them, and every step. */
export async function exportApplications(userId: string, db: Db = getDb()) {
  const rows = await db
    .select({
      id: applications.id,
      company: organizations.name,
      job: jobs.title,
      stage: applications.stage,
      canJoin: applications.canJoin,
      createdAt: applications.createdAt,
      withdrawnAt: applications.withdrawnAt,
      closedAt: applications.closedAt,
      consentGivenAt: consents.givenAt,
      consentWithdrawnAt: consents.withdrawnAt,
    })
    .from(applications)
    .innerJoin(jobs, eq(jobs.id, applications.jobId))
    .innerJoin(organizations, eq(organizations.id, applications.orgId))
    .innerJoin(consents, eq(consents.id, applications.consentId))
    .where(eq(applications.userId, userId))
    .orderBy(asc(applications.createdAt));
  const ids = rows.map((r) => r.id);
  const events = ids.length
    ? await db
        .select({ applicationId: applicationEvents.applicationId, kind: applicationEvents.kind, stage: applicationEvents.stage, note: applicationEvents.note, createdAt: applicationEvents.createdAt })
        .from(applicationEvents)
        .where(inArray(applicationEvents.applicationId, ids))
        .orderBy(asc(applicationEvents.createdAt))
    : [];
  return rows.map(({ id, ...r }) => ({
    ...r,
    canJoin: CAN_JOIN_LABELS[r.canJoin],
    events: events.filter((e) => e.applicationId === id).map((e) => ({ kind: e.kind, stage: e.stage, note: e.note, createdAt: e.createdAt })),
  }));
}
