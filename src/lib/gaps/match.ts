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

/** `months` counts months since year 0, so ages compare to the month. Null means the date is unknown. */
type Evidence = { quote: string | null; listedOnly: boolean; months: number | null };

const skillById = new Map(taxonomy.map((s) => [s.id, s]));

/**
 * Terms safe to look for in free text. One- and two-letter names such as "R", "Go" or "C", and terms marked
 * ambiguous because they are also ordinary words ("react", "containers"), are only trusted when the parser
 * listed the skill, because in a sentence they match far too much.
 */
function scanTerms(skillId: string): string[] {
  const s = skillById.get(skillId);
  if (!s) return [];
  const ambiguous = new Set(s.ambiguous.map(normalizeForMatch));
  return [s.name, ...s.aliases]
    .map(normalizeForMatch)
    .filter((t) => !ambiguous.has(t))
    .filter((t) => t.replace(/[^\p{L}\p{N}]/gu, "").length >= 3 || /[+#.]/.test(t));
}

/** "2022" or "2022-03" as months since year 0. A bare year counts as its December, the generous reading. */
function toMonths(date: string | null): number | null {
  if (!date) return null;
  const [y, m] = date.split("-").map(Number);
  return Number.isFinite(y) ? y * 12 + (m ? m - 1 : 11) : null;
}

const TOKEN_SPLIT = /[^\p{L}\p{M}\p{N}+#.&]+/u;
const tokens = (text: string) =>
  normalizeForMatch(text)
    .split(TOKEN_SPLIT)
    .map((t) => t.replace(/\.+$/, ""))
    .filter(Boolean);

/** Every taxonomy term as tokens, longest first, so "power bi" wins over a shorter overlapping term. */
const termTokens: { skillId: string; tokens: string[] }[] = taxonomy
  .flatMap((s) => [s.id.replace(/-/g, " "), s.name, ...s.aliases].map((t) => ({ skillId: s.id, tokens: tokens(t) })))
  .filter((t) => t.tokens.length > 0)
  .sort((a, b) => b.tokens.length - a.tokens.length);

/** Words that say nothing about use, so they don't stop a line from being a plain list of skills. */
const FILLER = new Set(
  "and & or with in of the a an etc ms microsoft basic basics advanced intermediate expert beginner proficient proficiency good strong knowledge hands-on hands on working familiar tools skills".split(" "),
);

/** The taxonomy skills named in a short text, such as a skill name "Python (Pandas, NumPy)", and the words left over. */
function readTerms(text: string): { skillIds: Set<string>; tokenCount: number; leftover: number } {
  const words = tokens(text);
  const covered = new Array<boolean>(words.length).fill(false);
  const skillIds = new Set<string>();
  for (let i = 0; i < words.length; i++) {
    for (const t of termTokens) {
      if (t.tokens.every((w, k) => words[i + k] === w)) {
        skillIds.add(t.skillId);
        t.tokens.forEach((_, k) => (covered[i + k] = true));
        break;
      }
    }
  }
  const leftover = words.filter((w, i) => !covered[i] && !FILLER.has(w)).length;
  return { skillIds, tokenCount: words.length, leftover };
}

const LIST_HEADER = /^[^:]{0,40}\b(skills?|tools|technolog(y|ies)|tech stack|languages|software|platforms|frameworks|competenc(y|ies)|expertise|proficien(t|cy)(\s+in)?)\s*:/i;

/**
 * A line that only names skills, such as "SQL, Excel, Power BI" or "Skills: Java, Spring", shows no use of them.
 * A real bullet ("Built CI/CD pipelines using Jenkins/GitHub Actions") has words beyond the skill names.
 */
export function isListLine(line: string): boolean {
  if (LIST_HEADER.test(line)) return true;
  const { tokenCount, leftover } = readTerms(line);
  if (tokenCount <= 4 && leftover <= 1) return true;
  const parts = line.split(/[,|•·;]/).filter((p) => p.trim()).length;
  return parts >= 3 && leftover / Math.max(tokenCount, 1) < 0.25;
}

/** Lines about learning or wanting a skill show interest, not use: "Currently learning Python on NPTEL". */
const LEARNING = new RegExp(
  [
    "^\\s*learning\\b",
    "\\b(currently|now|am|presently) (learning|studying)\\b",
    "\\b(keen|eager|want|wanting|willing|plan|planning|hoping|looking) to (learn|explore|gain|build skills)\\b",
    "\\b(basic|some|limited|little) (exposure|knowledge|understanding|familiarity)\\b",
    "\\bfamiliar(ity)? with\\b",
    "\\baspiring\\b",
    "\\binterested in\\b",
    "\\b(enrolled|pursuing|doing|taking) (in )?an? (online )?(course|certification|program)\\b",
    "\\bcourse (on|in)\\b",
  ].join("|"),
  "i",
);

const statusRank = { missing: 0, outdated: 1, weak: 2, met: 3 } as const;

/** A skill and every broader skill it implies, following chains such as Next.js → React → JavaScript. */
function withImplied(skillId: string): string[] {
  const out = [skillId];
  for (let i = 0; i < out.length; i++) for (const id of skillById.get(out[i])?.implies ?? []) if (!out.includes(id)) out.push(id);
  return out;
}

/**
 * When each job's highlights were last true: the end date, now for the current job, and for an older job
 * with no end date the start of the next newer job (the parser gives no end for "Present" and for "not stated").
 */
function roleMonths(roles: Profile["roles"], nowMonths: number): (number | null)[] {
  const starts = roles.map((r) => toMonths(r.start));
  const known = starts.filter((m): m is number => m !== null);
  const newest = known.length ? Math.max(...known) : null;
  return roles.map((r, i) => {
    if (r.end) return toMonths(r.end);
    const start = starts[i];
    if (start === null) return i === 0 ? nowMonths : null;
    if (start === newest) return nowMonths;
    const nextNewer = known.filter((m) => m > start);
    return nextNewer.length ? Math.min(...nextNewer) : start;
  });
}

/**
 * FR-11: compares a confirmed profile with a role profile and classifies every role skill as met, weak,
 * outdated or missing. Plain code over the skill taxonomy, so the same input always gives the same gaps.
 */
export function matchProfile(profile: Profile, role: RoleProfile, now = new Date()): MatchResult {
  const nowMonths = now.getUTCFullYear() * 12 + now.getUTCMonth();
  const evidence = new Map<string, Evidence[]>();
  const add = (skillId: string, e: Evidence) => {
    for (const id of withImplied(skillId)) evidence.set(id, [...(evidence.get(id) ?? []), e]);
  };

  // When was each highlight last true? The same bullet under two jobs keeps the newer date.
  const dated: { text: string; months: number | null }[] = [];
  const ends = roleMonths(profile.roles, nowMonths);
  profile.roles.forEach((r, i) => r.highlights.forEach((h) => dated.push({ text: normalizeForMatch(h), months: ends[i] })));
  const lineMonths = (quote: string): number | null => {
    const q = normalizeForMatch(quote);
    const hits = dated.filter((d) => d.text === q || containsPhrase(d.text, q)).map((d) => d.months);
    if (hits.length === 0 || hits.includes(null)) return null;
    return Math.max(...(hits as number[]));
  };
  const usage = (line: string) => !isListLine(line) && !LEARNING.test(line);

  // 1. Skills the parser listed, mapped by exact name or alias, else by the taxonomy terms in the name ("MS-Excel").
  for (const s of profile.skills) {
    const exact = taxonomyId(s.name);
    const ids = exact ? [exact] : [...readTerms(s.name).skillIds];
    const lastUsed = toMonths(s.lastUsed);
    const used = s.evidence.filter(usage);
    for (const id of ids) {
      if (used.length === 0) add(id, { quote: s.evidence[0] ?? s.name, listedOnly: true, months: lastUsed });
      for (const q of used) add(id, { quote: q, listedOnly: false, months: lastUsed ?? lineMonths(q) });
    }
  }

  // 2. Role skills (and their narrower skills) named in highlights or evidence lines, even if the parser didn't list them.
  const lines = [...profile.roles.flatMap((r) => r.highlights), ...profile.skills.flatMap((s) => s.evidence)].filter((l) => !isListLine(l));
  const wanted = new Set(role.skills.map((rs) => rs.skillId));
  for (const s of taxonomy) {
    if (!withImplied(s.id).some((id) => wanted.has(id))) continue;
    const terms = scanTerms(s.id);
    for (const line of lines) {
      const text = normalizeForMatch(line);
      if (terms.some((t) => containsPhrase(text, t))) add(s.id, { quote: line, listedOnly: LEARNING.test(line), months: lineMonths(line) });
    }
  }

  const fresh = (e: Evidence) => e.months === null || nowMonths - e.months <= OUTDATED_AFTER_YEARS * 12;
  const classify = (skillId: string): Pick<MatchedSkill, "status" | "resumeQuote"> => {
    const found = evidence.get(skillId) ?? [];
    const used = found.filter((e) => !e.listedOnly);
    const recent = used.find(fresh);
    if (recent) return { status: "met", resumeQuote: recent.quote };
    if (used.length > 0) {
      const latest = used.reduce((a, b) => ((a.months ?? 0) >= (b.months ?? 0) ? a : b));
      return { status: "outdated", resumeQuote: latest.quote };
    }
    const listed = found.find((e) => e.listedOnly);
    if (listed) return { status: fresh(listed) ? "weak" : "outdated", resumeQuote: listed.quote };
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
