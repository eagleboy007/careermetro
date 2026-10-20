import { z } from "zod";

/*
 * Elite, free in the beta (FR-50, handoff 12l, docs/plans/elite-plan.md). A switch, not a purchase: there is no card,
 * no checkout, no payment provider and no price id anywhere. No row in user_plans means Free.
 */

export { ELITE_CHANGES_PER_DAY, ELITE_NEEDED_MESSAGE } from "./constants";

/** "Turn on Elite" (true) or "Turn off" (false). */
export const eliteSwitchInput = z.boolean();
/** "Show the Elite badge on my profile". */
export const eliteBadgeInput = z.boolean();

/** One person's plan as stored: `eliteSince` null is Free. */
export const planRow = z.strictObject({
  eliteSince: z.date().nullable(),
  badgeShown: z.boolean(),
});
export type PlanRow = z.infer<typeof planRow>;

/** What the screens get. The badge is on only while Elite is on and the person turned it on. */
export const planView = z
  .strictObject({
    elite: z.boolean(),
    badgeShown: z.boolean(),
    /** The India date Elite was turned on ("19 Oct 2026"), or null on Free. */
    since: z.string().min(1).max(40).nullable(),
  })
  .refine((v) => v.elite || (!v.badgeShown && v.since === null), { message: "Free has no badge and no start date" })
  .refine((v) => !v.elite || v.since !== null, { message: "Elite has a start date" });
export type PlanView = z.infer<typeof planView>;

export const ELITE_ERRORS = ["invalid", "limit", "not_elite"] as const;
export type EliteError = (typeof ELITE_ERRORS)[number];
export type EliteResult = { ok: true; plan: PlanView } | { ok: false; error: EliteError };
