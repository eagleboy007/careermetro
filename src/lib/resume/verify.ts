import type { Profile } from "@/lib/schemas";

/**
 * Lowercases and collapses whitespace and bullet symbols so a quote matches however the text was wrapped.
 * NFKC folds PDF ligatures ("ﬁ") and the styled bold or italic letters some templates use into plain letters,
 * and a full stop after a word is dropped so "Pvt. Ltd." matches "Pvt Ltd".
 */
export function normalizeForMatch(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/(^|\n)\s*[-•*▪●◦]\s*/g, "$1")
    .replace(/(\p{L})\.(?=\s|,|$)/gu, "$1")
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
    // Read whole code points, so a letter outside the Basic Multilingual Plane counts as one character.
    const before = Array.from(haystack.slice(Math.max(0, at - 2), at)).at(-1) ?? "";
    const next = haystack.codePointAt(at + needle.length);
    const after = next === undefined ? "" : String.fromCodePoint(next);
    if ((!needsStart || !WORD.test(before)) && (!needsEnd || !WORD.test(after))) return true;
  }
  return false;
}

/**
 * How many consecutive non-blank lines a role's title and employer, or a degree and its institution, may span.
 * Six covers headers like "Employer / City / Dates / Title" with room to spare.
 */
const PAIR_WINDOW = 6;

/** "valid till Mar 2028", "expires 2027": an expiry, not a pass date. */
const EXPIRY_CLAUSE = /\b(valid|till|until|upto|up to|expir\w*|renew\w*)\b[^,;()|]*?\b\d{4}\b/g;

const MONTH_NAMES = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/**
 * `date` ("YYYY" or "YYYY-MM") as far as one of the texts prints it: null when the year isn't there, the year alone
 * when the month isn't. Texts are normalized.
 */
function printedDate(date: string | null, texts: string[]): string | null {
  if (!date) return null;
  const [year, month] = date.split("-");
  const withYear = texts.filter((t) => containsPhrase(t, year));
  if (!withYear.length) return null;
  if (!month) return year;
  const m = Number(month);
  const numeric = new RegExp(`\\b0?${m}\\s*[/.-]\\s*${year}\\b|\\b${year}\\s*[/.-]\\s*0?${m}\\b`);
  const named = new RegExp(`\\b${MONTH_NAMES[m - 1]}[a-z]*\\.?\\s*,?\\s*${year}\\b`);
  return withYear.some((t) => numeric.test(t) || named.test(t)) ? date : year;
}

/** Words that say a certification never expires. */
const LIFETIME = ["lifetime", "no expiry", "no expiration", "does not expire", "doesn't expire", "never expires", "non-expiring"];

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
  // The text around a certificate, for checking its dates: the line that names it and, unless it names another of the
  // certificates, the line after. Never the line before (another entry's). The name itself is removed, so a version
  // year in it ("ISO/IEC 27001:2013") isn't read as a date.
  const certNames = parsed.certifications.map((c) => normalizeForMatch(c.name)).filter(Boolean);
  const around = (name: string) => {
    const n = normalizeForMatch(name);
    return lines.flatMap((line, i) => {
      if (!containsPhrase(line, n)) return [];
      const next = lines[i + 1] ?? "";
      const own = certNames.some((other) => other !== n && !containsPhrase(n, other) && containsPhrase(next, other)) ? line : `${line} ${next}`;
      return [own.split(n).join(" ")];
    });
  };
  const report: VerifyReport = { droppedSkills: [], droppedQuotes: 0, droppedRoles: 0, droppedOther: 0 };
  const keepQuotes = (quotes: string[]) =>
    quotes.filter((q) => {
      if (found(q)) return true;
      report.droppedQuotes++;
      return false;
    });

  // A later title at an employer already confirmed by a nearby title (a promotion listed further down) only
  // needs the title itself to be in the resume.
  const paired = parsed.roles.map((r) => foundTogether(r.title, r.employer));
  const confirmedEmployers = new Set(parsed.roles.filter((_, i) => paired[i]).map((r) => normalizeForMatch(r.employer)));
  const roles = parsed.roles.flatMap((r, i) => {
    const promotion = confirmedEmployers.has(normalizeForMatch(r.employer)) && found(r.title);
    if (!paired[i] && !promotion) {
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

  // A date is kept only when its year is printed by the certificate (a pass year never one that follows "valid till"),
  // and its month only when printed too; "never expires" only when the resume says so there. Anything else is cleared,
  // since the model must not invent dates (AI-5).
  const certifications = parsed.certifications.flatMap((c) => {
    if (!found(c.name)) {
      report.droppedOther++;
      return [];
    }
    const texts = around(c.name);
    const lifetime = c.expires === "none" && texts.some((t) => LIFETIME.some((w) => containsPhrase(t, w)));
    return [
      {
        name: c.name,
        earned: printedDate(c.earned, texts.map((t) => t.replace(EXPIRY_CLAUSE, " "))),
        expires: lifetime ? ("none" as const) : c.expires === "none" ? null : printedDate(c.expires, texts),
      },
    ];
  });

  return { profile: { ...parsed, roles, skills, education, certifications }, report };
}
