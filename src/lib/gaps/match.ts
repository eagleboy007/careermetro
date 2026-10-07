import { z } from "zod";
import { normalizeSkillTerm, skillIdByTerm, skills as taxonomy } from "@/content";
import { containsPhrase, normalizeForMatch } from "@/lib/resume/verify";
import { gapStatus, type Profile, type RoleProfile } from "@/lib/schemas";

/** Bump when the rules below change, so stored analyses say which rules produced them. */
export const MATCHER_VERSION = "matcher/v1";

/** Evidence older than this, by the end of the job or the skill's last use, makes a skill outdated. */
export const OUTDATED_AFTER_YEARS = 4;

/** Rough hours to close a gap, by status. Shown as an estimate, never as a promise. */
export const HOURS_BY_STATUS = { missing: 12, weak: 4, outdated: 6 } as const;

export const matchedSkill = z.object({
  skillId: z.string(),
  skillName: z.string(),
  status: gapStatus,
  /** The resume line this status rests on, or null when nothing in the resume covers the skill (FR-12). */
  resumeQuote: z.string().nullable(),
  /** What the role expects, from the role profile. */
  requirement: z.string(),
  postingShare: z.number().nullable(),
});
export type MatchedSkill = z.infer<typeof matchedSkill>;

export const matchResult = z.object({
  matcherVersion: z.string(),
  roleSlug: z.string(),
  /** Required skills that are not met, most important first. */
  gaps: z.array(matchedSkill),
  /** Required skills the resume shows. */
  met: z.array(matchedSkill),
  /** Nice-to-have skills with their status, for the "bonus" list. */
  niceToHave: z.array(matchedSkill),
  readiness: z.object({
    requiredTotal: z.number().int(),
    requiredMet: z.number().int(),
    estimatedHours: z.number().int(),
  }),
});
export type MatchResult = z.infer<typeof matchResult>;

type Evidence = { quote: string | null; listedOnly: boolean; year: number | null };

const skillById = new Map(taxonomy.map((s) => [s.id, s]));

/**
 * Terms safe to look for in free text. One- and two-letter names such as "R", "Go" or "C" are only
 * trusted when the parser listed them as a skill, because in a sentence they match far too much.
 */
function scanTerms(skillId: string): string[] {
  const s = skillById.get(skillId);
  if (!s) return [];
  return [s.name, ...s.aliases].map(normalizeForMatch).filter((t) => t.replace(/[^\p{L}\p{N}]/gu, "").length >= 3 || /[+#.]/.test(t));
}

const yearOf = (date: string | null) => (date ? Number(date.slice(0, 4)) : null);

/** A quote that only names skills, such as "SQL, Excel, Power BI", shows no use of them. */
function isListLine(quote: string): boolean {
  const q = quote.replace(/^[^:]{0,30}:/, "").trim();
  const words = q.split(/\s+/).filter(Boolean);
  return words.length <= 3 || q.split(/[,|/•·;]/).length >= 3;
}

const statusRank = { missing: 0, outdated: 1, weak: 2, met: 3 } as const;

/**
 * FR-11: compares a confirmed profile with a role profile and classifies every role skill as met, weak,
 * outdated or missing. Plain code over the skill taxonomy, so the same input always gives the same gaps.
 */
export function matchProfile(profile: Profile, role: RoleProfile, now = new Date()): MatchResult {
  const thisYear = now.getUTCFullYear();
  const evidence = new Map<string, Evidence[]>();
  const add = (skillId: string, e: Evidence) => evidence.set(skillId, [...(evidence.get(skillId) ?? []), e]);

  // When was each highlight written? The job's end year, or this year for a current job.
  const yearOfLine = new Map<string, number>();
  for (const r of profile.roles) {
    const year = r.end ? yearOf(r.end) : thisYear;
    for (const h of r.highlights) if (year !== null) yearOfLine.set(normalizeForMatch(h), year);
  }
  const lineYear = (quote: string) => yearOfLine.get(normalizeForMatch(quote)) ?? null;

  // 1. Skills the parser listed, mapped by exact name or alias.
  for (const s of profile.skills) {
    const id = taxonomyId(s.name);
    if (!id) continue;
    const quotes = s.evidence.filter((q) => !isListLine(q));
    const year = yearOf(s.lastUsed);
    if (quotes.length === 0) add(id, { quote: s.evidence[0] ?? null, listedOnly: true, year });
    for (const q of quotes) add(id, { quote: q, listedOnly: false, year: year ?? lineYear(q) });
  }

  // 2. Role skills named in job highlights or evidence lines, even if the parser didn't list them.
  const lines = [...profile.roles.flatMap((r) => r.highlights), ...profile.skills.flatMap((s) => s.evidence)].filter((l) => !isListLine(l));
  for (const rs of role.skills) {
    const terms = scanTerms(rs.skillId);
    for (const line of lines) {
      const text = normalizeForMatch(line);
      if (terms.some((t) => containsPhrase(text, t))) add(rs.skillId, { quote: line, listedOnly: false, year: lineYear(line) });
    }
  }

  const classify = (skillId: string): Pick<MatchedSkill, "status" | "resumeQuote"> => {
    const found = evidence.get(skillId) ?? [];
    const used = found.filter((e) => !e.listedOnly);
    const recent = used.find((e) => e.year === null || thisYear - e.year <= OUTDATED_AFTER_YEARS);
    if (recent) return { status: "met", resumeQuote: recent.quote };
    if (used.length > 0) {
      const latest = used.reduce((a, b) => ((a.year ?? 0) >= (b.year ?? 0) ? a : b));
      return { status: "outdated", resumeQuote: latest.quote };
    }
    const listed = found.find((e) => e.listedOnly);
    if (listed) {
      const stale = listed.year !== null && thisYear - listed.year > OUTDATED_AFTER_YEARS;
      return { status: stale ? "outdated" : "weak", resumeQuote: listed.quote };
    }
    return { status: "missing", resumeQuote: null };
  };

  const rows = role.skills.map((rs) => ({
    importance: rs.importance,
    row: {
      skillId: rs.skillId,
      skillName: skillById.get(rs.skillId)?.name ?? rs.skillId,
      requirement: rs.expectation,
      postingShare: rs.postingShare,
      ...classify(rs.skillId),
    } satisfies MatchedSkill,
  }));
  const byImportance = (a: MatchedSkill, b: MatchedSkill) =>
    (b.postingShare ?? -1) - (a.postingShare ?? -1) || statusRank[a.status] - statusRank[b.status];

  const required = rows.filter((r) => r.importance === "required").map((r) => r.row);
  const gaps = required.filter((r) => r.status !== "met").sort(byImportance);
  const met = required.filter((r) => r.status === "met");
  return {
    matcherVersion: MATCHER_VERSION,
    roleSlug: role.slug,
    gaps,
    met,
    niceToHave: rows.filter((r) => r.importance === "nice_to_have").map((r) => r.row).sort(byImportance),
    readiness: {
      requiredTotal: required.length,
      requiredMet: met.length,
      estimatedHours: gaps.reduce((sum, g) => sum + HOURS_BY_STATUS[g.status as keyof typeof HOURS_BY_STATUS], 0),
    },
  };
}

/** The taxonomy id for a skill name, by exact name or alias after lowercasing. */
export function taxonomyId(name: string): string | undefined {
  return skillIdByTerm.get(normalizeSkillTerm(name));
}
