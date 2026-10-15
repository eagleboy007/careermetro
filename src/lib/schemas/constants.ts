/**
 * Constants the browser needs, kept apart from the Zod schemas so client components can import them without
 * shipping Zod and every schema to phones. The schema files re-export them.
 */
export const WORK_TYPES = ["Full time", "Part time", "Freelance"] as const;
export const APPLY_STAGES = ["Applied", "Heard back", "Interview", "Offer"] as const;
export const STORY_BOXES = ["Ownership", "Problem solving", "Delivering results", "Learning", "Working with others", "Speaking up"] as const;
export const SMART = ["S", "M", "A", "R", "T"] as const;
export const LIFE_ROWS = ["journey", "education", "work", "certificates", "interests"] as const;
/** FR-15: the weekly hours a user can pick, and the default. */
export const WEEKLY_HOURS = [3, 5, 8, 10] as const;
export const DEFAULT_WEEKLY_HOURS = 5;
export const USER_STATES = ["no_resume", "first", "returning"] as const;
/** "Check against a job" (role-suggest-plan.md part B): how long a pasted posting and its labels may be. */
export const JOB_TEXT_MIN = 200;
export const JOB_TEXT_MAX = 12_000;
export const JOB_COMPANY_MAX = 100;
export const JOB_TITLE_MAX = 120;

/* Corporate (dev/corporate-plan.md, handoff 12e and 12f) ------------------------------------------------------------ */

export const ORG_TYPES = ["company", "college", "training_partner"] as const;
export const ORG_TYPE_LABELS: Record<(typeof ORG_TYPES)[number], string> = { company: "Company", college: "College", training_partner: "Training partner" };
/** pending until CareerMetro checks the company by hand; suspended stops it until it is reviewed again. */
export const ORG_REVIEW_STATUSES = ["pending", "verified", "suspended"] as const;
export const ORG_STATUS_LABELS: Record<(typeof ORG_REVIEW_STATUSES)[number], string> = {
  pending: "Waiting for verification",
  verified: "Verified company",
  suspended: "Suspended",
};
/** What the company review page (/admin/companies) can do to a company. */
export const REVIEW_DECISIONS = ["verify", "suspend"] as const;
export const ORG_ROLES = ["admin", "hiring", "interviewer"] as const;
export const ORG_ROLE_LABELS: Record<(typeof ORG_ROLES)[number], string> = { admin: "Recruiter admin", hiring: "Hiring HR", interviewer: "Interviewer" };
/** One code check serves both: joining a company, and later the verified current job (handoff 12d). */
export const WORK_EMAIL_PURPOSES = ["org_member", "current_job"] as const;
export const ORG_INVITE_KINDS = ["invite", "request"] as const;
export const ORG_SIZES = ["1 to 10", "11 to 50", "51 to 200", "201 to 1,000", "More than 1,000"] as const;
export const ORG_INDUSTRIES = ["Financial services and fintech", "IT services", "Cybersecurity", "Software product", "Education", "Other"] as const;
export const ORG_ABOUT_MAX_CHARS = 400;
/** On every company screen, job and application chat (dev/corporate-plan.md, Abuse and compliance). */
export const ANTI_SCAM_LINE = "Companies never ask for money, OTPs or bank details. Report anyone who does.";
/** What a person sees when someone tries to set up a company whose domain is taken. Never names its admins. */
export const DOMAIN_TAKEN_TEXT = "This company is already on CareerMetro. Ask one of its Recruiter admins to add you.";
/** Re-checking a work email (every 180 days) while no email sender exists (production before pending item 21). */
export const RECHECK_CLOSED_TEXT =
  "We can't send work-email codes yet, so your company access stays paused until we can. Your personal CareerMetro account isn't affected.";

export const SIGNUP_CLOSED_TEXT = "Company sign-up opens soon.";
/** "Your choice" goals one person may have: goals they add themselves, such as from a job check's "Only for this job". */
export const MAX_CHOICE_GOALS = 20;
/** A role someone looked for and we don't have (role_requests): its title is cut to this many characters. */
export const ROLE_REQUEST_TITLE_MAX = 80;

/* Corporate jobs (dev/corporate-plan.md build step 3; handoff 12g, C9) ---------------------------------------------- */

export const JOB_STATUSES = ["draft", "open", "paused", "closed"] as const;
export const JOB_STATUS_LABELS: Record<(typeof JOB_STATUSES)[number], string> = { draft: "Draft", open: "Open", paused: "Paused", closed: "Closed" };
export const JOB_WORK_TYPES = ["full_time", "part_time", "freelance"] as const;
/** As Departures shows work type (WORK_TYPES). */
export const JOB_WORK_TYPE_LABELS: Record<(typeof JOB_WORK_TYPES)[number], (typeof WORK_TYPES)[number]> = {
  full_time: "Full time",
  part_time: "Part time",
  freelance: "Freelance",
};
export const JOB_TEAM_ROLES = ["owner", "hiring", "interviewer"] as const;
export const JOB_TEAM_ROLE_LABELS: Record<(typeof JOB_TEAM_ROLES)[number], string> = { owner: "Owner", hiring: "Hiring HR", interviewer: "Interviewer" };
/** Handoff 12g: Required at most 8. One-of groups and nice-to-have are capped so a job stays readable. */
export const JOB_REQUIRED_MAX = 8;
export const JOB_ONE_OF_GROUPS_MAX = 4;
export const JOB_ONE_OF_SIZE_MIN = 2;
export const JOB_ONE_OF_SIZE_MAX = 6;
export const JOB_NICE_MAX = 10;
export const JOB_CITY_MAX = 60;
/** People on one job's team besides its owner. */
export const JOB_TEAM_MAX = 20;
/** The three ticks before a job opens (handoff 12g). */
export const JOB_HONESTY_CHECKS = [
  { key: "real", text: "This job is real and open now." },
  { key: "noFee", text: "We never ask candidates for a fee, deposit or paid training." },
  { key: "fair", text: "The requirements don't screen people out by gender, religion, caste, age, disability or marital status." },
] as const;
/** Why a company can't open jobs now, in words (jobsBlocked in src/lib/corporate/rules.ts). */
export const JOBS_BLOCKED_TEXT = {
  pending: "Jobs can open once we've verified your company, usually within one working day. You can save drafts meanwhile.",
  suspended: "This company is suspended while we review it, so its jobs can't open and open jobs are hidden from candidates.",
  second_admin: "Add a second Recruiter admin to open jobs. Every company keeps two, so it is never locked out.",
} as const;
/** On a posted job when applying isn't possible from here: signed out, or the /design page. */
export const APPLY_SOON_TEXT = "Sign in to apply on CareerMetro.";

/* Applications and the board (dev/corporate-plan.md build step 4; handoff 12e and section 9) ------------------------- */

/** The six lanes, in board order. Candidates see the same stages on Arrivals. */
export const APPLICATION_STAGES = ["applied", "shortlisted", "ai", "team", "offer", "not_this_time"] as const;
export const APPLICATION_STAGE_LABELS: Record<(typeof APPLICATION_STAGES)[number], string> = {
  applied: "Applied",
  shortlisted: "Shortlisted",
  ai: "Level 1 AI interview",
  team: "Level 2 team",
  offer: "Offer",
  not_this_time: "Not this time",
};
/** One line under each lane's name on the board. */
export const APPLICATION_STAGE_HINTS: Record<(typeof APPLICATION_STAGES)[number], string> = {
  applied: "New, not reviewed",
  shortlisted: "Picked for interview",
  ai: "Off until the AI interviewer exists",
  team: "With your interviewers",
  offer: "Sent, waiting on reply",
  not_this_time: "Closed with a note",
};
/** "Can join" (never the notice period itself), as the candidate picks it on applying. */
export const CAN_JOIN = ["now", "30", "60", "90"] as const;
export const CAN_JOIN_LABELS: Record<(typeof CAN_JOIN)[number], string> = {
  now: "Immediately",
  "30": "Within 30 days",
  "60": "30 to 60 days",
  "90": "60 to 90 days",
};
/** What an application event records: the application, a move between lanes, or the candidate withdrawing. */
export const APPLICATION_EVENT_KINDS = ["applied", "moved", "withdrawn"] as const;
/** "Not this time" needs a note the candidate reads on Arrivals. */
export const NOT_THIS_TIME_NOTE_MIN = 10;
export const NOT_THIS_TIME_NOTE_MAX = 500;
/** How a job's requirement reads for a company: worked out by the deterministic matcher, never by the model. */
export const MATCH_WORDS = { proved: "Proved", on_resume: "On resume, not proved", not_on_resume: "Not on resume" } as const;
/** The consent screen on applying (DPDP Act): what the company sees, and what it never sees. */
export const APPLY_SHARES = [
  "Your name, and your experience and education as job titles, employers and dates",
  "Certifications on your resume",
  "How your skills match this job, in words: Proved, On resume, or Not on resume",
  "Which of this job's Express apply criteria your accepted proof meets",
  "When you can join, and your note if you write one",
] as const;
export const APPLY_NEVER = "Never sent: your gaps, path, goals, pay, phone, email, notice period, resume lines, streak or other applications.";

/**
 * The preview is a snapshot, but the company's drawer reads the profile and proof live (T51, decision in
 * dev/express-apply-plan.md), so the preview says so.
 */
export const PREVIEW_LIVE_NOTE = "If you update your profile or add proof later, the company sees the latest.";

/* Express apply (pending item 16; dev/express-apply-plan.md) --------------------------------------------------------- */

/** The note sent with an application, after trimming. */
export const APPLICATION_NOTE_MAX = 300;
/** Why a note was refused: same rule as the headline, since a company reads it. */
export const APPLICATION_NOTE_CONTACT_TEXT = "Leave out email addresses and phone numbers. The company writes to you in the application's chat.";
export const APPLICATION_NOTE_LONG_TEXT = `Keep the note to ${APPLICATION_NOTE_MAX} characters.`;
/** Certificates a job can ask for as Express apply criteria. Verified skills come from its Required skills (8 at most). */
export const JOB_CRITERIA_CERTIFICATES_MAX = 3;
/** How one Express apply criterion reads: met by current accepted proof, or not yet. Neutral words, never a gap colour. */
export const CRITERIA_WORDS = { met: "Met", not_met: "Not yet" } as const;
/** Unmet criteria warn and never block (dev/express-apply-plan.md). */
export const CRITERIA_WARN_TEXT = "Not met yet doesn't stop you. You can still apply, and proof you add later shows to the company once it is accepted.";

/* Interviews (dev/corporate-plan.md build step 6; handoff 12b, 12e and section 9) ---------------------------------- */

/** The rounds a company books. Level 2 team for now; the L1 AI round waits for the AI interviewer (FR-33). */
export const INTERVIEW_ROUNDS = ["team"] as const;
export const INTERVIEW_ROUND_LABELS: Record<(typeof INTERVIEW_ROUNDS)[number], string> = { team: "Level 2 team" };
/** An interview's state. `done` is read from the clock: an accepted interview whose time has passed. */
export const INTERVIEW_STATUSES = ["proposed", "accepted", "declined", "done", "cancelled"] as const;
export const INTERVIEW_STATUS_LABELS: Record<(typeof INTERVIEW_STATUSES)[number], string> = {
  proposed: "Waiting for an answer",
  accepted: "Accepted",
  declined: "Declined",
  done: "Done",
  cancelled: "Cancelled",
};
/** What an interviewer recommends with their feedback. People write feedback; the model never does. */
export const INTERVIEW_RECOMMENDATIONS = ["yes", "not_sure", "no"] as const;
export const INTERVIEW_RECOMMENDATION_LABELS: Record<(typeof INTERVIEW_RECOMMENDATIONS)[number], string> = {
  yes: "Move forward",
  not_sure: "Not sure",
  no: "Don't move forward",
};
/** How long a booked interview runs, in minutes. Each offered slot is an hour, so all of these fit in one. */
export const INTERVIEW_MINUTES = [30, 45, 60] as const;
/** The start times on the slot picker, India time. Each slot is an hour long. */
export const SLOT_TIMES = ["10:00", "11:00", "12:00", "14:00", "15:00", "16:00", "17:00", "18:00"] as const;
export const SLOT_MINUTES = 60;
/** "Ask for times" offers this many weekdays, starting the day after the ask. */
export const SLOT_DAYS = 5;
/** The most times a candidate offers in one answer. */
export const SLOTS_MAX = 12;
/** A slot can be offered or booked only this many hours ahead. */
export const SLOT_LEAD_HOURS = 2;
/** Interviewers on one interview. */
export const INTERVIEWERS_MAX = 5;
/** Feedback length. */
export const FEEDBACK_MIN = 20;
export const FEEDBACK_MAX = 2000;

/* Overview, audit and clean-up (dev/corporate-plan.md build step 7) ------------------------------------------------- */

/**
 * What a company's audit line can record: an action on the company, its team, a job or an application. Ids and these
 * names only, never words someone typed. Moves between lanes are `moved_<stage>`.
 */
export const COMPANY_AUDIT_ACTIONS = [
  "company_created",
  "company_page_saved",
  "role_invited",
  "invite_cancelled",
  "request_approved",
  "request_declined",
  "member_joined",
  "member_removed",
  "job_opened",
  "job_paused",
  "job_closed",
  "job_edited",
  "candidate_viewed",
  ...APPLICATION_STAGES.map((s) => `moved_${s}` as const),
  "times_asked",
  "interview_booked",
  "interview_cancelled",
  "interview_accepted",
  "interview_declined",
  "feedback_saved",
  // Let companies find me (dev/companies-find-me-plan.md): each with the job searched from as its target.
  "people_searched",
  "found_profile_viewed",
  "found_request_sent",
  // Reads and sends the security review (2026-10-13) found unaudited: ids only, never what was read or written.
  "board_viewed",
  "chat_read",
  "found_chat_read",
  "message_sent",
  "found_message_sent",
  "access_rechecked",
  "access_requested",
] as const;
export type CompanyAuditAction = (typeof COMPANY_AUDIT_ACTIONS)[number];
export const COMPANY_AUDIT_LABELS: Record<CompanyAuditAction, string> = {
  company_created: "Set up the company",
  company_page_saved: "Saved the company page",
  role_invited: "Gave a role by work email",
  invite_cancelled: "Cancelled a role waiting for its code",
  request_approved: "Approved an access request",
  request_declined: "Declined an access request",
  member_joined: "Confirmed their work email and joined",
  member_removed: "Removed a role",
  job_opened: "Opened a job",
  job_paused: "Paused a job",
  job_closed: "Closed a job",
  job_edited: "Edited a live job",
  candidate_viewed: "Opened a candidate",
  moved_applied: "Moved to Applied",
  moved_shortlisted: "Moved to Shortlisted",
  moved_ai: "Moved to Level 1 AI interview",
  moved_team: "Moved to Level 2 team",
  moved_offer: "Moved to Offer",
  moved_not_this_time: "Moved to Not this time",
  times_asked: "Asked for interview times",
  interview_booked: "Booked an interview",
  interview_cancelled: "Cancelled an interview",
  interview_accepted: "Accepted an interview",
  interview_declined: "Declined an interview",
  feedback_saved: "Saved interview feedback",
  people_searched: "Searched for people from a job",
  found_profile_viewed: "Opened a profile found in a search",
  found_request_sent: "Sent a message request to someone found in a search",
  board_viewed: "Opened a job's board",
  chat_read: "Read a candidate's chat",
  found_chat_read: "Read a chat with someone found in a search",
  message_sent: "Sent a message to a candidate",
  found_message_sent: "Sent a message to someone found in a search",
  access_rechecked: "Confirmed their work email again",
  access_requested: "Asked for access",
};
/** Audit lines on one page of the company's audit view. */
export const AUDIT_PAGE_SIZE = 50;
/** The daily clean-up works in batches of this many rows, and at most this many batches per job per run. */
export const CLEANUP_BATCH = 500;
export const CLEANUP_MAX_BATCHES = 20;
/** Offered times that were never booked are deleted this many days after they passed. */
export const OFFERED_TIMES_KEEP_DAYS = 7;

/* Account settings, part 2 (dev/account-settings-plan.md, handoff 12c) ----------------------------------------------- */

export const USERNAME_MIN = 3;
export const USERNAME_MAX = 30;
/** After a username is saved, the next change waits this long; the old link redirects for USERNAME_REDIRECT_DAYS. */
export const USERNAME_CHANGE_DAYS = 30;
export const USERNAME_REDIRECT_DAYS = 14;
export const HEADLINE_MAX = 80;
/** Pay is kept in lakh a year, two decimals. */
export const PAY_MAX_LAKH = 999;
/** Who can open the person's profile at /u/<username>. Nobody else can until they choose (decided 2026-10-13). */
export const PROFILE_VISIBILITIES = ["signed_in", "line", "only_me"] as const;
export const PROFILE_VISIBILITY_LABELS: Record<(typeof PROFILE_VISIBILITIES)[number], string> = {
  signed_in: "Everyone signed in",
  line: "People on your line",
  only_me: "Only you",
};
/** When the ride reminder would go out, India time, once email is on (pending item 21). */
export const RIDE_REMINDERS = ["18:30", "19:30", "20:30", "21:30", "off"] as const;

/* Let companies find me (pending item 19, dev/companies-find-me-plan.md) ------------------------------------------------ */

/** Experience bands a company can filter a search by, in years, from the confirmed profile. */
export const FIND_BANDS = ["0-2", "2-5", "5-10", "10+"] as const;
export const FIND_BAND_LABELS: Record<(typeof FIND_BANDS)[number], string> = {
  "0-2": "Up to 2 years",
  "2-5": "2 to 5 years",
  "5-10": "5 to 10 years",
  "10+": "10 years or more",
};
/** People on one page of results. */
export const FIND_PAGE_SIZE = 20;
/** Pages a search can reach: 50 pages of 20, enough for the beta. */
export const FIND_PAGES_MAX = 50;
/** Opted-in people read per search, before ranking (a database-side ranking replaces this before the beta outgrows it). */
export const FIND_SCAN_MAX = 2000;
/** How long the person sees which companies opened their profile; older views are deleted by the daily clean-up. */
export const FIND_VIEWS_KEEP_DAYS = 30;
/** The consent row's purpose while the switch is on (withdrawn when it goes off). */
export const FIND_CONSENT_PURPOSE = "company_discovery";
/** The wording the "Let companies find me" consent was given under (Settings > Privacy). */
export const FIND_POLICY_VERSION = "2026-10-draft";
