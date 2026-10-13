import { z } from "zod";

/** At most this many Nearby lines are shown (dev/nearby-lines-plan.md). */
export const NEARBY_MAX = 4;
/** A role is a Nearby line once the person shares at least this share of its key skills, and at least two of them. */
export const NEARBY_MIN_SHARE = 0.5;
export const NEARBY_MIN_SHARED = 2;

const name = z.string().min(1).max(120);

/**
 * A role near the person's target (pending item 24a): how many of its key skills (the required skills as the matcher
 * counts them) the person already shares, and the rest split into "on your resume, not yet shown in work" and "to add".
 * Plain code over the role profiles and the matcher; it never changes goals, gaps or the match.
 */
export const nearbyLine = z
  .object({
    slug: z.string().regex(/^[a-z0-9-]+$/),
    title: name,
    /** The role's experience band, as the Roles page says it ("2 to 5 years"). */
    experience: z.string().min(1).max(40),
    /** Key skills the resume shows with evidence, or that current accepted proof covers. */
    shared: z.number().int().min(0),
    total: z.number().int().min(1),
    sharedSkills: z.array(z.object({ name, byProof: z.boolean() })).max(40),
    /** Listed on the resume with no job or project behind them: not counted as shared. */
    onResume: z.array(name).max(40),
    /** Missing, or shown only long ago (`outdated`). */
    toAdd: z.array(z.object({ name, outdated: z.boolean() })).max(40),
    /** Skills of this role that are gaps on the person's own line, in line order: where it can cross on the Map. */
    crossSkillIds: z.array(z.string().min(1)).max(40),
  })
  .strict()
  .refine((l) => l.shared === l.sharedSkills.length, { message: "shared counts the shared skills" })
  .refine((l) => l.shared + l.onResume.length + l.toAdd.length === l.total, { message: "every key skill is shared, on the resume or to add" });

export const nearbyLines = z
  .object({
    lines: z.array(nearbyLine).max(NEARBY_MAX),
    /** With no Nearby line, the role that comes closest, so the empty state can say how close. Null with none at all. */
    closest: z
      .object({ slug: z.string().min(1), title: name, shared: z.number().int().min(1), total: z.number().int().min(1) })
      .refine((c) => c.shared <= c.total)
      .nullable(),
  })
  .strict()
  .refine((n) => n.lines.length === 0 || n.closest === null, { message: "closest is only for the empty state" });

export type NearbyLine = z.infer<typeof nearbyLine>;
export type NearbyLines = z.infer<typeof nearbyLines>;
