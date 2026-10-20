import { z } from "zod";
import { gapStatus } from "./gap";
import { WORK_TYPES } from "./constants";
export { WORK_TYPES, APPLY_STAGES } from "./constants";

/**
 * Departures (post-login handoff, section 8): roles from public company job boards and posts the person pastes, each
 * with readiness in words and the gaps between the person and the role. Signed in, the roles come from the daily feed
 * of reviewed public job boards (docs/plans/departures-live-plan.md, job_posts); signed out, from a synthetic example.
 */
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
  /** The library role the post is for, for its interview prep (FR-50). Null when the bank has no such role yet. */
  roleSlug: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/).max(80).nullable().default(null),
  /** The posting on the company's own site. Null in example data. Express apply is only for jobs posted on CareerMetro. */
  applyUrl: z.url({ protocol: /^https$/ }).nullable().default(null),
  /** The post left its company's board: it stays in Saved and Applied, with no Apply button, and drops off All. */
  closed: z.boolean().default(false),
  /** Why fit isn't shown for this one post (it names too few skills we know). Null when fit can show. */
  fitNote: z.string().max(120).nullable().default(null),
});

/* The person's own lists (job_saves): every input is checked here and scoped to the session user by the store. */

const postId = z.uuid();
/** The bookmark: `saved` true saves the post, false takes it off Saved. */
export const saveInput = z.object({ postId, saved: z.boolean() }).strict();
/** The tracker: 1 Applied, 2 Heard back, 3 Interview, 4 Offer (APPLY_STAGES). */
export const stageInput = z.object({ postId, stage: z.number().int().min(1).max(4) }).strict();
/** "I didn't apply": clears the tracker. */
export const clearStageInput = z.object({ postId }).strict();

/** One row of `departures` in Download your data (added in export version 26). */
export const departureExport = z.object({
  title: z.string(),
  company: z.string(),
  city: z.string(),
  url: z.string(),
  saved_at: z.string().nullable(),
  stage: z.enum(["Applied", "Heard back", "Interview", "Offer"]).nullable(),
  applied_at: z.string().nullable(),
  closed: z.boolean(),
});


export type WorkType = z.infer<typeof workType>;
export type JobPost = z.infer<typeof jobPost>;
export type JobPostInput = z.input<typeof jobPost>;
export type DepartureExport = z.infer<typeof departureExport>;
