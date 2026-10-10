import { z } from "zod";

const yearMonth = z
  .string()
  .regex(/^\d{4}(-\d{2})?$/, "Use YYYY or YYYY-MM");

/**
 * A certification and, when the resume or the user gives them, when it was passed and when it expires. expires is
 * "none" when it never expires (the user ticked "Doesn't expire", or the resume says lifetime) and null when not stated.
 */
export const heldCertification = z.object({
  name: z.string().min(1),
  earned: yearMonth.nullable(),
  expires: z.union([yearMonth, z.literal("none")]).nullable(),
});
export type HeldCertification = z.infer<typeof heldCertification>;

/** Structured profile parsed from a resume (FR-5). The user confirms it before analysis (FR-6). */
export const profile = z.object({
  headline: z.string().nullable(),
  totalYearsExperience: z.number().nonnegative().nullable(),
  roles: z.array(
    z.object({
      title: z.string().min(1),
      employer: z.string().min(1),
      start: yearMonth.nullable(),
      end: yearMonth.nullable(),
      highlights: z.array(z.string()),
    }),
  ),
  skills: z.array(
    z.object({
      name: z.string().min(1),
      lastUsed: yearMonth.nullable(),
      evidence: z.array(z.string()),
    }),
  ),
  education: z.array(
    z.object({
      qualification: z.string().min(1),
      institution: z.string().min(1),
      year: z.string().nullable(),
    }),
  ),
  certifications: z.array(heldCertification),
});
export type Profile = z.infer<typeof profile>;

/**
 * A profile as stored. Profiles saved before certification dates (parse-resume/v1) hold plain names; they read as
 * undated certifications, so no migration is needed and the next save writes the new shape.
 */
export function storedProfile(data: Profile): Profile {
  const certs = (data.certifications ?? []) as (HeldCertification | string)[];
  if (certs.every((c) => typeof c !== "string")) return data;
  return { ...data, certifications: certs.map((c) => (typeof c === "string" ? { name: c, earned: null, expires: null } : c)) };
}
