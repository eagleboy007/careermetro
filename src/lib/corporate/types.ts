import type { APPLICATION_EVENT_KINDS, APPLICATION_STAGES, CAN_JOIN, INTERVIEW_RECOMMENDATIONS, INTERVIEW_ROUNDS, INTERVIEW_STATUSES, MATCH_WORDS, JOB_STATUSES, JOB_TEAM_ROLES, JOB_WORK_TYPES, JOBS_BLOCKED_TEXT, ORG_REVIEW_STATUSES, ORG_ROLES, ORG_TYPES, REVIEW_DECISIONS } from "@/lib/schemas/constants";
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
  /** Interviews, the shared phone (for that interview's team only) and whether the person can book (build step 6). */
  interviews: CandidateInterviewsView;
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
  /** Interviews the company booked, for Next up, the 10-day strip and answering (build step 6). */
  interviews: MyInterviewView[];
  /** A phone the person shared for an interview is on file with the company. */
  phoneShared: boolean;
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
  /**
   * An "Ask for times" card: the times the candidate offered in answer, or null while waiting. `ended` once there is
   * nothing left to book from it: `passed` when the times offered have gone by (the daily clean-up deletes them a week
   * later), `unanswered` when every day asked has gone by without an answer.
   */
  times?: { offered: string[] | null; ended?: "passed" | "unanswered" };
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
  /** The person may "Ask for times" now (build step 6): the job team of a verified company, the application open. */
  canAskTimes: boolean;
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
  /** "Ask for times" (build step 6). */
  askTimes?: (applicationId: string) => Promise<string | null>;
};

/* Interviews (build step 6) ----------------------------------------------------------------------------------------- */

export type InterviewRound = (typeof INTERVIEW_ROUNDS)[number];
export type InterviewStatusView = (typeof INTERVIEW_STATUSES)[number];
export type InterviewRecommendation = (typeof INTERVIEW_RECOMMENDATIONS)[number];

/** One interviewer's feedback, as the company reads it. Never shown to the candidate. Written by a person. */
export type FeedbackView = { by: string; mine: boolean; recommendation: InterviewRecommendation; text: string; on: string };

/** One interview in the candidate drawer and on Corporate Interviews. Times are India time, worked out on the server. */
export type CompanyInterviewView = {
  id: string;
  round: InterviewRound;
  /** "Wed 14 Oct, 11:00". */
  when: string;
  /** "11:00 to 11:45". */
  range: string;
  minutes: number;
  status: InterviewStatusView;
  interviewers: string[];
  /** The candidate chose to share a phone with this interview's team. */
  phoneShared: boolean;
  /** The job team reads every interviewer's feedback; an interviewer reads only their own. */
  feedback: FeedbackView[];
  /** The person is on this interview and can write or change their feedback now. */
  canGiveFeedback: boolean;
  /** The person arranges interviews and this one can still be cancelled. */
  canCancel: boolean;
};

/** What the drawer's Interviews tab needs besides the list. */
export type CandidateInterviewsView = {
  interviews: CompanyInterviewView[];
  /** The phone the candidate shared, only for that interview's team while the application is open. */
  phone: string | null;
  /** The person may ask for times and book (job team of a verified company, application open). */
  canSchedule: boolean;
  /** Offered times still ahead and not booked. */
  offeredTimes: number;
  /** An "Ask for times" is waiting for the candidate. */
  waitingForTimes: boolean;
};

/** One of the candidate's offered times on the scheduler. */
export type OfferedSlotView = { id: string; key: string; day: string; time: string; label: string; taken: boolean };

/** Someone who can interview: on the job's team, or a Recruiter admin. Their own interviews show as busy (no candidate). */
export type InterviewerOptionView = { memberId: string; name: string; role: OrgRole; busyKeys: string[]; thisWeek: number };

/** The scheduler: the candidate's offered times on a week grid, the round, the length and the interviewers. */
export type SchedulerView = {
  applicationId: string;
  jobId: string;
  job: string;
  candidate: string;
  company: string;
  /** Why the person can't book now, in words; null when they can. */
  refusal: string | null;
  days: { day: string; label: [string, string] }[];
  times: string[];
  slots: OfferedSlotView[];
  team: InterviewerOptionView[];
  /** The team's interviews in the next 7 days: when and who, never the candidate. */
  teamWeek: { when: string; who: string }[];
  interviews: CompanyInterviewView[];
  waitingForTimes: boolean;
};

export type ScheduleValues = { applicationId: string; slotId: string; minutes: number; interviewers: string[] };

export type SchedulerActions = {
  schedule: (values: ScheduleValues) => Promise<string | null>;
  askTimes: (applicationId: string) => Promise<string | null>;
  cancel: (interviewId: string) => Promise<string | null>;
  feedback: InterviewActions["feedback"];
};

/** One line of Corporate Interviews. */
export type InterviewListItem = CompanyInterviewView & { applicationId: string; jobId: string; candidate: string; job: string; day: string; assigned: boolean };

export type CompanyInterviewsView = { company: string; role: OrgRole; items: InterviewListItem[] };

/** Drawer actions for interviews (build step 6). */
export type InterviewActions = {
  askTimes: (applicationId: string) => Promise<string | null>;
  cancel: (interviewId: string) => Promise<string | null>;
  feedback: (interviewId: string, recommendation: InterviewRecommendation, text: string) => Promise<string | null>;
};

/** One interview on the candidate's Arrivals. Never names who at the company booked it. */
export type MyInterviewView = {
  id: string;
  round: InterviewRound;
  /** India date, for the 10-day strip and Next up. */
  day: string;
  when: string;
  range: string;
  minutes: number;
  status: InterviewStatusView;
  canRespond: boolean;
  phoneShared: boolean;
};

export type RespondValues = { interviewId: string; answer: "accept" | "decline"; sharePhone: boolean; phone: string };

export type ArrivalsActions = {
  withdraw: WithdrawAction;
  respond: (values: RespondValues) => Promise<string | null>;
  stopSharing: (applicationId: string) => Promise<string | null>;
};

/* Overview and audit (build step 7) --------------------------------------------------------------------------------- */

/** Applications in each of the six lanes. */
export type LaneCounts = Record<ApplicationStage, number>;

/**
 * Corporate Overview: counts of what this member may see now, under the same rules as the board, Messages and
 * Interviews. Interviewers count only the candidates whose live interview they are on (`assignedOnly`).
 */
export type CompanyOverviewView = {
  role: OrgRole;
  assignedOnly: boolean;
  openJobs: number;
  /** Applications made in the last 7 days. */
  newApplications: number;
  /** Interviews booked (waiting for an answer or accepted), India time. */
  interviewsToday: number;
  /** This India week, Monday to Sunday. */
  interviewsThisWeek: number;
  /** Company chats with a message this member hasn't read. */
  unreadChats: number;
  /** Totals over the jobs below. */
  lanes: LaneCounts;
  /** Open and paused jobs this member may see, newest first, with their lanes. */
  jobs: { id: string; title: string; city: string; status: "open" | "paused"; lanes: LaneCounts; total: number }[];
};

/** Who did something, as an admin reads it: a member's name and role, the candidate, or a former member. */
export type AuditWhoView = { kind: "member"; name: string; role: OrgRole } | { kind: "candidate" } | { kind: "former" } | { kind: "system" };

/** What it was done to: the company, a member, a role waiting for its code, a job (by title) or an application (by id and job title). */
export type AuditOnView =
  | { kind: "company"; name: string }
  | { kind: "member"; name: string; role: OrgRole | null }
  | { kind: "invite"; role: OrgRole | null; domain: string | null }
  | { kind: "job"; ref: string; title: string | null }
  | { kind: "application"; ref: string; job: string | null };

export type AuditLineView = {
  id: string;
  /** "13 Oct 2026, 15:30", India time. */
  at: string;
  who: AuditWhoView;
  /** A fixed label: "Booked an interview". */
  action: string;
  on: AuditOnView;
};

/** The company's audit view, Recruiter admins only, newest first. `next` opens the page before the last line shown. */
export type CompanyAuditView = { company: string; lines: AuditLineView[]; next: string | null };
