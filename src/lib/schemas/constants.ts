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
