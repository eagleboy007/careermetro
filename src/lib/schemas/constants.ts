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
