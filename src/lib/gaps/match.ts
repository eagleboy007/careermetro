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

/** Long enough to trust in a sentence: three letters, or a symbol or digit as in "C++", ".NET" or "S3". */
const distinctive = (t: string) => t.replace(/[^\p{L}\p{N}]/gu, "").length >= 3 || /[+#.\d]/.test(t);

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
    .filter((t) => !ambiguous.has(t) && distinctive(t));
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

type TermTokens = { skillId: string; tokens: string[]; safe: boolean };

/** Every taxonomy term as tokens, longest first, so "power bi" wins over a shorter overlapping term. */
const termTokens: TermTokens[] = taxonomy
  .flatMap((s) => {
    const ambiguous = new Set(s.ambiguous.map(normalizeForMatch));
    return [s.id.replace(/-/g, " "), s.name, ...s.aliases].map((t) => {
      const n = normalizeForMatch(t);
      return { skillId: s.id, tokens: tokens(t), safe: !ambiguous.has(n) && distinctive(n) };
    });
  })
  .filter((t) => t.tokens.length > 0)
  .sort((a, b) => b.tokens.length - a.tokens.length);
const safeTermTokens = termTokens.filter((t) => t.safe);

/** Words that say nothing about use, so they don't stop a line from being a plain list of skills. */
const FILLER = new Set(
  "and & or with in of the a an etc ms microsoft basic basics advanced intermediate expert beginner proficient proficiency good strong knowledge hands-on hands on working familiar tools skills".split(" "),
);

/** The taxonomy skills named in a short text, such as a skill name "Python (Pandas, NumPy)", and the words left over. */
function readTerms(text: string, terms: TermTokens[] = termTokens): { skillIds: Set<string>; tokenCount: number; leftover: number } {
  const words = tokens(text);
  const covered = new Array<boolean>(words.length).fill(false);
  const skillIds = new Set<string>();
  for (let i = 0; i < words.length; i++) {
    for (const t of terms) {
      if (t.tokens.every((w, k) => words[i + k] === w)) {
        skillIds.add(t.skillId);
        t.tokens.forEach((_, k) => (covered[i + k] = true));
        break;
      }
    }
  }
  const leftover = words.filter((w, i) => !covered[i] && !FILLER.has(w) && !/^\d+$/.test(w)).length;
  return { skillIds, tokenCount: words.length, leftover };
}

/**
 * A short listed name made of skill terms and a few other words: "SQL Server Management Studio", "Data analysis using
 * Python". Longer names are more likely about something else that merely mentions a skill.
 */
const namesSkills = (read: { tokenCount: number; leftover: number }) => read.leftover <= 3 && read.tokenCount <= 6;

/** Bullets start with what the person did: "Built", "Worked on", "Automated", "Creating", "Develop". */
const NOT_ACTIONS = new Set("skilled experienced versed certified specialized specialised interested advanced required preferred related applied structured distributed embedded".split(" "));
/** Verbs that open a bullet even when the rest is a list of tools: "Worked on Java, Spring Boot, Kafka". */
const STRONG_ACTIONS = new Set(
  "worked built developed created wrote implemented designed managed led handled used migrated deployed maintained delivered".split(" "),
);
const ACTIONS = new Set(
  [
    ...STRONG_ACTIONS,
    ..."wrote led ran made did set drove won own owned work build write lead run make use develop manage handle create prepare design implement maintain support analyse analyze automate test deploy monitor conduct coordinate perform execute".split(" "),
  ],
);
function startsWithAction(text: string): boolean {
  const first = tokens(text)[0] ?? "";
  return !NOT_ACTIONS.has(first) && (ACTIONS.has(first) || /^\p{L}{3,}ed$/u.test(first) || /^\p{L}{3,}ing$/u.test(first));
}

/** Phrases that open a skills summary rather than describe work: "Proficient in MS Office (Word, Excel)". */
const SUMMARY_START = /^\s*(proficient (in|with)|skilled (in|with)|well[- ]versed (in|with)|expertise in|knowledge of|key skills( used)?|skills used|tools used|technologies used|tech stack)\b/i;
/** A label before a colon, as in "Technical skills: Java, SQL", "Tools: Jira" or "Related coursework: DBMS". */
const LIST_HEADER = /^([^:]{0,40}):\s*([\s\S]*)$/;
const HEADER_WORDS = /\b(skills?|tools|technolog(y|ies)|stack|languages|software|platforms|frameworks|competenc(y|ies)|expertise|proficien(t|cy)|course(s|work)?|subjects|areas)\b/i;

/**
 * A line that only names skills, such as "SQL, Excel, Power BI" or "Skills: Java, Spring", shows no use of them.
 * A real bullet ("Built CI/CD pipelines using Jenkins/GitHub Actions", "Worked on Java, Spring Boot, Kafka")
 * starts with what the person did, or has words beyond the skill names.
 */
export function isListLine(line: string): boolean {
  const header = LIST_HEADER.exec(line);
  if (header && HEADER_WORDS.test(header[1])) return !startsWithAction(header[2]);
  if (SUMMARY_START.test(line)) return true;
  // Three or more short items is a list whatever the words are ("Python (Pandas, NumPy, Matplotlib)",
  // "Applied Statistics, Python, R, SQL"), unless it opens with a clear verb.
  const parts = line.split(/[,|•·;]/).filter((p) => p.trim());
  if (parts.length >= 3 && parts.every((p) => tokens(p).length <= 3)) return !STRONG_ACTIONS.has(tokens(line)[0] ?? "");
  if (startsWithAction(line)) return false;
  const { tokenCount, leftover } = readTerms(line);
  if (tokenCount <= 4 && leftover <= 1) return true;
  return parts.length >= 3 && leftover / Math.max(tokenCount, 1) < 0.25;
}

/**
 * Clauses about learning or wanting a skill show interest, not use: "Currently learning Python on NPTEL".
 * Some phrases only count at the start of a clause, so "Mentored aspiring analysts on SQL" is still use.
 */
const LEARNING = new RegExp(
  [
    "\\b(currently|now|presently|am) (learning|studying)\\b",
    "\\b(keen|eager|want|wanting|willing|plan|planning|hoping|looking) to (learn|explore)\\b",
    "\\b(basic|some|limited|little) (exposure|knowledge|understanding|familiarity)\\b",
    "\\b(enrolled|pursuing|doing|taking) (in )?an? (online )?(course|certification|program)\\b",
    "^\\s*(completed|did|took|attended|finished) (an? |the )?([\\w-]+ )?(course|certification|workshop|bootcamp)\\b",
    "^\\s*(i am |i'm |am )?(learning (?!and\\b|&)|studying\\b|aspiring\\b|interested in\\b|familiar(ity)? with\\b|exposure to\\b)",
  ].join("|"),
  "i",
);

/** The clauses of a line: "Automated MIS in Python; now learning Power BI" has two. */
const clauses = (line: string) => normalizeForMatch(line).split(/;|\.\s|\s\bbut\b\s|(?:,|\sand)\s*(?=(?:now|currently|also)\b)/);

/** True when the clause that names the skill is about learning it. With no terms, any clause counts. */
function learningAbout(line: string, terms: string[]): boolean {
  return clauses(line).some((c) => LEARNING.test(c) && (terms.length === 0 || terms.some((t) => containsPhrase(c, t))));
}

const statusRank = { missing: 0, outdated: 1, weak: 2, met: 3 } as const;

/** A skill and every broader skill it implies, following chains such as Next.js → React → JavaScript. */
function withImplied(skillId: string): string[] {
  const out = [skillId];
  for (let i = 0; i < out.length; i++) for (const id of skillById.get(out[i])?.implies ?? []) if (!out.includes(id)) out.push(id);
  return out;
}

/**
 * When each job's highlights were last true: the end date, now for the current job, and for an older job
 * with no end date the start of the next newer job (the parser gives no end both for "Present" and for
 * "not stated"). When any start date is missing, the list order decides which job is current, since resumes
 * list the newest first. A job with no dates at all counts as recent: nothing says it is old.
 */
function roleMonths(roles: Profile["roles"], nowMonths: number): (number | null)[] {
  const starts = roles.map((r) => toMonths(r.start));
  const allKnown = starts.every((m) => m !== null);
  const known = starts.filter((m): m is number => m !== null);
  const newest = allKnown && known.length ? Math.max(...known) : null;
  return roles.map((r, i) => {
    if (r.end) return toMonths(r.end);
    const start = starts[i];
    if (allKnown ? start === newest : i === 0) return nowMonths;
    if (start === null) return null;
    if (!allKnown) return starts.slice(0, i).reverse().find((m): m is number => m !== null) ?? start;
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
    for (const id of withImplied(skillId)) {
      const list = evidence.get(id);
      if (list) list.push(e);
      else evidence.set(id, [e]);
    }
  };

  // When was each highlight last true? The same bullet under two jobs keeps the newer date.
  const dated: { text: string; months: number | null }[] = [];
  const ends = roleMonths(profile.roles, nowMonths);
  profile.roles.forEach((r, i) => r.highlights.forEach((h) => dated.push({ text: normalizeForMatch(h), months: ends[i] })));
  const monthsCache = new Map<string, number | null>();
  const lineMonths = (quote: string): number | null => {
    const q = normalizeForMatch(quote);
    if (monthsCache.has(q)) return monthsCache.get(q)!;
    const hits = dated.filter((d) => d.text === q || containsPhrase(d.text, q)).map((d) => d.months);
    const months = hits.length === 0 || hits.includes(null) ? null : Math.max(...(hits as number[]));
    monthsCache.set(q, months);
    return months;
  };

  // 1. Skills the parser listed, mapped by exact name or alias, else by the distinctive taxonomy terms that
  //    make up the whole name or its list items ("MS-Excel", "Python (Pandas, NumPy)"), never by a word inside
  //    a longer name such as "Go-to-market strategy".
  for (const s of profile.skills) {
    const exact = taxonomyId(s.name);
    const read = exact ? null : readTerms(s.name, safeTermTokens);
    const ids = exact ? [exact] : read && (namesSkills(read) || isListLine(s.name)) ? [...read.skillIds] : [];
    const lastUsed = toMonths(s.lastUsed);
    for (const id of ids) {
      const terms = [normalizeForMatch(s.name), ...scanTerms(id)];
      const used = s.evidence.filter((q) => !isListLine(q) && !learningAbout(q, terms));
      if (used.length === 0) add(id, { quote: s.evidence[0] ?? s.name, listedOnly: true, months: lastUsed });
      for (const q of used) add(id, { quote: q, listedOnly: false, months: lastUsed ?? lineMonths(q) });
    }
  }

  // 2. Role skills (and their narrower skills) named in highlights or evidence lines, even if the parser didn't list them.
  const lines = [...new Set([...profile.roles.flatMap((r) => r.highlights), ...profile.skills.flatMap((s) => s.evidence)])]
    .filter((l) => !isListLine(l))
    .map((line) => ({ line, text: normalizeForMatch(line) }));
  const wanted = new Set(role.skills.map((rs) => rs.skillId));
  for (const s of taxonomy) {
    if (!withImplied(s.id).some((id) => wanted.has(id))) continue;
    const terms = scanTerms(s.id);
    for (const { line, text } of lines) {
      const hit = terms.filter((t) => containsPhrase(text, t));
      if (hit.length) add(s.id, { quote: line, listedOnly: learningAbout(line, hit), months: lineMonths(line) });
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
