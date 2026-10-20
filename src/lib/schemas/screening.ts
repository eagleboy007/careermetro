import { z } from "zod";

/**
 * FR-34, the screening-readiness check (dev/resume-check-plan.md). Three parts, all plain code:
 * - keywords: required skills of the target role or a pasted job that the resume doesn't name (the Gaps matcher);
 * - layout: what screening software reads badly, found in the uploaded file while it is in memory;
 * - headings: whether the resume's section headings use the standard names.
 * The original file is never stored, so layout and headings are kept only as counts, yes/no flags and fixed codes.
 */

/** The standard sections, in the order the FR-20 download writes them. Each has one standard name to show. */
export const SECTION_KEYS = ["summary", "experience", "education", "skills", "projects", "certifications"] as const;
export const sectionKey = z.enum(SECTION_KEYS);
export type SectionKey = z.infer<typeof sectionKey>;

export const SECTION_NAMES: Record<SectionKey, string> = {
  summary: "Summary",
  experience: "Experience",
  education: "Education",
  skills: "Skills",
  projects: "Projects",
  certifications: "Certifications",
};

/**
 * How the resume heads one section: a name screening software knows ("standard"), a known other name such as
 * "Professional Journey" ("renamed"), or no heading we recognise ("not_found"). The heading's own words are not kept.
 */
export const headingState = z.enum(["standard", "renamed", "not_found"]);
export type HeadingState = z.infer<typeof headingState>;

export const headingFlags = z.object(Object.fromEntries(SECTION_KEYS.map((k) => [k, headingState])) as Record<SectionKey, typeof headingState>);
export type HeadingFlags = z.infer<typeof headingFlags>;

const count = z.number().int().nonnegative().max(10_000);

/**
 * Layout found in an uploaded PDF or Word file. Null means "can't be checked in this kind of file" (a PDF has no
 * tables, text boxes or headers as such), never "none found".
 */
export const layoutFlags = z.object({
  fileType: z.enum(["pdf", "docx"]),
  /** Word tables. In a PDF a table reads as text side by side, so it shows under `columns`. */
  tables: count.nullable(),
  /** Text set side by side: Word's newspaper columns, or in a PDF two runs of text next to each other on many lines. */
  columns: z.boolean(),
  /** Pictures: a photo, logo, icons or a chart. */
  images: count,
  /** Word text boxes and shapes holding text. */
  textBoxes: count.nullable(),
  /** Text in a Word page header or footer, beyond page numbers. */
  headerFooterText: z.boolean().nullable(),
});
export type LayoutFlags = z.infer<typeof layoutFlags>;

/** What the upload stored on the resume row (resumes.screening). Rows from before FR-34 hold null. */
export const resumeScreening = z.object({
  version: z.literal(1),
  /** "pasted" for pasted text, which has no layout; "unread" when the file's layout couldn't be read. */
  layout: z.union([layoutFlags, z.literal("pasted"), z.literal("unread")]),
  headings: headingFlags,
});
export type ResumeScreening = z.infer<typeof resumeScreening>;

/** One required keyword the resume doesn't name. A "one of these" group offers each of its skills to confirm. */
export const screeningKeyword = z.object({
  skillId: z.string().min(1),
  skillName: z.string().min(1),
  options: z.array(z.object({ skillId: z.string().min(1), skillName: z.string().min(1) })).min(1),
});
export type ScreeningKeyword = z.infer<typeof screeningKeyword>;

export const LAYOUT_KINDS = ["columns", "tables", "images", "text_boxes", "header_footer"] as const;
export const layoutKind = z.enum(LAYOUT_KINDS);
export type LayoutKind = z.infer<typeof layoutKind>;

/** The check as the page shows it. Plain data, so /design can render it with example data. */
/** What "I have this" is checked against: a role from our library, or a saved job check of this resume. */
export const screeningTarget = z.union([
  z.object({ roleSlug: z.string().regex(/^[a-z0-9-]{1,80}$/) }).strict(),
  z.object({ checkId: z.uuid() }).strict(),
]);
export type ScreeningTarget = z.infer<typeof screeningTarget>;

export const screeningView = z.object({
  /** What the keywords were checked against: the target role, or a pasted job. */
  against: z.enum(["role", "job"]),
  target: screeningTarget,
  /** The confirmed profile version the check was made on, sent back with "I have this". */
  profileVersion: z.number().int().positive(),
  keywords: z.object({ asked: z.number().int().nonnegative(), missing: z.array(screeningKeyword) }),
  layout: z.discriminatedUnion("state", [
    z.object({
      state: z.literal("checked"),
      fileType: z.enum(["pdf", "docx"]),
      issues: z.array(z.object({ kind: layoutKind, count: count.nullable() })),
      /** What this kind of file can't tell us. */
      unchecked: z.array(layoutKind),
    }),
    z.object({ state: z.literal("pasted") }),
    /** Uploaded before FR-34: no flags, so the page asks for the file again rather than guess. */
    z.object({ state: z.literal("unknown") }),
  ]),
  headings: z.discriminatedUnion("state", [
    z.object({ state: z.literal("checked"), issues: z.array(z.object({ section: sectionKey, problem: headingState.exclude(["standard"]) })) }),
    z.object({ state: z.literal("unknown") }),
  ]),
  /** The sample resume ("Try a sample resume"): the check offers no download, since a made-up person's isn't yours. */
  sample: z.boolean().optional(),
});
export type ScreeningView = z.infer<typeof screeningView>;

/** "I have this": adds one taxonomy skill to the confirmed profile's skills list, listed only. */
export const confirmKeywordRequest = z
  .object({ skillId: z.string().regex(/^[a-z0-9-]{1,80}$/), target: screeningTarget, version: z.number().int().positive().max(1000) })
  .strict();
export type ConfirmKeywordRequest = z.infer<typeof confirmKeywordRequest>;
