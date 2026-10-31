import { z } from "zod";
import { GOAL_CERTIFICATES_MAX, MAX_CHOICE_GOALS, OWN_PITSTOPS_PER_GOAL } from "./constants";
import { MAX_GAPS } from "./gap";
import { goalChoice, notForMeOffer } from "./goals";
import { nearbyLines } from "./nearby";
import { ownPitstopOptions, ownPitstops } from "./pitstops";

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
    .array(z.object({ id: z.string().min(1).max(80), name: z.string().min(1).max(120), issuer: z.string().min(1).max(80), lifetime: z.literal(true).optional() }))
    .max(GOAL_CERTIFICATES_MAX)
    .default([]),
  /** Its certificate expired, so it waits for a current one. */
  renew: z.boolean().default(false),
  /**
   * A certificate for this goal was rejected after review (/admin/proofs, FR-44): it couldn't be confirmed for this
   * person, so the goal says so and points to Grievances. Only while the goal isn't proved.
   */
  notConfirmed: z.boolean().default(false),
  /** Set on a "Your choice" goal (in `choiceGoals`): not a gap of the role, so it never changes the match or the train. */
  choice: goalChoice.nullable().optional(),
  /** "Not for me" (FR-48): the person skipped this goal. It stays a gap, gets no tasks, and the train passes it. */
  skipped: z.boolean().optional(),
  /** What "Not for me" offers on this goal (FR-48); null or absent when nothing is. */
  notForMe: notForMeOffer.nullable().optional(),
  /**
   * Pitstops the person added on this goal (FR-58, `path_steps.source` = user), drawn as a spur labelled ADDED BY YOU.
   * They get the person ready and never fill the gap, move the train or count toward Match. Absent in older data.
   */
  ownPitstops: ownPitstops.optional(),
  /** Free catalog courses offered when adding one: the next unused ones for the goal's skill. Open goals only. */
  pitstopOptions: ownPitstopOptions.optional(),
});

/**
 * The person's earlier line after a change of destination (handoff section 14, open decision 5;
 * docs/plans/change-destination-plan.md): the role they aimed for before, greyed out, with the new line branching off
 * at Gaps. Nothing on it moves the train or counts toward Match. Goals are kept by the person, not the role, so their
 * proof, learn ticks and own pitstops wait there for a switch back.
 */
export const previousLine = z.object({
  role: z.object({ slug: z.string().min(1), title: z.string().min(1) }),
  /** Gaps of the earlier line that are not on the new one, in the earlier line's order. */
  left: z
    .array(
      z.object({
        skillId: z.string().min(1),
        name: z.string().min(1).max(80),
        /** Accepted proof filled it; it counts for every role that asks for the skill. */
        proved: z.boolean(),
        /** Pitstops the person added on that goal (FR-58), kept for a switch back. */
        ownPitstops: z.number().int().min(0).max(OWN_PITSTOPS_PER_GOAL),
      }),
    )
    .max(MAX_GAPS),
  /** Gaps of the earlier line that are on the new line too: their proof, ticks and own pitstops came along. */
  shared: z.number().int().min(0).max(MAX_GAPS),
});

export const mapLine = z.object({
  role: z.object({ slug: z.string().min(1), title: z.string().min(1) }),
  /** Links back to the resume, gaps and path. Null in example data. */
  resumeId: z.string().min(1).nullable(),
  skillsFound: z.number().int().min(0),
  /** The line itself: one goal per gap. Only these carry the train and count toward Match. */
  goals: z
    .array(mapGoal)
    .max(MAX_GAPS)
    .refine((goals) => goals.every((g) => !g.choice), { message: "Your choice goals are never on the main line" }),
  /**
   * "Your choice" goals the person added (handoff section 7: spurs labelled "YOUR CHOICE"). Off the main line: they
   * never move the train or count toward Match. Skipped ones are left out.
   */
  choiceGoals: z
    .array(mapGoal)
    .max(MAX_CHOICE_GOALS)
    .refine((goals) => goals.every((g) => g.choice), { message: "every Your choice goal is tagged" })
    .optional(),
  /**
   * Other role lines that cross this one at a shared skill. At most two, so their labels never collide. `nearby` marks a
   * Nearby line (dev/nearby-lines-plan.md), drawn as an interchange station; neither kind moves the train or counts.
   */
  otherLines: z
    .array(z.object({ slug: z.string().min(1), title: z.string().min(1), skillId: z.string().min(1), nearby: z.boolean().optional() }))
    .max(2),
  /** Nearby lines: roles that share at least half their key skills with the person. Absent in older example data. */
  nearby: nearbyLines.optional(),
  /** The person has opened a path, so the courses are picked. */
  pathOpened: z.boolean(),
  /** The earlier line after a change of destination; null or absent when the person never changed it. */
  previous: previousLine.nullable().optional(),
});

export type MapItem = z.infer<typeof mapItem>;
export type MapGoal = z.infer<typeof mapGoal>;
export type MapLine = z.infer<typeof mapLine>;
export type PreviousLine = z.infer<typeof previousLine>;
