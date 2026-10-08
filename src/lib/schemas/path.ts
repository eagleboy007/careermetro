import { z } from "zod";
import { gapStatus } from "./gap";

/** FR-15: the weekly hours a user can pick, and the default. */
export const WEEKLY_HOURS = [3, 5, 8, 10] as const;
export const DEFAULT_WEEKLY_HOURS = 5;
export const weeklyHours = z.literal(WEEKLY_HOURS);

/**
 * One step of a path as the builder plans it (FR-16). The order, the hours and the resources are decided in code;
 * reason and proofTask start as template text and may later be rewritten by the model, never the rest.
 */
export const plannedStep = z.object({
  position: z.number().int().min(1).max(6),
  skillId: z.string().min(1),
  skillName: z.string().min(1),
  status: gapStatus.exclude(["met"]),
  hours: z.number().int().positive(),
  /** The week this step starts in, counting from 1, at the chosen weekly hours. */
  week: z.number().int().positive(),
  /** Catalog resource ids (database uuids), best first. Empty when the catalog has no healthy link for the skill. */
  resourceIds: z.array(z.string().uuid()).max(3),
  reason: z.string().min(1),
  proofTask: z.string().min(1),
});
export type PlannedStep = z.infer<typeof plannedStep>;

export const plannedPath = z.object({
  weeklyHours,
  steps: z.array(plannedStep).min(1).max(6),
  totalHours: z.number().int().positive(),
  weeks: z.number().int().positive(),
  /** Gaps left out to keep the path short, for "N more gaps for later". */
  deferredSkillIds: z.array(z.string()),
});
export type PlannedPath = z.infer<typeof plannedPath>;
