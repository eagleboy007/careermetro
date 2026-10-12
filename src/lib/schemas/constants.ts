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
