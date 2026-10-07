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

export type VerifyReport = {
  /** Skills removed because none of their evidence, nor their name, appears in the resume. */
  droppedSkills: string[];
  /** Evidence quotes and highlights removed because they are not in the resume. */
  droppedQuotes: number;
  /** Roles removed because the title or employer is not in the resume. */
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
  const found = (s: string) => {
    const needle = normalizeForMatch(s);
    return needle.length > 0 && haystack.includes(needle);
  };
  const report: VerifyReport = { droppedSkills: [], droppedQuotes: 0, droppedRoles: 0, droppedOther: 0 };
  const keepQuotes = (quotes: string[]) =>
    quotes.filter((q) => {
      if (found(q)) return true;
      report.droppedQuotes++;
      return false;
    });

  const roles = parsed.roles.flatMap((r) => {
    if (!found(r.title) || !found(r.employer)) {
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
    if (found(e.qualification) && found(e.institution)) return true;
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
