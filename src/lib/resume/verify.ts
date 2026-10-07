import type { Profile } from "@/lib/schemas";

/** Lowercases and collapses whitespace and bullet symbols so a quote matches however the text was wrapped. */
export function normalizeForMatch(text: string): string {
  return text
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/(^|\n)\s*[-•*▪●◦]\s*/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

const WORD = /[\p{L}\p{M}\p{N}]/u;

/**
 * True when `needle` appears in `haystack` as whole words: "Go" is not found inside "Google", and "Java" is
 * not found inside "JavaScript". Edges that are symbols, as in "C++" or ".NET", need no boundary.
 * Both strings must already be normalized.
 */
export function containsPhrase(haystack: string, needle: string): boolean {
  if (needle.length === 0) return false;
  const needsStart = WORD.test(needle[0]);
  const needsEnd = WORD.test(needle[needle.length - 1]);
  for (let at = haystack.indexOf(needle); at >= 0; at = haystack.indexOf(needle, at + 1)) {
    const before = at > 0 ? haystack[at - 1] : "";
    const after = haystack[at + needle.length] ?? "";
    if ((!needsStart || !WORD.test(before)) && (!needsEnd || !WORD.test(after))) return true;
  }
  return false;
}

/** How many consecutive non-blank lines a role's title and employer, or a degree and its institution, may span. */
const PAIR_WINDOW = 3;

export type VerifyReport = {
  /** Skills removed because none of their evidence, nor their name, appears in the resume. */
  droppedSkills: string[];
  /** Evidence quotes and highlights removed because they are not in the resume. */
  droppedQuotes: number;
  /** Roles removed because the title and employer are not printed near each other in the resume. */
  droppedRoles: number;
  /** Education and certification entries removed because they are not in the resume. */
  droppedOther: number;
};

/**
 * AI-5: keeps only what the resume text supports. Run on the model's profile before the user sees it.
 * Matching is against the same masked text the model received.
 */
export function verifyProfile(parsed: Profile, resumeText: string): { profile: Profile; report: VerifyReport } {
  const haystack = normalizeForMatch(resumeText);
  const found = (s: string) => containsPhrase(haystack, normalizeForMatch(s));
  // Windows of a few consecutive lines, so a title is only paired with an employer printed next to it.
  const lines = resumeText
    .split("\n")
    .map(normalizeForMatch)
    .filter((line) => line.length > 0);
  const windows = lines.map((_, i) => lines.slice(i, i + PAIR_WINDOW).join(" "));
  const foundTogether = (a: string, b: string) => {
    const [na, nb] = [normalizeForMatch(a), normalizeForMatch(b)];
    return windows.some((w) => containsPhrase(w, na) && containsPhrase(w, nb));
  };
  const report: VerifyReport = { droppedSkills: [], droppedQuotes: 0, droppedRoles: 0, droppedOther: 0 };
  const keepQuotes = (quotes: string[]) =>
    quotes.filter((q) => {
      if (found(q)) return true;
      report.droppedQuotes++;
      return false;
    });

  const roles = parsed.roles.flatMap((r) => {
    if (!foundTogether(r.title, r.employer)) {
      report.droppedRoles++;
      return [];
    }
    return [{ ...r, highlights: keepQuotes(r.highlights) }];
  });

  const skills = parsed.skills.flatMap((s) => {
    const evidence = keepQuotes(s.evidence);
    if (evidence.length === 0 && !found(s.name)) {
      report.droppedSkills.push(s.name);
      return [];
    }
    return [{ ...s, evidence }];
  });

  const education = parsed.education.filter((e) => {
    if (foundTogether(e.qualification, e.institution)) return true;
    report.droppedOther++;
    return false;
  });

  const certifications = parsed.certifications.filter((c) => {
    if (found(c)) return true;
    report.droppedOther++;
    return false;
  });

  return { profile: { ...parsed, roles, skills, education, certifications }, report };
}
