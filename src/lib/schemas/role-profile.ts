import { z } from "zod";

/** A curated role profile (FR-8, FR-9). Every profile records where it came from and when it was reviewed. */
export const roleSkill = z.object({
  skillId: z.string().min(1),
  importance: z.enum(["required", "nice_to_have"]),
  /** What the role expects in plain words, shown next to each gap. */
  expectation: z.string().min(1),
});

export const roleCertification = z.object({
  certId: z.string().min(1),
  /** recommended: the best-value pick for this role. optional: worth it for some employers or later in a career. */
  importance: z.enum(["recommended", "optional"]),
  /** Why it helps, in plain words. */
  why: z.string().min(1),
});

export const roleProfile = z.object({
  slug: z.string().regex(/^[a-z0-9-]+$/),
  title: z.string().min(1),
  experienceBand: z.object({
    minYears: z.number().int().nonnegative(),
    maxYears: z.number().int().positive(),
  }),
  skills: z.array(roleSkill).min(3),
  certifications: z.array(roleCertification).default([]),
  sources: z
    .array(
      z.object({
        description: z.string().min(1),
        url: z.url().nullable(),
      }),
    )
    .min(1),
  reviewedBy: z.string().nullable(),
  updatedOn: z.iso.date(),
});
export type RoleProfile = z.infer<typeof roleProfile>;
