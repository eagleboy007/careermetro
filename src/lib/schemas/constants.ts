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
  "When you can join",
] as const;
export const APPLY_NEVER = "Never shared: your email, phone, pay, notice period, resume lines, goals, path, streak or other applications.";
