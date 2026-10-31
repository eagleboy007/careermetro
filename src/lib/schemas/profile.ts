import { z } from "zod";
import { cutText } from "@/lib/cut-text";
import {
  ME_EDUCATION_TEXT_MAX,
  ME_EDUCATION_YEAR_MAX,
  PROFILE_CERTIFICATION_NAME_MAX,
  PROFILE_CERTIFICATIONS_MAX,
  PROFILE_EDUCATION_MAX,
  PROFILE_EVIDENCE_MAX,
  PROFILE_HIGHLIGHT_MAX,
  PROFILE_HIGHLIGHTS_MAX,
  PROFILE_ROLES_MAX,
  PROFILE_SKILL_NAME_MAX,
  PROFILE_SKILLS_MAX,
  PROFILE_TEXT_MAX,
} from "./constants";

const yearMonth = z
  .string()
  .regex(/^\d{4}(-(0[1-9]|1[0-2]))?$/, "Use YYYY or YYYY-MM");

/**
 * The profile's shape, with the T146 caps or without them. Without them it is only for reading the parser's output
 * (src/lib/resume/parse.ts), which is cut to fit with clampProfile before anything keeps it, so a long line never
 * drops a whole resume and the model's output format stays as it was.
 */
function profileShape(capped: boolean) {
  const text = (max: number) => (capped ? z.string().max(max) : z.string());
  const list = <T extends z.ZodType>(item: T, max: number) => (capped ? z.array(item).max(max) : z.array(item));
  const certification = z.object({
    name: text(PROFILE_CERTIFICATION_NAME_MAX).min(1),
    earned: yearMonth.nullable(),
    expires: z.union([yearMonth, z.literal("none")]).nullable(),
  });
  return z.object({
    headline: text(PROFILE_TEXT_MAX).nullable(),
    totalYearsExperience: z.number().nonnegative().nullable(),
    roles: list(
      z.object({
        title: text(PROFILE_TEXT_MAX).min(1),
        employer: text(PROFILE_TEXT_MAX).min(1),
        start: yearMonth.nullable(),
        end: yearMonth.nullable(),
        highlights: list(text(PROFILE_HIGHLIGHT_MAX), PROFILE_HIGHLIGHTS_MAX),
      }),
      PROFILE_ROLES_MAX,
    ),
    skills: list(
      z.object({
        name: text(PROFILE_SKILL_NAME_MAX).min(1),
        lastUsed: yearMonth.nullable(),
        evidence: list(text(PROFILE_HIGHLIGHT_MAX), PROFILE_EVIDENCE_MAX),
      }),
      PROFILE_SKILLS_MAX,
    ),
    education: list(
      z.object({
        qualification: text(ME_EDUCATION_TEXT_MAX).min(1),
        institution: text(ME_EDUCATION_TEXT_MAX).min(1),
        year: text(ME_EDUCATION_YEAR_MAX).nullable(),
      }),
      PROFILE_EDUCATION_MAX,
    ),
    certifications: list(certification, PROFILE_CERTIFICATIONS_MAX),
  });
}

/** Structured profile parsed from a resume (FR-5). The user confirms it before analysis (FR-6). */
export const profile = profileShape(true);
export type Profile = z.infer<typeof profile>;

/**
 * A certification and, when the resume or the user gives them, when it was passed and when it expires. expires is
 * "none" when it never expires (the user ticked "Doesn't expire", or the resume says lifetime) and null when not stated.
 */
export const heldCertification = profile.shape.certifications.element;
export type HeldCertification = z.infer<typeof heldCertification>;

/** The same profile without the length caps: only for reading the parser's output before clampProfile cuts it. */
export const uncappedProfile = profileShape(false);

// Cuts text without splitting a surrogate pair; plain code with no zod, so client components can import it directly.
export { cutText };

/**
 * The profile cut to the T146 caps: each text to its length and each list to its first entries (the parser lists
 * roles newest first). A profile already inside them comes back as the same object. Cut text is a prefix of what
 * was there, so a cut highlight or quote still reads in the resume.
 */
export function clampProfile(data: Profile): Profile {
  let changed = false;
  // Older rows are trusted only as far as their shape: a missing list or text is left for the reader to handle.
  const cut = (value: string, max: number) => {
    if (typeof value !== "string") return value;
    const out = cutText(value, max);
    if (out !== value) changed = true;
    return out;
  };
  const first = <T>(items: T[], max: number): T[] => {
    if (!Array.isArray(items)) return [];
    if (items.length <= max) return items;
    changed = true;
    return items.slice(0, max);
  };
  const out: Profile = {
    ...data,
    headline: data.headline === null ? null : cut(data.headline, PROFILE_TEXT_MAX),
    roles: first(data.roles, PROFILE_ROLES_MAX).map((r) => ({
      ...r,
      title: cut(r.title, PROFILE_TEXT_MAX),
      employer: cut(r.employer, PROFILE_TEXT_MAX),
      highlights: first(r.highlights, PROFILE_HIGHLIGHTS_MAX).map((h) => cut(h, PROFILE_HIGHLIGHT_MAX)),
    })),
    skills: first(data.skills, PROFILE_SKILLS_MAX).map((s) => ({
      ...s,
      name: cut(s.name, PROFILE_SKILL_NAME_MAX),
      evidence: first(s.evidence, PROFILE_EVIDENCE_MAX).map((q) => cut(q, PROFILE_HIGHLIGHT_MAX)),
    })),
    education: first(data.education, PROFILE_EDUCATION_MAX).map((e) => ({
      ...e,
      qualification: cut(e.qualification, ME_EDUCATION_TEXT_MAX),
      institution: cut(e.institution, ME_EDUCATION_TEXT_MAX),
      year: e.year === null ? null : cut(e.year, ME_EDUCATION_YEAR_MAX),
    })),
    certifications: first(data.certifications, PROFILE_CERTIFICATIONS_MAX).map((c) => ({ ...c, name: cut(c.name, PROFILE_CERTIFICATION_NAME_MAX) })),
  };
  return changed ? out : data;
}

/**
 * A profile as stored. Profiles saved before certification dates (parse-resume/v1) hold plain names; they read as
 * undated certifications, so no migration is needed and the next save writes the new shape. Profiles saved before
 * the T146 caps are cut to fit (clampProfile), so the editor can always save back what it was given.
 */
export function storedProfile(data: Profile): Profile {
  const certs = (data.certifications ?? []) as (HeldCertification | string)[];
  if (certs.every((c) => typeof c !== "string")) return clampProfile(data);
  return clampProfile({ ...data, certifications: certs.map((c) => (typeof c === "string" ? { name: c, earned: null, expires: null } : c)) });
}
