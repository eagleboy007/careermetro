import { z } from "zod";
import { MAX_CHOICE_GOALS } from "./constants";
import { MAX_GAPS } from "./gap";
import { goalChoice } from "./goals";

/**
 * The Map (post-login handoff, section 7): the person's line from Resume through one goal per gap to Match.
 * The server fills it from the gap analysis and the path; the design page and the preview use a synthetic example.
 */
export const mapItem = z.object({
  title: z.string().min(1).max(160),
  detail: z.string().max(120),
});

export const mapGoal = z.object({
  skillId: z.string().min(1),
  name: z.string().min(1).max(80),
  /** Missing skills get learn then prove. Weak or outdated ones get prove only, with brushing up suggested. */
  status: z.enum(["missing", "weak", "outdated"]),
  /** The learn pitstop's courses and tasks are done. That gets the person ready; it never fills the gap. */
  learnDone: z.boolean(),
  /** Accepted proof filled the gap. Always false until proof is stored (build step 5). */
  proved: z.boolean(),
  /** Free courses from the person's path, at most three. Empty before they open it. */
  resources: z.array(mapItem).max(3),
  /** The path's practice task for this skill, if any. */
  practice: z.string().min(1).max(400).nullable(),
  /** The person's goal, for adding proof. Null in example data, where nothing can be saved. */
  goalId: z.string().min(1).max(60).nullable().default(null),
  /** Certificates on our list that fill this goal (dev/proof-plan.md). */
  certificates: z
    .array(z.object({ id: z.string().min(1).max(80), name: z.string().min(1).max(120), issuer: z.string().min(1).max(80) }))
    .max(40)
    .default([]),
  /** Its certificate expired, so it waits for a current one. */
  renew: z.boolean().default(false),
  /** A "Your choice" goal, after the gap goals: not a gap of the role, so it never changes the match. */
  choice: goalChoice.nullable().optional(),
});

export const mapLine = z.object({
  role: z.object({ slug: z.string().min(1), title: z.string().min(1) }),
  /** Links back to the resume, gaps and path. Null in example data. */
  resumeId: z.string().min(1).nullable(),
  skillsFound: z.number().int().min(0),
  goals: z
    .array(mapGoal)
    .max(MAX_GAPS + MAX_CHOICE_GOALS)
    // The role's gap goals come first; "Your choice" goals follow them.
    .refine((goals) => goals.every((g, i) => !g.choice || goals.slice(i + 1).every((n) => n.choice)), { message: "Your choice goals come after the gap goals" }),
  /** Other role lines that cross this one at a shared skill. At most two, so their labels never collide. */
  otherLines: z.array(z.object({ slug: z.string().min(1), title: z.string().min(1), skillId: z.string().min(1) })).max(2),
  /** The person has opened a path, so the courses are picked. */
  pathOpened: z.boolean(),
});

export type MapItem = z.infer<typeof mapItem>;
export type MapGoal = z.infer<typeof mapGoal>;
export type MapLine = z.infer<typeof mapLine>;
