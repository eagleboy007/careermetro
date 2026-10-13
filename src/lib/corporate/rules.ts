import type { ApplicationStage, JobsBlocked, JobStatus, JobTeamRole, OrgReviewStatus, OrgRole } from "@/lib/corporate/types";

/*
 * Company rules (dev/corporate-plan.md; admin rule from Milin, 2026-10-12, replacing plan call D). Pure: the store
 * reads the live rows and asks these.
 */

const DAY = 86_400_000;

/** A new company has this long to add a second Recruiter admin before it can't open new jobs. */
export const SECOND_ADMIN_DAYS = 14;
/** A member types their work email again after this long (handoff 12d). */
export const RECHECK_DAYS = 180;
/** An invite or an approved request waits this long for its code. */
export const INVITE_DAYS = 14;
/** Once a company has this many admins, it never goes below. */
export const MIN_ADMINS = 2;

export const secondAdminDueAt = (createdAt: Date): Date => new Date(createdAt.getTime() + SECOND_ADMIN_DAYS * DAY);
export const recheckDueAt = (verifiedAt: Date): Date => new Date(verifiedAt.getTime() + RECHECK_DAYS * DAY);
export const inviteExpiresAt = (createdAt: Date): Date => new Date(createdAt.getTime() + INVITE_DAYS * DAY);

/** Whole days left to add the second admin, never below 0. Null once there are two admins. */
export function secondAdminDaysLeft(org: { adminCount: number; secondAdminDueAt: Date | null }, now: Date): number | null {
  if (org.adminCount >= MIN_ADMINS || !org.secondAdminDueAt) return null;
  return Math.max(0, Math.ceil((org.secondAdminDueAt.getTime() - now.getTime()) / DAY));
}

export type OrgForJobs = { reviewStatus: OrgReviewStatus; adminCount: number; secondAdminDueAt: Date | null };

/**
 * Why the company can't open a job now, or null when it can: CareerMetro hasn't verified it (or suspended it), or it
 * is past 14 days with one Recruiter admin. Jobs already open stay open after the 14 days; a suspended company's open
 * jobs are hidden (isLive).
 */
export function jobsBlocked(org: OrgForJobs, now: Date): JobsBlocked | null {
  if (org.reviewStatus === "suspended") return "suspended";
  if (org.reviewStatus !== "verified") return "pending";
  if (org.adminCount >= MIN_ADMINS) return null;
  return !!org.secondAdminDueAt && now < org.secondAdminDueAt ? null : "second_admin";
}

/** Whether the company may open a job: verified, and two Recruiter admins or still within 14 days of signing up. */
export const canOpenJobs = (org: OrgForJobs, now: Date): boolean => jobsBlocked(org, now) === null;

/** Recruiter admins and Hiring HR post jobs; Interviewers never do. */
export const canPostJobs = (role: OrgRole): boolean => role === "admin" || role === "hiring";

/** Admins edit any of the company's jobs; Hiring HR only a job they own or are Hiring HR on; Interviewers none. */
export function canEditJob(role: OrgRole, teamRole: JobTeamRole | null): boolean {
  if (role === "admin") return true;
  return role === "hiring" && (teamRole === "owner" || teamRole === "hiring");
}

const MOVES: Record<JobStatus, JobStatus[]> = { draft: ["open", "closed"], open: ["paused", "closed"], paused: ["open", "closed"], closed: [] };

/** A job moves draft → open → paused ⇄ open → closed; a draft can be closed unopened; closed is final. */
export const statusMoveRefusal = (from: JobStatus, to: JobStatus): "bad_move" | null => (MOVES[from].includes(to) ? null : "bad_move");

/** Why a job can't open now: the company's state first, then a job with no required skill. */
export function openRefusal(org: OrgForJobs, requirements: { required: string[] }, now: Date): JobsBlocked | "needs_required" | null {
  return jobsBlocked(org, now) ?? (requirements.required.length === 0 ? "needs_required" : null);
}

/** Candidates see a job only while it is open and its company is verified (a suspended company's jobs are hidden). */
export const isLive = (status: JobStatus, orgStatus: OrgReviewStatus): boolean => status === "open" && orgStatus === "verified";

export type RemovalRefusal = "keep_two_admins" | "last_admin";

/**
 * Whether a member with `role` can lose it when the company has `adminCount` active admins. Removing an admin must
 * leave at least two once there are two, and can never leave none.
 */
export function removalRefusal(role: OrgRole, adminCount: number): RemovalRefusal | null {
  if (role !== "admin") return null;
  if (adminCount <= 1) return "last_admin";
  return adminCount - 1 < MIN_ADMINS ? "keep_two_admins" : null;
}

/** Only Recruiter admins manage the team. */
export const canManageTeam = (role: OrgRole): boolean => role === "admin";

/* Applications and the board (build step 4) ------------------------------------------------------------------------ */

/** A job's board: Recruiter admins see every job's; anyone else only a job they are on. */
export const canSeeBoard = (role: OrgRole, teamRole: JobTeamRole | null): boolean => role === "admin" || teamRole !== null;

/** Moving candidates between lanes: the same people who may change the job. Interviewers never. */
export const canMoveApplications = canEditJob;

export type MoveRefusal = "same_stage" | "ai_off" | "withdrawn";

/**
 * Why a move can't happen. Any lane may follow any other (Not this time can be opened again), except the L1 AI lane
 * while the job's AI round is off, and nothing moves once the candidate has withdrawn. The note for Not this time is
 * checked by the schema.
 */
export function moveRefusal(from: ApplicationStage, to: ApplicationStage, app: { aiRound: boolean; withdrawn: boolean }): MoveRefusal | null {
  if (app.withdrawn) return "withdrawn";
  if (from === to) return "same_stage";
  if (to === "ai" && !app.aiRound) return "ai_off";
  return null;
}

/** People can apply only to a job candidates can see: open, from a verified company (not pending or suspended). */
export const acceptsApplications = isLive;
