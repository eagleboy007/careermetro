import { z } from "zod";

/** Career levels L1 to L8 (C26, docs/plans/signup-levels-plan.md). The level comes from resume facts, never a title. */
export const LEVELS = ["L1", "L2", "L3", "L4", "L5", "L6", "L7", "L8"] as const;
export const levelId = z.enum(LEVELS);
export type LevelId = z.infer<typeof levelId>;

const draftMark = {
  /** Drafted by Data research; true until a domain expert signs it off in the review pack. */
  draft: z.boolean(),
  reviewedBy: z.string().min(1).nullable(),
  updatedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
};

/** src/content/levels/levels.json: the eight levels and the titles offered by the title picker (a label only). */
export const levelsFile = z
  .object({
    ...draftMark,
    rule: z.string().min(1),
    levels: z
      .array(
        z
          .object({
            level: levelId,
            name: z.string().min(1).max(30),
            typicalYears: z.object({ min: z.number().nonnegative(), max: z.number().positive().nullable() }).strict(),
            /** One line on what the level means, shown under the level chip. */
            meaning: z.string().min(1).max(80),
          })
          .strict(),
      )
      .length(LEVELS.length),
    titles: z.array(
      z
        .object({
          title: z.string().min(1).max(80),
          level: levelId,
          variants: z.array(z.string().min(1).max(80)),
          note: z.string().min(1).nullable(),
        })
        .strict(),
    ),
  })
  .strict();
export type LevelsFile = z.infer<typeof levelsFile>;

/** src/content/levels/role-levels.json: the level each role profile sits at, and the other level it reaches into. */
export const roleLevelsFile = z
  .object({
    ...draftMark,
    roles: z.record(
      z.string().regex(/^[a-z0-9-]+$/),
      z
        .object({
          level: levelId,
          alsoLevel: levelId.nullable(),
          /** Which drafting rule decided it: the experience band, the title, both, or the band moved up by duties. */
          basis: z.enum(["band", "title", "title+band", "band+scope"]),
        })
        .strict(),
    ),
  })
  .strict();
export type RoleLevelsFile = z.infer<typeof roleLevelsFile>;
