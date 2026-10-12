import { z } from "zod";

/**
 * A resume laid out for download (FR-20), built only from the profile the person confirmed: one column, standard
 * section names and plain text, so screening software reads it. The PDF and Word files are drawn from this.
 */
export const resumeEntry = z.object({
  title: z.string().min(1),
  /** Employer, institution or issuer; empty when the profile has none. */
  subtitle: z.string(),
  /** Already worded for people, like "Jun 2022 – Present". Empty when the profile has no dates. */
  dates: z.string(),
  bullets: z.array(z.string().min(1)),
});
export type ResumeEntry = z.infer<typeof resumeEntry>;

export const resumeSection = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("entries"), heading: z.string().min(1), entries: z.array(resumeEntry).min(1) }),
  z.object({ kind: z.literal("list"), heading: z.string().min(1), items: z.array(z.string().min(1)).min(1) }),
]);
export type ResumeSection = z.infer<typeof resumeSection>;

export const resumeDocument = z.object({
  /** The account's name; null for someone not signed in, who fills it in themselves. */
  name: z.string().min(1).nullable(),
  headline: z.string().nullable(),
  /** Only sections with something in them, in reading order. */
  sections: z.array(resumeSection),
});
export type ResumeDocument = z.infer<typeof resumeDocument>;

export const RESUME_FORMATS = ["pdf", "docx"] as const;
export const resumeFormat = z.enum(RESUME_FORMATS);
export type ResumeFormat = z.infer<typeof resumeFormat>;
