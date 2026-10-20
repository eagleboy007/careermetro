import { z } from "zod";
import { BUILDER_JOB_KINDS, BUILDER_LINES_MAX, BUILDER_ROWS_MAX, BUILDER_STAGES, BUILDER_TEXT_MAX, BUILDER_TOOLS_MAX } from "./constants";
import { normalLink, YEAR_TEXT } from "@/lib/builder/rules";
export { BUILDER_SECTIONS, BUILDER_SECTION_LABELS, BUILDER_STAGES, BUILDER_STAGE_LABELS, BUILDER_JOB_KINDS, BUILDER_JOB_KIND_LABELS, BUILDER_ROWS_MAX, BUILDER_TEXT_MAX, BUILDER_TOOLS_MAX, BUILDER_LINES_MAX, type BuilderSection } from "./constants";
export { builderIssues, builderMissing, normalLink, type BuilderIssues } from "@/lib/builder/rules";

/*
 * Build your resume (FR-36, handoff 12k, docs/plans/resume-builder-plan.md). The answers are resume text: they are never
 * logged, put in analytics, audit lines or URLs. Drafts save as the person goes, so every field accepts an empty or
 * half-typed value (a year still being typed, an email not finished) and `builderMissing` says what a build still
 * needs; the screens show those on Review. Only what could never be right (a bad month, a link off its site) is refused.
 */

const short = (max: number) => z.string().trim().max(max, { error: `Keep it under ${max} characters.` });
const rowId = z.string().regex(/^[a-z0-9]{1,12}$/);
/** Up to four digits while it is typed; `builderIssues` asks for a whole year before a build. */
const year = z.string().trim().regex(/^\d{0,4}$/, { error: YEAR_TEXT }).default("");
const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, { error: "Pick a month." });
const optional = <T extends z.ZodType>(s: T) => z.union([s, z.literal("")]).default("");

/**
 * A typed link: https only, and on the right site when the field names one. A link typed without https://
 * ("github.com/priya") gets it, and an http:// link is upgraded, as `normalLink` does on the screen too.
 */
const httpsLink = (host?: RegExp) =>
  z
    .string()
    .trim()
    .max(300)
    .transform(normalLink)
    .refine((v) => {
      if (!v) return true;
      try {
        const u = new URL(v);
        return u.protocol === "https:" && (!host || host.test(u.hostname));
      } catch {
        return false;
      }
    }, { error: host ? "Use the https link to your page on that site." : "Use a link that starts with https://." });

const free = short(BUILDER_TEXT_MAX);

export const builderEducation = z.object({
  id: rowId,
  degree: short(120),
  college: short(160),
  start: year,
  end: year,
  marks: short(40).default(""),
});

export const builderProject = z.object({
  id: rowId,
  name: short(120),
  did: free,
  link: httpsLink().default(""),
});

export const builderJob = z.object({
  id: rowId,
  kind: z.enum(BUILDER_JOB_KINDS),
  company: short(120).default(""),
  title: short(120),
  from: optional(month),
  to: z.union([month, z.literal("now"), z.literal("")]).default(""),
  did: free,
});

export const builderCertificate = z.object({
  id: rowId,
  name: short(160),
  issuer: short(120).default(""),
  earned: optional(month),
  badge: httpsLink().default(""),
});

export const builderAnswers = z.object({
  role: z
    .object({
      /** A role profile's slug, or null for "Not sure yet" (the result uses "Closest to your resume"). */
      roleSlug: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/).nullable().default(null),
      stage: z.enum(BUILDER_STAGES).nullable().default(null),
      city: short(60).default(""),
    })
    .default({ roleSlug: null, stage: null, city: "" }),
  education: z.array(builderEducation).max(BUILDER_ROWS_MAX).default([]),
  projects: z.array(builderProject).max(BUILDER_ROWS_MAX).default([]),
  /** False is "I haven't worked yet": the section is done with no rows. */
  worked: z.boolean().nullable().default(null),
  jobs: z.array(builderJob).max(BUILDER_ROWS_MAX).default([]),
  tools: z.array(short(60).min(1)).max(BUILDER_TOOLS_MAX).default([]),
  /** True is "None yet". */
  noCertificates: z.boolean().default(false),
  certificates: z.array(builderCertificate).max(BUILDER_ROWS_MAX).default([]),
  links: z
    .object({
      github: httpsLink(/^(www\.)?github\.com$/).default(""),
      portfolio: httpsLink().default(""),
      linkedin: httpsLink(/^([a-z]{2,3}\.)?linkedin\.com$/).default(""),
      /** Kept as typed; `builderIssues` checks it before a build. */
      email: short(200).default(""),
    })
    .default({ github: "", portfolio: "", linkedin: "", email: "" }),
});
export type BuilderAnswers = z.infer<typeof builderAnswers>;
export const EMPTY_BUILDER_ANSWERS: BuilderAnswers = builderAnswers.parse({});

/** A free-text answer's id, as the reword prompt and the review page name it: "p:<row>" (project) or "j:<row>" (job). */
export const answerId = z.string().regex(/^[pj]:[a-z0-9]{1,12}$/);

/** The reword model's reply (prompts/build-resume/v1.md). Checked line by line before anything is kept. */
export const builderReword = z.object({
  answers: z
    .array(
      z.object({
        answerId,
        lines: z.array(z.string().trim().min(1).max(220)).max(BUILDER_LINES_MAX),
      }),
    )
    .max(BUILDER_ROWS_MAX * 2),
  suggestions: z
    .array(
      z.object({
        kind: z.enum(["tool", "number", "wording"]),
        text: z.string().trim().min(1).max(160),
        answerId: answerId.nullable(),
      }),
    )
    .max(10),
});
export type BuilderReword = z.infer<typeof builderReword>;
