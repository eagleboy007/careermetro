import type { OrgReviewStatus, OrgRole } from "@/lib/corporate/types";

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
 * Whether the company may open a new job: CareerMetro has verified it, and it has two Recruiter admins or is still
 * within 14 days of signing up. Jobs come in build step 3; they ask this.
 */
export function canOpenJobs(org: OrgForJobs, now: Date): boolean {
  if (org.reviewStatus !== "verified") return false;
  if (org.adminCount >= MIN_ADMINS) return true;
  return !!org.secondAdminDueAt && now < org.secondAdminDueAt;
}

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
