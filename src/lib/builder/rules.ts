import type { BuilderAnswers } from "@/lib/schemas";
import type { BuilderSection } from "@/lib/schemas/constants";

/*
 * Build your resume's rules that the screens run too (FR-36): what a build still needs, the field problems shown on
 * Review, and how a typed link is tidied. No Zod here, so the builder's client component can import it.
 */

/** Field problems by path, as Zod names them ("education.0.start", "links.github"), each with the words to show. */
export type BuilderIssues = Record<string, string>;

export const YEAR_TEXT = "Use a year like 2024.";
export const EMAIL_TEXT = "Check the email.";
const FULL_YEAR = /^(19[5-9]\d|20\d\d)$/;
const EMAIL = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

/**
 * A link as stored: https:// added to one typed without it ("github.com/priya"), and an http:// link upgraded, since a
 * resume link must be safe to open. Anything with another scheme is left as typed, for the schema to refuse.
 */
export function normalLink(value: string): string {
  const v = value.trim();
  if (!v) return "";
  if (/^https?:\/\//i.test(v)) return `https://${v.replace(/^https?:\/\//i, "")}`;
  if (/^[a-z][a-z0-9+.-]*:/i.test(v) && !/^[^/:]+\.[^/:]+:\d+(\/|$)/.test(v)) return v;
  return /^[^\s/.]+(\.[^\s/.]+)+(\/|$)/.test(v) ? `https://${v}` : v;
}

/** Problems the draft may hold while it is typed but a build may not: a part-typed year, an unfinished email. */
export function builderIssues(a: BuilderAnswers): BuilderIssues {
  const out: BuilderIssues = {};
  a.education.forEach((e, i) => {
    if (e.start && !FULL_YEAR.test(e.start)) out[`education.${i}.start`] = YEAR_TEXT;
    if (e.end && !FULL_YEAR.test(e.end)) out[`education.${i}.end`] = YEAR_TEXT;
  });
  if (a.links.email && !EMAIL.test(a.links.email)) out["links.email"] = EMAIL_TEXT;
  return out;
}

/**
 * What each section still needs before "Check my gaps", in the person's words. Empty means ready. Optional fields
 * (marks, links, city, a project link) never block, unless what was typed in them can't be used.
 */
export function builderMissing(a: BuilderAnswers): Partial<Record<BuilderSection, string>> {
  const out: Partial<Record<BuilderSection, string>> = {};
  const issues = Object.keys(builderIssues(a));
  if (!a.role.stage) out.role = "Pick where you are now.";
  if (!a.education.length || a.education.some((e) => !e.degree || !e.college)) out.education = "Add your degree and college.";
  else if (issues.some((k) => k.startsWith("education."))) out.education = "Check the years: use a year like 2024.";
  if (a.projects.some((p) => !p.name || !p.did)) out.projects = "Give each project a name and say what you did.";
  if (a.worked === null) out.jobs = "Add a job or internship, or pick \"I haven't worked yet\".";
  else if (a.worked && (!a.jobs.length || a.jobs.some((j) => !j.title || !j.from || !j.to || !j.did || (!j.company && (j.kind === "job" || j.kind === "internship")))))
    out.jobs = "Give each one a company, a title, the months and what you did.";
  if (!a.tools.length) out.tools = "Pick at least one tool.";
  if (!a.noCertificates && a.certificates.some((c) => !c.name)) out.certificates = "Name each certificate, or pick \"None yet\".";
  if (issues.includes("links.email")) out.links = EMAIL_TEXT;
  return out;
}
