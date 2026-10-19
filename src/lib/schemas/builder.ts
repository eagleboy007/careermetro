import { z } from "zod";

/*
 * Build your resume (FR-36, handoff 12k, docs/plans/resume-builder-plan.md). The answers are resume text: they are never
 * logged, put in analytics, audit lines or URLs. Drafts save as the person goes, so every field accepts an empty value
 * and `builderMissing` says what a build still needs.
 */

export const BUILDER_SECTIONS = ["role", "education", "projects", "jobs", "tools", "certificates", "links"] as const;
export type BuilderSection = (typeof BUILDER_SECTIONS)[number];
export const BUILDER_SECTION_LABELS: Record<BuilderSection, string> = {
  role: "Role",
  education: "Education",
  projects: "Projects",
  jobs: "Internships and jobs",
  tools: "Tools",
  certificates: "Certificates",
  links: "Links",
};

export const BUILDER_STAGES = ["studying", "graduated", "working", "break"] as const;
export const BUILDER_STAGE_LABELS: Record<(typeof BUILDER_STAGES)[number], string> = {
  studying: "Studying",
  graduated: "Just graduated",
  working: "Working",
  break: "On a break",
};
export const BUILDER_JOB_KINDS = ["internship", "job", "freelance", "volunteer"] as const;
export const BUILDER_JOB_KIND_LABELS: Record<(typeof BUILDER_JOB_KINDS)[number], string> = {
  internship: "Internship",
  job: "Job",
  freelance: "Freelance",
  volunteer: "Volunteer",
};

/** Caps from the plan, section 4. */
export const BUILDER_ROWS_MAX = 20;
export const BUILDER_TEXT_MAX = 600;
export const BUILDER_TOOLS_MAX = 30;
/** The model returns at most this many resume lines for one free-text answer. */
export const BUILDER_LINES_MAX = 4;

const short = (max: number) => z.string().trim().max(max, { error: `Keep it under ${max} characters.` });
const rowId = z.string().regex(/^[a-z0-9]{1,12}$/);
const year = z.string().regex(/^(19[5-9]\d|20\d\d)$/, { error: "Use a year like 2024." });
const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, { error: "Pick a month." });
const optional = <T extends z.ZodType>(s: T) => z.union([s, z.literal("")]).default("");

/** A typed link: https only, and on the right site when the field names one. */
const httpsLink = (host?: RegExp) =>
  z
    .string()
    .trim()
    .max(300)
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
  start: optional(year),
  end: optional(year),
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
      email: z.union([z.email({ error: "Check the email." }).max(200), z.literal("")]).default(""),
    })
    .default({ github: "", portfolio: "", linkedin: "", email: "" }),
});
export type BuilderAnswers = z.infer<typeof builderAnswers>;
export const EMPTY_BUILDER_ANSWERS: BuilderAnswers = builderAnswers.parse({});

/** A free-text answer's id, as the reword prompt and the review page name it: "p:<row>" (project) or "j:<row>" (job). */
export const answerId = z.string().regex(/^[pj]:[a-z0-9]{1,12}$/);

/**
 * What each section still needs before "Check my gaps", in the person's words. Empty means ready. Optional fields
 * (marks, links, city, a project link) never block.
 */
export function builderMissing(a: BuilderAnswers): Partial<Record<BuilderSection, string>> {
  const out: Partial<Record<BuilderSection, string>> = {};
  if (!a.role.stage) out.role = "Pick where you are now.";
  if (!a.education.length || a.education.some((e) => !e.degree || !e.college)) out.education = "Add your degree and college.";
  if (a.projects.some((p) => !p.name || !p.did)) out.projects = "Give each project a name and say what you did.";
  if (a.worked === null) out.jobs = "Add a job or internship, or pick \"I haven't worked yet\".";
  else if (a.worked && (!a.jobs.length || a.jobs.some((j) => !j.title || !j.from || !j.to || !j.did || (!j.company && (j.kind === "job" || j.kind === "internship")))))
    out.jobs = "Give each one a company, a title, the months and what you did.";
  if (!a.tools.length) out.tools = "Pick at least one tool.";
  if (!a.noCertificates && a.certificates.some((c) => !c.name)) out.certificates = "Name each certificate, or pick \"None yet\".";
  return out;
}

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
