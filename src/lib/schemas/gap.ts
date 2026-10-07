import { z } from "zod";

/** How a required skill compares with the user's resume (FR-11). */
export const gapStatus = z.enum(["met", "missing", "weak", "outdated"]);
export type GapStatus = z.infer<typeof gapStatus>;

/**
 * One gap as shown to the user. Every gap cites the resume line it came from,
 * or says plainly that nothing in the resume covers it (FR-12).
 */
export const gap = z.object({
  skillId: z.string().min(1),
  skillName: z.string().min(1),
  status: gapStatus.exclude(["met"]),
  resumeQuote: z.string().min(1).nullable(),
  requirement: z.string().min(1),
  explanation: z.string().min(1),
});
export type Gap = z.infer<typeof gap>;

export const gapAnalysis = z.object({
  /** The role profile's slug; analyses from a pasted job description will need their own field. */
  roleSlug: z.string().min(1),
  gaps: z.array(gap).max(10),
  metSkillIds: z.array(z.string()),
  /** Nice-to-have skills and where the resume stands on each, for the "bonus" list. */
  niceToHave: z.array(z.object({ skillId: z.string().min(1), skillName: z.string().min(1), status: gapStatus })).default([]),
  readiness: z.object({
    headline: z.string().min(1),
    explanation: z.string().min(1),
    estimatedHours: z.number().int().nonnegative(),
  }),
});
export type GapAnalysis = z.infer<typeof gapAnalysis>;
