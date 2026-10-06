import { z } from "zod";

const yearMonth = z
  .string()
  .regex(/^\d{4}(-\d{2})?$/, "Use YYYY or YYYY-MM");

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
  certifications: z.array(z.string()),
});
export type Profile = z.infer<typeof profile>;
