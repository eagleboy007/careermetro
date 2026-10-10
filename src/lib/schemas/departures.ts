import { z } from "zod";
import { gapStatus } from "./gap";

/**
 * Departures (post-login handoff, section 8): roles from public company job boards and posts the person pastes, each
 * with readiness in words and the gaps between the person and the role. Until the job-post tables are approved
 * (dev/departures-plan.md) the page runs on a synthetic example.
 */
export const WORK_TYPES = ["Full time", "Part time", "Freelance"] as const;
export const workType = z.enum(WORK_TYPES);

export const jobPost = z.object({
  id: z.string().min(1).max(60),
  role: z.string().min(1).max(120),
  company: z.string().min(1).max(80),
  /** A city, or "Remote". */
  city: z.string().min(1).max(60),
  workType: workType.default("Full time"),
  /** Part time and freelance only: "20 h a week, evenings", "2-week project, fixed fee". */
  hours: z.string().max(80).nullable().default(null),
  experience: z.string().max(40),
  posted: z.string().max(40),
  /** Required skills the person is missing or has weak evidence for, in the order of their line. */
  gaps: z.array(z.object({ status: gapStatus.exclude(["met", "outdated"]), name: z.string().min(1).max(60) })).max(12),
  /** Required skills the person already shows. */
  have: z.array(z.string().min(1).max(60)).max(20),
  /** Goals on the person's line before this role boards. 0 is "Boarding now". */
  goalsBefore: z.number().int().min(0),
  /** The role the person's line is built for. */
  destination: z.boolean().default(false),
  /** One plain sentence on how far away it is. */
  why: z.string().max(240),
  /** The posting on the company's own site. Null in example data. */
  applyUrl: z.url({ protocol: /^https$/ }).nullable().default(null),
  /** The company takes Express apply. Express apply itself comes with the employer side. */
  express: z.boolean().default(false),
});

export const APPLY_STAGES = ["Applied", "Heard back", "Interview", "Offer"] as const;

export type WorkType = z.infer<typeof workType>;
export type JobPost = z.infer<typeof jobPost>;
export type JobPostInput = z.input<typeof jobPost>;
