import { z } from "zod";
import { MATCH_HOURS } from "./constants";
export { MATCH_HOURS, DEFAULT_MATCH_HOURS, MATCH_MAX_WEEKS } from "./constants";

/** The hours a week Match works its weeks out at (handoff 12i): 3, 6 or 10. */
export const matchHours = z.literal(MATCH_HOURS);

const name = z.string().min(1).max(120);

/**
 * One role on Match (FR-24, handoff 12i): how many of its required skills the person has met or proved, the goals it
 * still needs and the path hours left on them. Plain code over the same matcher as the Gaps page and Nearby lines; it
 * never changes goals, gaps or the train. Weeks are not stored here: they follow the hours a week picked on the page.
 */
export const matchRole = z
  .strictObject({
    slug: z.string().regex(/^[a-z0-9-]+$/),
    title: name,
    /** The person's target role: the one their line is built for. */
    onLine: z.boolean(),
    /** Required skills, as the matcher counts them (a "one of these" group counts once). */
    required: z.number().int().min(1),
    /** Required skills the resume shows with evidence, or that current accepted proof covers. */
    met: z.number().int().min(0),
    /** The goals this role still needs, by name, in the Gaps page's order. */
    open: z.array(name).max(40),
    /** Path hours left on those goals. */
    hours: z.number().int().min(0),
    /** Open jobs for this role in Departures; null when they couldn't be read. */
    jobs: z.number().int().min(0).nullable(),
  })
  .refine((r) => r.met + r.open.length === r.required, { message: "every required skill is met or open" })
  .refine((r) => r.open.length > 0 || r.hours === 0, { message: "a role with nothing open has no hours left" });

export const matchList = z
  .strictObject({
    /** The resume behind the person's current gaps, for "Gaps for this role". Null in example data. */
    resumeId: z
      .string()
      .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
      .nullable(),
    /** Where the hours select starts: the person's own hours a week, to the nearest choice. */
    weeklyHours: matchHours,
    roles: z.array(matchRole).max(1000),
  })
  .refine((l) => new Set(l.roles.map((r) => r.slug)).size === l.roles.length, { message: "a role is listed once" })
  .refine((l) => l.roles.filter((r) => r.onLine).length <= 1, { message: "only the target role is on the line" });

export type MatchHours = z.infer<typeof matchHours>;
export type MatchRole = z.infer<typeof matchRole>;
export type MatchList = z.infer<typeof matchList>;
