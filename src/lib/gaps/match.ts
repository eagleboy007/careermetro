import { z } from "zod";
import { certifications, normalizeSkillTerm, skillIdByTerm, skills as taxonomy } from "@/content";
import { containsPhrase, normalizeForMatch } from "@/lib/resume/verify";
import { gapStatus, skillGroups, type Profile, type RoleProfile } from "@/lib/schemas";

/** Bump when the rules below change, so stored analyses say which rules produced them. */
const RULES_VERSION = "matcher/v8";

/** FNV-1a over the text, as 8 hex digits. Enough to tell two versions of the content apart; not for security. */
export function contentHash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/**
 * The rules plus the skill and certification lists they read. A new alias or certification changes the version, so a
 * stored analysis is checked again (and carried over when it still reads the same). Role edits are pinned separately by
 * the role profile's own version.
 */
export const MATCHER_VERSION = `${RULES_VERSION}+${contentHash(JSON.stringify([taxonomy, certifications]))}`;

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
  /** Set when this row stands for a "one of these" group: the group's best skill, or the suggested one when none is shown. */
  group: z.object({ id: z.string(), label: z.string(), skillIds: z.array(z.string()), met: z.array(z.string()) }).optional(),
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
  /** The role's "one of these" groups and their skills. */
  groups: z.array(z.object({ id: z.string(), skillIds: z.array(z.string()) })),
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

/** "testing" reads "test" only after these: "an A/B test", "unit tests". Not "load tests" (a pile) or "acceptance tests" (switchgear). */
const TEST_KINDS = new Set(["a/b", "ab", "split", "unit", "api", "penetration", "pen", "usability", "hypothesis", "regression"]);

/**
 * The everyday forms of a normalised term, itself first:
 * - "-isation" and "-ization" respell either way ("normalisation"), and as the last of two or more words also take
 *   their verb forms ("data visualised"). A single word keeps its noun, so "containerised cargo" never reads Docker.
 * - The last of two or more words takes its plural ("product roadmaps", "data qualities").
 * - "testing" after a kind of test also reads "test" and "tests" ("an A/B test").
 * Single words otherwise keep their form, so "excel" never reads "excels at".
 */
export function inflections(term: string): string[] {
  const words = term.split(" ");
  const options = words.map((word, i) => {
    const forms = new Set([word]);
    const last = i === words.length - 1 && words.length > 1;
    const ization = /^(\p{L}{3,})i[sz]ation$/u.exec(word);
    if (ization) {
      for (const z of ["s", "z"]) for (const end of last ? ["ation", "e", "ed", "es", "ing"] : ["ation"]) forms.add(`${ization[1]}i${z}${end}`);
    } else if (last && word === "testing") {
      if (TEST_KINDS.has(words[i - 1])) forms.add("test").add("tests");
    } else if (last && /\p{L}{3,}$/u.test(word) && !/(?:s|ing)$/.test(word)) {
      forms.add(/[^aeiou]y$/.test(word) ? `${word.slice(0, -1)}ies` : /(?:x|ch|sh)$/.test(word) ? `${word}es` : `${word}s`);
    }
    return [...forms];
  });
  return options.reduce<string[]>((acc, forms) => acc.flatMap((p) => forms.map((f) => (p ? `${p} ${f}` : f))), [""]);
}

/**
 * Terms safe to look for in free text. One- and two-letter names such as "R", "Go" or "C", and terms marked
 * ambiguous because they are also ordinary words ("react", "containers"), are only trusted when the parser
 * listed the skill, because in a sentence they match far too much.
 */
const scanCache = new Map<string, string[]>();
function scanTerms(skillId: string): string[] {
  const cached = scanCache.get(skillId);
  if (cached) return cached;
  const s = skillById.get(skillId);
  if (!s) return [];
  const ambiguous = new Set(s.ambiguous.map(normalizeForMatch));
  const terms = [s.name, ...s.aliases]
    .map(normalizeForMatch)
    .filter((t) => !ambiguous.has(t) && distinctive(t))
    .flatMap(inflections);
  scanCache.set(skillId, terms);
  return terms;
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
    return [s.id.replace(/-/g, " "), s.name, ...s.aliases].flatMap((t) => {
      const n = normalizeForMatch(t);
      const safe = !ambiguous.has(n) && distinctive(n);
      return inflections(n).map((v) => ({ skillId: s.id, tokens: tokens(v), safe }));
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
const NOT_ABOUT_USE = /\b(?:injection|teaching|mentoring|coffee|reading|hobby|hobbies)\b/i;

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

/**
 * A clause that is a plan, not a pass: "Pursuing CISSP", "CISA, appearing Nov 2026", "AZ-104 – will take in March".
 * Kept to phrases about the exam itself, so "Attempted 40 labs", "Ongoing CPE credits" or "endorsement pending" leave a
 * held certificate alone.
 */
const NOT_HELD =
  /\b(?:pursuing|preparing|preparation|expected|appearing|appear(?:ed)? (?:for|in)|to appear|scheduled|awaiting|awaited|upcoming|applied for|planned|planning to|registered (?:for|to)|enrolled|studying for|aspiring|will (?:appear|take|sit|write|attempt|complete|give|clear)|not (?:yet|cleared|passed|completed)|part[ -]?(?:1|i)\b)|^\s*not\b|(?<!\b(?:cpe|credits?|endorsement)\s)\b(?:in[ -]progress|pending|ongoing)\b(?!\s(?:cpe|credits?|endorsement))/i;

/** Dates that are not when the certificate was earned: its expiry or renewal, or digits inside an ID. */
const NOT_EARNED_DATE =
  /\b(?:valid(?:ity)?(?: (?:till|until|upto|up to|through|to))?|till|until|upto|expir(?:es|y|ing)|exp|renewal(?: due)?|renew(?: by)?|id|no|number|credential)\b[.:#-]? ?(?:on |by |in )?(?:[a-z]{3,9}\.? ?)?(?:\d{1,2}[/.-])?(?:19|20)\d\d\b/g;

/** A standard's version ("27001:2013"), never a year range ("2012-2016"). */
const VERSION_YEAR = /\b(?!(?:19|20)\d\d\b)(\d{3,5})[:-](?:19|20)\d\d\b/g;

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const EARNED_DATE = /\b(?:(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?[ ,'-]{0,2}|(\d{1,2})[/.-])?(19[89]\d|20\d\d)\b/g;

/**
 * When a clause says the pass happened, as months (a year alone counts as its December): the latest date not after
 * now. "plan" when every date it gives is still ahead ("exam due March 2027"); null when it gives none. A past date
 * wins over a future one, so "Mar 2024 – Mar 2027" reads as passed in March 2024.
 */
function earnedMonths(text: string, nowMonths: number): number | null | "plan" {
  // Standard versions ("ISO 27001:2013") and expiry or ID digits are not pass dates.
  const plain = text.toLowerCase().replace(VERSION_YEAR, " ").replace(NOT_EARNED_DATE, " ");
  let latest: number | null = null;
  let future = false;
  for (const [, name, num, year] of plain.matchAll(EARNED_DATE)) {
    const month = name ? MONTHS.indexOf(name) : num && Number(num) >= 1 && Number(num) <= 12 ? Number(num) - 1 : 11;
    const months = Number(year) * 12 + month;
    // A bare year is its December, so this year's pass is not "ahead" before December.
    if (months > nowMonths && !(Number(year) * 12 <= nowMonths && !name && !num)) future = true;
    else if (latest === null || months > latest) latest = Math.min(months, nowMonths);
  }
  return latest === null && future ? "plan" : latest;
}

/**
 * A certification's pass date field as months, or "plan" when it is ahead of `nowMonths` (a booked exam). A bare
 * year counts as its December, so this year's pass is not "ahead" before December.
 */
function earnedField(date: string | null, nowMonths: number): number | null | "plan" {
  const months = toMonths(date);
  if (months === null) return null;
  if (months <= nowMonths) return months;
  return /^\d{4}$/.test(date!) && Number(date) * 12 <= nowMonths ? nowMonths : "plan";
}

/** The certifications a piece of text names, by full name or alias. */
const certTerms = certifications.map((c) => ({ cert: c, terms: [c.name, ...c.aliases].map(normalizeForMatch).filter(Boolean) }));
const namedIn = (text: string) => certTerms.filter(({ terms }) => terms.some((t) => containsPhrase(text, t))).map(({ cert }) => cert);

/**
 * The certifications a resume line shows as passed, with when. Each ";" part is read per certificate: each clause that
 * names one starts a group, and the clauses after it ("CISSP, 2019", "CISA, appearing Nov 2026") belong to it. A group
 * with a plan word, or only pass dates after `now`, is a plan and counts for nothing; so is a whole line that opens with
 * one ("Preparing for: CISSP, CISA"), and a list a plan word opens ("Pursuing CISA, CISM") up to a dated certificate.
 */
export function certificationsIn(line: string, now = new Date()): { cert: (typeof certifications)[number]; months: number | null }[] {
  const nowMonths = now.getUTCFullYear() * 12 + now.getUTCMonth();
  const lead = /^([^:]{0,40}):/.exec(line);
  if (lead && NOT_HELD.test(lead[1])) return [];
  const out: { cert: (typeof certifications)[number]; months: number | null }[] = [];
  for (const part of line.split(";")) {
    const groups: { certs: ReturnType<typeof namedIn>; text: string }[] = [];
    for (const clause of part.split(",")) {
      // "ISO/IEC 27001:2013 Lead Auditor" names the same certificate as "ISO/IEC 27001 Lead Auditor".
      const certs = namedIn(normalizeForMatch(clause.replace(VERSION_YEAR, "$1")));
      if (certs.length || groups.length === 0) groups.push({ certs, text: clause });
      else groups[groups.length - 1].text += `, ${clause}`;
    }
    // A plan word before the first certificate ("Pursuing CISA, CISM") covers the ones after it, unless they give a date.
    const opening = NOT_HELD.exec(groups[0].text);
    let planned = !!opening && namedIn(normalizeForMatch(groups[0].text.slice(opening.index + opening[0].length))).length > 0;
    for (const g of groups) {
      if (!g.certs.length) continue;
      const months = NOT_HELD.test(g.text) ? "plan" : earnedMonths(g.text, nowMonths);
      if (months === "plan" || (planned && months === null)) continue;
      planned = false;
      for (const cert of g.certs) if (!out.some((o) => o.cert.id === cert.id)) out.push({ cert, months });
    }
  }
  return out;
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
  /** The newest job a quote appears in, or with `oldest` the oldest one. Null when unknown. */
  const lineMonths = (quote: string, oldest = false): number | null => {
    const q = normalizeForMatch(quote);
    const key = `${oldest ? "o" : "n"}|${q}`;
    if (monthsCache.has(key)) return monthsCache.get(key)!;
    const hits = dated.filter((d) => d.text === q || containsPhrase(d.text, q)).map((d) => d.months);
    const known = hits as number[];
    const months = hits.length === 0 || hits.includes(null) ? null : oldest ? Math.min(...known) : Math.max(...known);
    monthsCache.set(key, months);
    return months;
  };

  // 1. Skills the parser listed, mapped by exact name or alias, else by the distinctive taxonomy terms that
  //    make up the whole name or its list items ("MS-Excel", "Python (Pandas, NumPy)"), never by a word inside
  //    a longer name such as "Go-to-market strategy".
  for (const s of profile.skills) {
    const exact = taxonomyId(s.name);
    const read = exact ? null : readTerms(s.name, safeTermTokens);
    const list = !exact && isListLine(s.name);
    // A name with a few extra words ("SQL Server Management Studio") must still be about the skill: not attacking it,
    // teaching it or a hobby, and its evidence counts as use only where the quote names the skill itself.
    const loose = !exact && !list && !!read && read.leftover > 1;
    const named = exact || list || (!!read && namesSkills(read) && !(loose && NOT_ABOUT_USE.test(s.name)));
    const ids = named && !exact ? [...read!.skillIds] : exact ? [exact] : [];
    const lastUsed = toMonths(s.lastUsed);
    for (const id of ids) {
      const terms = [normalizeForMatch(s.name), ...scanTerms(id)];
      const names = (q: string) => !loose || scanTerms(id).some((t) => containsPhrase(normalizeForMatch(q), t));
      const used = s.evidence.filter((q) => !isListLine(q) && !learningAbout(q, terms) && names(q));
      if (used.length === 0) add(id, { quote: s.evidence[0] ?? s.name, listedOnly: true, months: lastUsed });
      for (const q of used) {
        // The parser's lastUsed can be a current job's start year; the job the quote comes from wins when it is newer.
        // A quote that doesn't name the skill takes the oldest job it appears in, so a short fragment shared with a
        // newer bullet can't borrow that bullet's date.
        if (lastUsed === null) {
          add(id, { quote: q, listedOnly: false, months: lineMonths(q) });
          continue;
        }
        const own = terms.some((t) => containsPhrase(normalizeForMatch(q), t));
        const line = lineMonths(q, !own);
        const months = line === null ? lastUsed : Math.max(lastUsed, line);
        add(id, { quote: q, listedOnly: false, months });
      }
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

  // 3. Certifications on the resume: a held certification shows the skills it tests (met) and touches others (weak).
  //    A plan to sit one counts for nothing. This is only the resume read: a met skill can mark its goal met, never
  //    proved, since only accepted proof (gap_proofs) proves a goal and moves the train.
  for (const c of profile.certifications) {
    const passed = earnedField(c.earned, nowMonths);
    if (passed === "plan") continue;
    // A certificate past its expiry date shows what it tested only as weak: it was true once, it isn't current.
    const expired = c.expires !== null && c.expires !== "none" && toMonths(c.expires)! < nowMonths;
    for (const found of certificationsIn(c.name, now)) {
      const months = passed ?? found.months;
      // With no pass date the certificate could be ten years old, so it shows the skills it tests only as weak and
      // never lifts an outdated skill to met.
      for (const id of found.cert.proves) add(id, { quote: c.name, listedOnly: months === null || expired, months });
      for (const id of found.cert.partial) add(id, { quote: c.name, listedOnly: true, months });
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

  const rows: { importance: RoleProfile["skills"][number]["importance"]; row: MatchedSkill }[] = role.skills.map((rs) => ({
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

  // A "one of these" group counts once, as its strongest skill (ties go to the one more postings ask for). With none
  // shown it is one gap under the group's label, suggesting the skill most postings ask for.
  const groups = skillGroups(role);
  const groupOf = new Map(groups.flatMap((g) => g.skillIds.map((id) => [id, g] as const)));
  const strongest = (a: MatchedSkill, b: MatchedSkill) =>
    statusRank[b.status] - statusRank[a.status] || (b.postingShare ?? -1) - (a.postingShare ?? -1);
  const collapsed: typeof rows = [];
  for (const r of rows) {
    const g = groupOf.get(r.row.skillId);
    if (!g) {
      collapsed.push(r);
      continue;
    }
    if (g.skillIds[0] !== r.row.skillId) continue;
    const members = rows.filter((m) => g.skillIds.includes(m.row.skillId)).map((m) => m.row).sort(strongest);
    const best = members[0];
    const met = members.filter((m) => m.status === "met").map((m) => m.skillId);
    const group = { id: g.id, label: g.label, skillIds: g.skillIds, met };
    collapsed.push({ importance: "required", row: { ...best, skillName: best.status === "missing" ? g.label : best.skillName, group } });
  }

  // A context skill (communication, problem solving) counts when the resume shows it and is never a gap: keywords
  // can't judge it, so Practice checks it instead.
  const scored = (r: MatchedSkill) => r.status === "met" || skillById.get(r.skillId)?.scoring !== "context";
  const required = collapsed.filter((r) => r.importance === "required" && scored(r.row)).map((r) => r.row);
  const gaps = required.filter((r) => r.status !== "met").sort(byImportance);
  const met = required.filter((r) => r.status === "met");
  return {
    matcherVersion: MATCHER_VERSION,
    roleSlug: role.slug,
    gaps,
    met,
    niceToHave: rows.filter((r) => r.importance === "nice_to_have" && scored(r.row)).map((r) => r.row).sort(byImportance),
    groups: groups.map(({ id, skillIds }) => ({ id, skillIds })),
    readiness: {
      requiredTotal: required.length,
      requiredMet: met.length,
      estimatedHours: gaps.reduce((sum, g) => sum + HOURS_BY_STATUS[g.status as keyof typeof HOURS_BY_STATUS], 0),
    },
  };
}

/** Every required skill the resume shows: a met group counts once, but each of its shown skills is met. */
export function metSkillIds(match: Pick<MatchResult, "met">): string[] {
  return match.met.flatMap((m) => m.group?.met ?? [m.skillId]);
}

/** The taxonomy id for a skill name, by exact name or alias after lowercasing. */
export function taxonomyId(name: string): string | undefined {
  return skillIdByTerm.get(normalizeSkillTerm(name));
}

/**
 * The taxonomy skills a short text names by a term safe in free text ("Data analysis with SQL" names SQL), for links
 * between moments on the Life line. Ambiguous and very short terms are left out, as in sentences.
 */
export function skillsNamedIn(text: string): Set<string> {
  return readTerms(text, safeTermTokens).skillIds;
}
