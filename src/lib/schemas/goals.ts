import { z } from "zod";

/**
 * Goals and proof (post-login handoff, section 6; dev/goals-proofs-plan.md). Each gap becomes one goal per person and
 * skill. Only accepted proof fills a gap: watching, reading or ticking tasks never does.
 */
export const GOAL_STATUSES = ["active", "met", "skipped"] as const;
/** `gap` goals come from the person's gap analysis. `user` goals are "Your choice" and never change a match. */
export const GOAL_SOURCES = ["gap", "user"] as const;
export const PROOF_TYPES = ["skill_check", "certification", "work"] as const;
export const PROOF_STATUSES = ["pending", "accepted", "rejected"] as const;
export const PROOF_VERIFIERS = ["app", "credly", "issuer", "person"] as const;
export const STEP_KINDS = ["learn", "prove"] as const;

export const goalState = z.enum(GOAL_STATUSES);
export const proofStatus = z.enum(PROOF_STATUSES);

/**
 * What a proof points at. Structured fields only, never resume text: a certificate's issuer and credential id, the
 * role on the person's profile a manager confirms, or the skill check they passed.
 */
export const proofEvidence = z.discriminatedUnion("type", [
  z.object({ type: z.literal("skill_check"), checkId: z.string().min(1).max(80) }),
  z.object({
    type: z.literal("certification"),
    issuer: z.string().trim().min(1).max(120),
    credentialId: z.string().trim().min(1).max(120),
    url: z
      .url({ protocol: /^https$/ })
      .max(500)
      .nullable(),
  }),
  z.object({
    type: z.literal("work"),
    employer: z.string().trim().min(1).max(120),
    title: z.string().trim().min(1).max(120),
  }),
]);

export const userGoal = z.object({
  id: z.string().min(1),
  skillId: z.string().min(1),
  source: z.enum(GOAL_SOURCES),
  status: goalState,
  position: z.number().int().min(1),
  /** A proof for this skill was accepted. A goal met because a newer resume shows the skill is not proved. */
  proved: z.boolean(),
});

export type GoalState = z.infer<typeof goalState>;
export type ProofStatus = z.infer<typeof proofStatus>;
export type ProofEvidence = z.infer<typeof proofEvidence>;
export type UserGoal = z.infer<typeof userGoal>;
