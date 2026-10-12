import type { ORG_REVIEW_STATUSES, ORG_ROLES, ORG_TYPES } from "@/lib/schemas/constants";

/*
 * What the Corporate screens get. Plain data, safe to hand to client components: no email address of anyone, and no
 * phone, pay or notice period, which Corporate never holds.
 */

export type OrgRole = (typeof ORG_ROLES)[number];
export type OrgReviewStatus = (typeof ORG_REVIEW_STATUSES)[number];
export type OrgType = (typeof ORG_TYPES)[number];

export type TeamMemberView = {
  id: string;
  name: string;
  role: OrgRole;
  /** ISO date the work email was confirmed. Shown as "Verified on <date>"; the address itself is never kept. */
  workEmailVerifiedOn: string;
  /** True once the 180-day re-check is due. */
  recheckDue: boolean;
  isYou: boolean;
};

export type InviteView = { id: string; role: OrgRole; domain: string; createdOn: string; expiresOn: string };

export type AccessRequestView = { id: string; name: string; domain: string; createdOn: string };

export type CorporateHomeView = {
  org: { name: string; type: OrgType; domain: string; website: string | null; status: OrgReviewStatus; createdOn: string; hasPage: boolean };
  me: { role: OrgRole; since: string };
  adminCount: number;
  /** Days left to add a second admin; null once there are two. */
  secondAdminDaysLeft: number | null;
  canOpenJobs: boolean;
  /** Admins only. */
  team: { members: TeamMemberView[]; invites: InviteView[]; requests: AccessRequestView[] } | null;
};

/** How work-email codes reach people now: by mail once a sender is set up, on screen in test mode, or not at all. */
export type CodeDelivery = "email" | "test" | "off";

/** A server action's answer to a form: an error to show, or what happened. `testCode` only ever in test mode. */
export type CodeStep = { ok: true; testCode?: string } | { ok: false; error: string; taken?: boolean };

export type CorporateActions = {
  startSignup: (form: SignupDetails) => Promise<CodeStep>;
  finishSignup: (form: SignupDetails, code: string) => Promise<{ ok: true } | { ok: false; error: string }>;
  askForAccess: (workEmail: string) => Promise<{ ok: true } | { ok: false; error: string }>;
  savePage: (page: CompanyPageDetails) => Promise<string | null>;
  /** Invites the second Recruiter admin. */
  inviteAdmin: (workEmail: string) => Promise<string | null>;
};

export type TeamActions = {
  invite: (workEmail: string, role: OrgRole) => Promise<string | null>;
  cancelInvite: (inviteId: string) => Promise<string | null>;
  answerRequest: (requestId: string, answer: OrgRole | "decline") => Promise<string | null>;
  remove: (memberId: string) => Promise<string | null>;
};

export type JoinActions = {
  startJoin: (workEmail: string) => Promise<CodeStep>;
  finishJoin: (workEmail: string, code: string) => Promise<{ ok: true } | { ok: false; error: string }>;
};

/** The company details typed in step 1 of sign-up (handoff 12f). */
export type SignupDetails = {
  type: OrgType;
  legalName: string;
  name: string;
  website: string;
  workEmail: string;
  size: string;
  city: string;
};

/** Step 3, the company page. All optional. */
export type CompanyPageDetails = { about: string; industry: string; offices: string; gstinOrCin: string };
