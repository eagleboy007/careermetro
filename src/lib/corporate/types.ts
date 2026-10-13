import type { APPLICATION_EVENT_KINDS, APPLICATION_STAGES, CAN_JOIN, MATCH_WORDS, JOB_STATUSES, JOB_TEAM_ROLES, JOB_WORK_TYPES, JOBS_BLOCKED_TEXT, ORG_REVIEW_STATUSES, ORG_ROLES, ORG_TYPES, REVIEW_DECISIONS } from "@/lib/schemas/constants";
import type { ReportReason } from "@/lib/schemas/inbox";

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
  /** The company's jobs as this person may see them (admins: all; others: jobs they are on). */
  jobs: JobsView;
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

/* The company review page, /admin/companies (CareerMetro's own admins) ------------------------------------------- */

export type ReviewDecision = (typeof REVIEW_DECISIONS)[number];

/** One company on the review list. Company fields and counts only: never anyone's email address or phone. */
export type AdminCompanyView = {
  id: string;
  name: string;
  type: OrgType;
  domain: string;
  website: string | null;
  /** The website's host is not the email domain or a subdomain of it: check it is the same company. */
  websiteOnOtherDomain: boolean;
  city: string | null;
  size: string | null;
  /** ISO day the company signed up, in India time. */
  createdOn: string;
  members: number;
  admins: number;
  /** No active Recruiter admin left. */
  noAdmin: boolean;
  status: OrgReviewStatus;
};

/** A review from the page: words to announce, whether it worked or not. */
export type ReviewResult = { ok: boolean; message: string };
export type ReviewAction = (orgId: string, decision: ReviewDecision) => Promise<ReviewResult>;

/* Jobs (build step 3) ---------------------------------------------------------------------------------------------- */

export type JobStatus = (typeof JOB_STATUSES)[number];
export type JobWorkType = (typeof JOB_WORK_TYPES)[number];
export type JobTeamRole = (typeof JOB_TEAM_ROLES)[number];
/** Why a company can't open jobs now; the words are JOBS_BLOCKED_TEXT. */
export type JobsBlocked = keyof typeof JOBS_BLOCKED_TEXT;

/** What a job asks for, as skill ids from our taxonomy. */
export type JobRequirementsView = { required: string[]; oneOf: string[][]; nice: string[] };

/** One job in Corporate's Jobs list. Colleagues' names only; never anyone's email. */
export type JobListItemView = {
  id: string;
  title: string;
  roleTitle: string;
  city: string;
  workType: JobWorkType;
  status: JobStatus;
  /** Open and seen by candidates on Departures (the company is verified). */
  live: boolean;
  createdOn: string;
  closedOn: string | null;
  ownerName: string | null;
  /** This person's place on the job's team, if any. */
  myRole: JobTeamRole | null;
  canEdit: boolean;
  requiredCount: number;
  /** Open applications (not withdrawn, not Not this time). Null for someone who sees only assigned candidates. */
  applications: number | null;
};

export type JobsView = {
  counts: Record<JobStatus, number>;
  items: JobListItemView[];
  /** Recruiter admins and Hiring HR. */
  canPost: boolean;
  /** Why no job can open now, or null. */
  blocked: JobsBlocked | null;
};

/** A colleague who can be put on a job's team. */
export type ColleagueView = { memberId: string; name: string; role: OrgRole };

export type RoleOptionView = { slug: string; title: string; requirements: JobRequirementsView };
export type SkillOptionView = { id: string; name: string; category: string };

/** The Post a job form's values. Team members are org_members ids. */
export type JobFormValues = {
  jobId: string | null;
  status: JobStatus;
  roleSlug: string;
  title: string;
  workType: JobWorkType;
  city: string;
  requirements: JobRequirementsView;
  hiring: string[];
  interviewers: string[];
};

/** Everything the form needs: the role profiles, our skill list, colleagues and whether a job can open now. */
export type JobFormData = {
  company: string;
  companyVerified: boolean;
  roles: RoleOptionView[];
  skills: SkillOptionView[];
  colleagues: ColleagueView[];
  blocked: JobsBlocked | null;
};

/** A job as candidates see it on Departures. The company's name only: never its members, email or phone. */
export type PostedJobView = {
  id: string;
  title: string;
  company: string;
  city: string;
  workType: JobWorkType;
  /** Skill names. */
  required: string[];
  oneOf: string[][];
  nice: string[];
  postedOn: string;
};

export type JobSaveResult = { ok: true; jobId: string } | { ok: false; error: string };

/** The three ticks before a job opens, as the person left them. The server checks all three are true. */
export type JobHonestyTicks = { real: boolean; noFee: boolean; fair: boolean };

export type JobFormActions = {
  /** Saves the job; with the ticks it also opens it. */
  save: (values: JobFormValues, open: JobHonestyTicks | null) => Promise<JobSaveResult>;
};

export type JobListActions = {
  setStatus: (jobId: string, to: "open" | "paused" | "closed") => Promise<string | null>;
};

export type JobReportAction = (jobId: string, reason: ReportReason, note: string) => Promise<string | null>;

/* Applications and the board (build step 4) ------------------------------------------------------------------------ */

export type ApplicationStage = (typeof APPLICATION_STAGES)[number];
export type CanJoin = (typeof CAN_JOIN)[number];
export type ApplicationEventKind = (typeof APPLICATION_EVENT_KINDS)[number];
/** How one requirement reads for the company: "Proved", "On resume, not proved" or "Not on resume" (MATCH_WORDS). */
export type MatchState = keyof typeof MATCH_WORDS;

/** One line of Match to this job. A "one of these" group is one line naming its skills. Never a resume line. */
export type MatchLineView = { label: string; state: MatchState; group: "required" | "one_of" | "nice" };

/** Match to this job, in words. No score and no ranking (FR-13). */
export type JobMatchView = {
  lines: MatchLineView[];
  /** Required lines (required skills and one-of groups) proved, on the resume, and how many there are. */
  requiredProved: number;
  requiredOnResume: number;
  requiredTotal: number;
};

/**
 * The candidate's public profile as a company sees it: what any visitor would. Job titles, employers and dates, never
 * the lines under them; never email, phone, pay or notice period.
 */
export type CandidateProfileView = {
  name: string;
  /** "Working at Konkan Co-operative Bank", "Looking for a next role", or null with no resume. */
  headline: string | null;
  experience: { title: string; employer: string; dates: string }[];
  education: { qualification: string; institution: string; year: string }[];
  certifications: string[];
};

/** One card on the board. */
export type BoardCardView = {
  applicationId: string;
  name: string;
  headline: string | null;
  stage: ApplicationStage;
  canJoin: CanJoin;
  appliedOn: string;
  match: JobMatchView;
};

/** One line of an application's Activity, and of the candidate's Arrivals. Never names who moved it. */
export type ApplicationEventView = { kind: ApplicationEventKind; stage: ApplicationStage; on: string; note: string | null };

/** A job's board (C7): six lanes. Interviewers see only the candidates assigned to them. */
export type JobBoardView = {
  job: { id: string; title: string; city: string; workType: JobWorkType; status: JobStatus; aiRound: boolean; company: string };
  /** Recruiter admins, and Hiring HR on this job. Interviewers never. */
  canMove: boolean;
  /** The person sees only candidates assigned to them (Interviewers). */
  assignedOnly: boolean;
  cards: BoardCardView[];
  /** Applications the candidate withdrew; the company sees only how many. */
  withdrawn: number;
};

/** The drawer: Profile, Match to this job, Activity. Opening it writes one audit line. */
export type CandidateView = {
  applicationId: string;
  stage: ApplicationStage;
  canJoin: CanJoin;
  appliedOn: string;
  profile: CandidateProfileView;
  match: JobMatchView;
  events: ApplicationEventView[];
};

export type BoardActions = {
  open: (applicationId: string) => Promise<{ ok: true; candidate: CandidateView } | { ok: false; error: string }>;
  move: (applicationId: string, to: ApplicationStage, note: string) => Promise<string | null>;
};

/** The person's own application, on Arrivals. */
export type MyApplicationView = {
  id: string;
  title: string;
  company: string;
  city: string;
  stage: ApplicationStage;
  canJoin: CanJoin;
  appliedOn: string;
  withdrawn: boolean;
  events: ApplicationEventView[];
};

/** Whether the person can apply to a posted job on Departures, or already has. */
export type ApplyState =
  | { kind: "signed_out" }
  | { kind: "no_resume" }
  | { kind: "can_apply" }
  | { kind: "applied"; stage: ApplicationStage; withdrawn: boolean };

export type ApplyAction = (jobId: string, canJoin: CanJoin, consent: boolean) => Promise<string | null>;
export type WithdrawAction = (applicationId: string) => Promise<string | null>;

/* Company chats (build step 5) -------------------------------------------------------------------------------------- */

/** One application's chat in Corporate Messages' list. The preview is the last message anyone wrote, never a system line. */
export type CompanyChatListItem = {
  applicationId: string;
  name: string;
  job: string;
  stage: ApplicationStage;
  preview: string | null;
  at: string | null;
  unread: boolean;
};

/**
 * One message as the company sees it. `team` is someone else on the company's side, named; a deleted account's
 * messages stay, from "The company team".
 */
export type CompanyChatMessage = {
  id?: string;
  by: "me" | "team" | "candidate" | "system";
  who: string;
  text: string;
  at?: string;
  question?: boolean;
};

/**
 * Whether the person can write now, and if not why: `read_only` (Interviewers), `not_allowed` (not on the job's
 * team), `suspended` (the company isn't verified now), `closed` (30 days after the application closed, withdrawn, or
 * blocked by the candidate).
 */
export type CompanyChatState = "open" | "read_only" | "not_allowed" | "suspended" | "closed";

/** One application's chat on the company side. Never the candidate's email, phone, pay or notice period. */
export type CompanyChatView = {
  applicationId: string;
  jobId: string;
  job: string;
  candidate: string;
  stage: ApplicationStage;
  messages: CompanyChatMessage[];
  state: CompanyChatState;
};

/** Corporate Messages: the company's application chats the person may read. */
export type CompanyMessagesView = {
  company: string;
  /** The company's review state: only a verified company writes. */
  status: OrgReviewStatus;
  role: OrgRole;
  items: CompanyChatListItem[];
};

export type CompanyChatActions = {
  /** Sends a message, or a question with `question`. Returns the words to show on failure, or null. */
  send: (applicationId: string, body: string, question: boolean) => Promise<string | null>;
};
