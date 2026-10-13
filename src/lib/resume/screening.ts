import { skills as taxonomy } from "@/content";
import { matchProfile } from "@/lib/gaps/match";
import {
  SECTION_KEYS,
  SECTION_NAMES,
  type LayoutKind,
  type Profile,
  type ResumeScreening,
  type RoleProfile,
  type ScreeningKeyword,
  type ScreeningView,
  type SectionKey,
} from "@/lib/schemas";

/**
 * FR-34, the screening-readiness check, in plain code (dev/resume-check-plan.md). Keywords come from the Gaps
 * matcher, so they always agree with the Gaps page; layout and headings come from the flags stored at upload.
 * Nothing here writes resume text: a missing keyword is a gap, or a skill the person confirms they have.
 */

const skillName = new Map(taxonomy.map((s) => [s.id, s.name]));

/**
 * The target's required keywords the resume doesn't name at all. A weak or outdated skill is named somewhere on the
 * resume, so software scanning for the word finds it; only the matcher's "missing" ones are missing keywords. Context
 * skills (communication) are never gaps and never keywords. A missing "one of these" group offers each of its skills.
 */
export function missingKeywords(profile: Profile, role: RoleProfile, now = new Date()): { asked: number; missing: ScreeningKeyword[] } {
  const match = matchProfile(profile, role, now);
  const missing = match.gaps
    .filter((g) => g.status === "missing")
    .map((g) => ({
      skillId: g.skillId,
      skillName: g.skillName,
      options: (g.group?.skillIds ?? [g.skillId]).map((id) => ({ skillId: id, skillName: skillName.get(id) ?? id })),
    }));
  return { asked: match.readiness.requiredTotal, missing };
}

/** Sections a resume should head when it has that content; Summary and Projects are optional. */
const expected = (profile: Profile): Record<SectionKey, boolean> => ({
  summary: false,
  experience: profile.roles.length > 0,
  education: profile.education.length > 0,
  skills: profile.skills.length > 0,
  projects: false,
  certifications: profile.certifications.length > 0,
});

const LAYOUT_ORDER: LayoutKind[] = ["columns", "tables", "images", "text_boxes", "header_footer"];

export function layoutView(stored: ResumeScreening | null): ScreeningView["layout"] {
  if (!stored) return { state: "unknown" };
  const l = stored.layout;
  if (l === "pasted") return { state: "pasted" };
  if (l === "unread") return { state: "unknown" };
  const found: Record<LayoutKind, { hit: boolean; count: number | null } | null> = {
    columns: { hit: l.columns, count: null },
    tables: l.tables === null ? null : { hit: l.tables > 0, count: l.tables },
    images: { hit: l.images > 0, count: l.images },
    text_boxes: l.textBoxes === null ? null : { hit: l.textBoxes > 0, count: l.textBoxes },
    header_footer: l.headerFooterText === null ? null : { hit: l.headerFooterText, count: null },
  };
  return {
    state: "checked",
    fileType: l.fileType,
    issues: LAYOUT_ORDER.filter((k) => found[k]?.hit).map((kind) => ({ kind, count: found[kind]!.count })),
    unchecked: LAYOUT_ORDER.filter((k) => found[k] === null),
  };
}

export function headingsView(stored: ResumeScreening | null, profile: Profile): ScreeningView["headings"] {
  if (!stored) return { state: "unknown" };
  const want = expected(profile);
  const issues: Extract<ScreeningView["headings"], { state: "checked" }>["issues"] = [];
  for (const section of SECTION_KEYS) {
    const state = stored.headings[section];
    if (state === "renamed") issues.push({ section, problem: "renamed" });
    else if (state === "not_found" && want[section]) issues.push({ section, problem: "not_found" });
  }
  return { state: "checked", issues };
}

/** The whole check for one target: the role from our library, or a pasted job as a role (postingRole). */
export function buildScreeningView(input: {
  target: ScreeningView["target"];
  profileVersion: number;
  profile: Profile;
  role: RoleProfile;
  stored: ResumeScreening | null;
  now?: Date;
}): ScreeningView {
  return {
    against: "roleSlug" in input.target ? "role" : "job",
    target: input.target,
    profileVersion: input.profileVersion,
    keywords: missingKeywords(input.profile, input.role, input.now),
    layout: layoutView(input.stored),
    headings: headingsView(input.stored, input.profile),
  };
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * The readiness summary in words, never a percentage or score (handoff: "Readiness is words"). One line per part,
 * and a headline that counts what there is to fix.
 */
export function screeningSummary(view: ScreeningView): { headline: string; parts: { label: string; text: string }[] } {
  const target = view.against === "role" ? "this role" : "this job";
  const k = view.keywords;
  const keywords =
    k.asked === 0
      ? `${target === "this job" ? "This job" : "This role"} names no skills we can check yet.`
      : k.missing.length === 0
        ? `Your resume names all ${plural(k.asked, "skill")} ${target} asks for.`
        : `Your resume doesn't name ${k.missing.length} of the ${plural(k.asked, "skill")} ${target} asks for.`;
  const layout =
    view.layout.state === "unknown"
      ? "Not checked. Upload your file again to check it."
      : view.layout.state === "pasted"
        ? "Pasted text has no layout to check."
        : view.layout.issues.length === 0
          ? "Nothing found that screening software reads badly."
          : `${plural(view.layout.issues.length, "thing")} that screening software can read badly.`;
  const headings =
    view.headings.state === "unknown"
      ? "Not checked. Upload your file again to check them."
      : view.headings.issues.length === 0
        ? "Your section headings use standard names."
        : `${plural(view.headings.issues.length, "heading")} to rename or add.`;
  const toFix =
    k.missing.length +
    (view.layout.state === "checked" ? view.layout.issues.length : 0) +
    (view.headings.state === "checked" ? view.headings.issues.length : 0);
  const unchecked = view.layout.state === "unknown" || view.headings.state === "unknown";
  const headline =
    toFix === 0
      ? unchecked
        ? "Nothing to fix in what we could check."
        : "Nothing to fix for screening software."
      : `${plural(toFix, "thing")} to look at before you apply.`;
  return {
    headline,
    parts: [
      { label: "Keywords", text: keywords },
      { label: "Layout", text: layout },
      { label: "Headings", text: headings },
    ],
  };
}

/** Plain words for each layout issue and heading problem, shared by the page and /design. */
export const LAYOUT_WORDS: Record<LayoutKind, { title: (count: number | null) => string; why: string }> = {
  columns: {
    title: () => "Text side by side, in columns or a table",
    why: "Some software reads straight across the page and mixes lines from the two sides.",
  },
  tables: {
    title: (n) => (n === 1 ? "A table" : `${n ?? "Some"} tables`),
    why: "Table cells are often read out of order, or skipped.",
  },
  images: {
    title: (n) => (n === 1 ? "A picture" : `${n ?? "Some"} pictures`),
    why: "A photo, logo, icons or a chart. Software can't read words inside a picture.",
  },
  text_boxes: {
    title: (n) => (n === 1 ? "A text box" : `${n ?? "Some"} text boxes`),
    why: "Text in boxes and shapes is often skipped.",
  },
  header_footer: {
    title: () => "Text in the page header or footer",
    why: "Many systems skip headers and footers, so contact details there can be lost.",
  },
};

export const UNCHECKED_WORDS: Record<LayoutKind, string> = {
  columns: "columns",
  tables: "tables",
  images: "pictures",
  text_boxes: "text boxes",
  header_footer: "headers and footers",
};

export function headingWords(section: SectionKey, problem: "renamed" | "not_found"): string {
  const name = SECTION_NAMES[section];
  return problem === "renamed"
    ? `Your ${name.toLowerCase()} section has a heading some software won't recognise. Call it “${name}”.`
    : `We couldn't find a “${name}” heading, though your resume has ${name.toLowerCase()}. Add one above it.`;
}
