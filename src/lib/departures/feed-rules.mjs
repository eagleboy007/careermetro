// Plain-code rules for public job-board postings, shared by skill mining (scripts/jd-mining/mine.mjs) and the daily
// Departures feed (scripts/departures/fetch-feeds.mjs, docs/plans/departures-live-plan.md). Nothing here calls a
// model or the network: the live role comes from the title, the skills from the taxonomy's names and aliases, the
// place from the location fields, and the experience from the years the post states. No post text is kept; only
// what these functions return.
import { experienceBand, placesOf } from "../../../scripts/jd-mining/market.mjs";

/** @typedef {"greenhouse" | "lever" | "ashby" | "smartrecruiters"} Ats */
/** @typedef {"full_time" | "part_time" | "freelance"} FeedWorkType */
/** @typedef {{ id: string; name: RegExp; aliases: RegExp | null }} SkillMatcher */
/**
 * One posting as read from its board, before any rule: its id, title, link, location words, work type, first posted
 * time and its text as lines (headings included). The lines are read for skills and dropped.
 * @typedef {{ externalId: string; title: string; url: string; location: string; remote: boolean; workType: FeedWorkType;
 *   postedAt: Date | null; lines: string[] }} RawPost
 */

/** The feed's limits (plan, "Server checks and limits"). */
export const FEED_LIMITS = {
  boards: 300,
  postsPerBoard: 500,
  openPosts: 10000,
  /** One SmartRecruiters page; the feed reads one page per board, so a full page counts as cut short. */
  smartRecruitersPage: 100,
  timeoutMs: 15_000,
  /** The biggest board answer read. A large Greenhouse board with full descriptions is a few MB. */
  maxBytes: 25 * 1024 * 1024,
  /** Skill ids kept per list. */
  skills: 40,
};

export const USER_AGENT = "CareerMetro jobs (careermetro.vercel.app)";

/** @typedef {"eu"} BoardHost A Greenhouse board on its EU host; every other board is on the default host. */

/** The one public GET per board. A Greenhouse board with `host: "eu"` is read from Greenhouse's EU host. */
export function feedUrl(/** @type {Ats} */ ats, /** @type {string} */ token, /** @type {BoardHost | undefined} */ host = undefined) {
  const t = encodeURIComponent(token);
  if (ats === "greenhouse") return `https://boards-api${host === "eu" ? ".eu" : ""}.greenhouse.io/v1/boards/${t}/jobs?content=true`;
  if (ats === "lever") return `https://api.lever.co/v0/postings/${t}?mode=json`;
  if (ats === "ashby") return `https://api.ashbyhq.com/posting-api/job-board/${t}`;
  return `https://api.smartrecruiters.com/v1/companies/${t}/postings?limit=${FEED_LIMITS.smartRecruitersPage}`;
}

/** The company's careers page on its job board, as job-boards.json lists it. */
export function careersUrlOf(/** @type {Ats} */ ats, /** @type {string} */ token, /** @type {BoardHost | undefined} */ host = undefined) {
  const t = encodeURIComponent(token);
  if (ats === "greenhouse") return `https://job-boards${host === "eu" ? ".eu" : ""}.greenhouse.io/${t}`;
  if (ats === "lever") return `https://jobs.lever.co/${t}`;
  if (ats === "ashby") return `https://jobs.ashbyhq.com/${t}`;
  return `https://jobs.smartrecruiters.com/${t}`;
}

/* The live role, from the title (moved from mine.mjs) ------------------------------------------------------------ */

const NOT_IN_SCOPE = /\b(counsel|attorney|legal|paralegal|sales|account executive|recruit(er|ing)|partner manager)\b/i;
const SENIOR = /\b(director|head of|vice president|vp|principal|staff|chief|intern|internship)\b/i;
// Order matters: the first matching role wins, so a narrower role comes before the broader one that would also match
// ("Cloud security engineer" before security, "SRE" and "Cloud engineer" before DevOps, "React Native" before front end).
export const ROLE_TITLES = {
  "cloud-security-engineer": /\b(cloud security|security engineer,? cloud)\b/i,
  "grc-manager": /\b(grc|governance,? risk|risk and compliance|security governance|it risk|cyber ?risk)\b.*\b(manager|lead)\b/i,
  "privacy-analyst": /\b(privacy|data protection)\b.*\b(analyst|specialist|associate|engineer|consultant)\b/i,
  "information-security-analyst": /\b(information security|infosec|grc|governance,? risk|security (compliance|governance|risk)|it risk|cyber ?risk|risk and compliance|it audit)\b/i,
  "penetration-tester": /\b(penetration test(er|ing)?|pen ?test(er|ing)?|offensive security|red team)\b/i,
  "appsec-engineer": /\b(appsec|application security|product security)\b|\bsoftware (engineer|developer)\b.*\bsecurity\b/i,
  "soc-lead": /\b(soc|security operations cent(er|re)) (lead|manager)\b|\b(lead|manager),? soc\b/i,
  "soc-analyst-l2": /\b(soc|security) analyst,? (l2|ii|2|level ?2)\b|\bl2 soc\b/i,
  "cyber-security-analyst": /\b(security (analyst|engineer|operations|specialist)|soc analyst|cyber ?security|threat|incident respon|detection engineer|blue team)\b/i,
  "database-architect": /\b(database (architect|administrator|engineer|reliability)|dba|data architect|data modeler)\b/i,
  "data-engineer": /\b(data engineer|big data engineer|etl (engineer|developer)|analytics engineer|data platform engineer)\b|\bsoftware (engineer|developer)\b.*\bdata\b/i,
  "ml-engineer": /\b(machine learning|ml|ai|ml ?ops|deep learning|computer vision|nlp) engineer\b|\bsoftware (engineer|developer)\b.*\b(machine learning|ml|ai|ml ?ops)\b/i,
  "data-analyst": /\b(data|analytics|bi|business intelligence|product|insights|reporting) analyst\b/i,
  "business-analyst": /\bbusiness (systems )?analyst\b/i,
  "android-developer": /\bandroid\b.*\b(engineer|developer)\b|\b(engineer|developer)\b.*\bandroid\b/i,
  "ios-developer": /\bios\b.*\b(engineer|developer)\b|\b(engineer|developer)\b.*\bios\b/i,
  "cross-platform-mobile-developer": /\b(react native|flutter|mobile( app)?)\b.*\b(engineer|developer)\b/i,
  // Not a test, front-end, mobile, ML, data, security, cloud or infrastructure title ("Senior Software Engineer, Data"):\n  // the later rules catch those.
  "senior-backend-engineer": /\b(senior|sr\.?|lead) (software|back[- ]?end|java|python|golang|go|node(\.?js)?|server[- ]side) (engineer|developer)\b(?!.*\b(test|qa|sdet|front[- ]?end|ui|mobile|android|ios|full[- ]?stack|machine learning|ml|ai|data|security|infra(structure)?|platform|cloud|sre|site reliability|devops)\b)|^(?!.*\b(test|qa)\b).*\b(software (development )?engineer|sde),? (iii|3)\b/i,
  "java-backend-developer": /\b(back[- ]?end|java|server[- ]side)\b.*\b(engineer|developer)\b|\b(software|backend) (engineer|developer)\b.*\bjava\b/i,
  "frontend-developer": /\b(front[- ]?end|ui|react|web)\b.*\b(engineer|developer)\b|\b(engineer|developer)\b.*\b(front[- ]?end|react)\b/i,
  "full-stack-developer": /\bfull[- ]?stack\b/i,
  "engineering-manager": /\b(engineering manager|manager,? (software )?engineering|software (development|engineering) manager)\b/i,
  "senior-data-scientist": /\b(senior|sr\.?|lead) (data|applied|ml|machine learning) scientist\b/i,
  "data-scientist": /\b(data scientist|machine learning scientist|applied scientist|ml scientist)\b/i,
  "product-manager": /\b(product manager|product owner|associate product manager)\b/i,
  "ui-ux-designer": /\b(ui ?\/? ?ux|ux ?\/? ?ui|ux|ui|product|interaction|visual|experience) designer\b|\bux (researcher|writer)\b/i,
  "qa-automation-engineer": /\b(qa|sdet|test|testing|quality|automation test)\b.*\b(engineer|analyst|developer)\b|\bsdet\b|\bsoftware (development )?engineer\b.*\b(in test|qa|quality)\b/i,
  "site-reliability-engineer": /\b(site reliability|sre)\b/i,
  "cloud-engineer": /\b(cloud( solutions?)? (engineer|architect|consultant|administrator|developer|operations|ops|support engineer)|(aws|azure|gcp|google cloud)( solutions?)? (engineer|architect|consultant|administrator|developer))\b|\bsoftware (engineer|developer)\b.*\bcloud\b/i,
  "devops-engineer": /\b(devops|devsecops|platform engineer|infrastructure engineer)\b|\bsoftware (engineer|developer)\b.*\b(infra(structure)?|platform)\b/i,
  // Last of the engineering roles: a plain "Software Engineer" or "SDE", never a test, embedded or hardware one.
  "software-engineer": /^(?!.*\b(in test|qa|embedded|firmware|hardware|silicon|asic|mechanical|electrical)\b).*\b(software (engineer|developer|development engineer)|sde)\b/i,
  "digital-marketing-executive": /\b(digital|performance|growth|paid|search|seo|sem|social media|content|lifecycle|email) market(ing|er)\b|\b(seo|sem|ppc|paid social|paid search) (specialist|executive|manager|associate)\b/i,
};
const MANAGER_OK = new Set(["product-manager", "digital-marketing-executive", "grc-manager", "soc-lead", "engineering-manager"]);
/** A location in India (moved from mine.mjs). Remote posts count only when they say India too. */
export const INDIA = /\b(india|bengaluru|bangalore|mumbai|pune|hyderabad|chennai|gurgaon|gurugram|noida|delhi|new delhi|kolkata|ahmedabad|jaipur|kochi)\b/i;
const NOT_SOFTWARE = /\b(hardware|manufacturing|supplier|mechanical|electrical|silicon|asic|firmware|validation)\b/i;

/** The live role a title reads as, or null. `text` only settles Java for a backend title. */
export function classify(/** @type {string} */ title, /** @type {string} */ text = "") {
  if (SENIOR.test(title) || NOT_IN_SCOPE.test(title)) return null;
  for (const [slug, re] of Object.entries(ROLE_TITLES)) {
    if (!re.test(title)) continue;
    if (!MANAGER_OK.has(slug) && /\bmanager\b/i.test(title)) continue;
    if (slug === "qa-automation-engineer" && NOT_SOFTWARE.test(title)) continue;
    if (slug === "java-backend-developer" && !/\bjava\b/i.test(title + " " + text)) continue;
    return slug;
  }
  return null;
}

/* Text ------------------------------------------------------------------------------------------------------------- */

export const decode = (/** @type {string} */ s) =>
  s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&");
/** HTML (often escaped twice, as Greenhouse sends it) as one line of plain text. */
export const plain = (/** @type {string | null | undefined} */ html) => decode(decode(html ?? "")).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
export const norm = (/** @type {string} */ s) => s.toLowerCase().replace(/\s+/g, " ").trim();
export const escape = (/** @type {string} */ s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const BLOCK = /<\/?(p|div|br|li|ul|ol|h[1-6]|tr|section|header|strong|b)\b[^>]*>/gi;
/** HTML as lines, one per paragraph, list item or heading, so headings can be told apart from the text under them. */
export function htmlLines(/** @type {string | null | undefined} */ html) {
  return decode(decode(html ?? ""))
    .replace(BLOCK, "\n")
    .replace(/<[^>]+>/g, " ")
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}
/** Plain text as lines. */
export const textLines = (/** @type {string | null | undefined} */ s) =>
  (s ?? "")
    .split(/\r?\n|•/)
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean);

/* Skills, from the taxonomy (moved from mine.mjs) -------------------------------------------------------------- */

// Names that are also plain English words ("excel at", "go to") are matched case-sensitively.
const CASE_SENSITIVE_NAMES = new Set(["excel", "go"]);

/**
 * One matcher per skill over its name and aliases, case-insensitive, whole words only.
 * @param {{ id: string; name: string; aliases: string[] }[]} skills
 * @returns {SkillMatcher[]}
 */
export function skillMatchersFor(skills) {
  return skills.map((s) => {
    const aliases = [...new Set(s.aliases.map(norm))].filter((t) => t.length > 1);
    const bound = (/** @type {string} */ body, /** @type {string} */ flags) => new RegExp(`(?<![A-Za-z0-9])(${body})(?![A-Za-z0-9])`, flags);
    return {
      id: s.id,
      name: bound(escape(s.name), CASE_SENSITIVE_NAMES.has(s.id) ? "" : "i"),
      aliases: aliases.length ? bound(aliases.map(escape).join("|"), "i") : null,
    };
  });
}
export const hasSkill = (/** @type {SkillMatcher} */ m, /** @type {string} */ text) => m.name.test(text) || (m.aliases?.test(text) ?? false);

// A heading line: short, and nothing but the heading words (a trailing colon or a few words more is fine). A
// requirement such as "Strong SQL skills" doesn't start with these words, so it is never taken for one.
const NICE_HEADING = /^(nice[- ]to[- ]haves?|good[- ]to[- ]haves?|preferred|bonus|desirable|it'?s a plus|extra credit|plus points)\b.{0,40}$/i;
const REQUIRED_HEADING =
  /^(requirements?|minimum qualifications|basic qualifications|qualifications|what you('|’)?ll need|what you need|what we('|’)?re looking for|what you bring|must[- ]haves?|required skills|key skills|skills (and|&) experience|who you are|about you)\b.{0,40}$/i;
const OTHER_HEADING =
  /^(about (us|the (role|team|company|job))|responsibilities|key responsibilities|what you('|’)?ll do|what you will do|your role|the role|role overview|job description|benefits|perks|why join|what we offer|who we are|our team|location|compensation|salary|equal opportunity|how to apply)\b.{0,40}$/i;

/**
 * The skills a post names, split as the plan says: under a requirements-style heading they are required, under "Nice
 * to have", "Preferred" or "Bonus" nice to have. With no such heading, every skill found counts as required. A skill
 * in both lists is required. In the order of the taxonomy.
 * @param {string[]} lines
 * @param {SkillMatcher[]} matchers
 * @returns {{ required: string[]; nice: string[] }}
 */
export function skillsOf(lines, matchers) {
  /** @type {Record<"none" | "required" | "nice" | "other", string[]>} */
  const parts = { none: [], required: [], nice: [], other: [] };
  /** @type {"none" | "required" | "nice" | "other"} */
  let section = "none";
  let headed = false;
  for (const raw of lines) {
    const line = raw.replace(/[:：\s]+$/, "");
    if (line.length <= 80) {
      if (NICE_HEADING.test(line)) {
        section = "nice";
        headed = true;
      } else if (REQUIRED_HEADING.test(line)) {
        section = "required";
        headed = true;
      } else if (OTHER_HEADING.test(line)) section = "other";
    }
    parts[section].push(raw);
  }
  const found = (/** @type {string[]} */ ls) => {
    const text = ls.join("\n");
    return text ? matchers.filter((m) => hasSkill(m, text)).map((m) => m.id) : [];
  };
  const required = headed ? found(parts.required) : found([...parts.none, ...parts.required, ...parts.other]);
  const must = new Set(required);
  const nice = headed ? found(parts.nice).filter((id) => !must.has(id)) : [];
  return { required: required.slice(0, FEED_LIMITS.skills), nice: nice.slice(0, FEED_LIMITS.skills) };
}

/* Postings, from each board's answer ----------------------------------------------------------------------------- */

const date = (/** @type {string | number | null | undefined} */ v) => {
  if (v === null || v === undefined || v === "") return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};

/** Work type from the board's own words: part time, contract or freelance, else full time. */
export function workTypeOf(/** @type {string | null | undefined} */ words) {
  const w = (words ?? "").toLowerCase().replace(/[\s_-]+/g, "");
  if (w.includes("parttime")) return /** @type {FeedWorkType} */ ("part_time");
  if (/contract|freelance|temporary|consultant/.test(w)) return /** @type {FeedWorkType} */ ("freelance");
  return /** @type {FeedWorkType} */ ("full_time");
}

const REMOTE = /\b(remote|work from home|wfh|anywhere)\b/i;

/**
 * One posting of a board's answer, already checked by its Zod schema (feed-schemas.mjs), as a RawPost.
 * @param {Ats} ats
 * @param {any} j
 * @param {string} token
 * @returns {RawPost}
 */
export function rawPost(ats, j, token) {
  if (ats === "greenhouse") {
    const location = j.location?.name ?? "";
    return {
      externalId: j.id,
      title: plain(j.title),
      url: j.absolute_url,
      location,
      remote: REMOTE.test(location),
      workType: "full_time",
      postedAt: date(j.first_published) ?? date(j.updated_at),
      lines: htmlLines(j.content),
    };
  }
  if (ats === "lever") {
    const location = [j.categories?.location, ...(j.categories?.allLocations ?? [])].filter(Boolean).join(", ");
    return {
      externalId: j.id,
      title: plain(j.text),
      url: j.hostedUrl,
      location,
      remote: REMOTE.test(location) || /remote/i.test(j.workplaceType ?? ""),
      workType: workTypeOf(j.categories?.commitment),
      postedAt: date(j.createdAt),
      lines: [...textLines(j.descriptionPlain), ...(j.lists ?? []).flatMap((/** @type {any} */ l) => [plain(l.text), ...htmlLines(l.content)]), ...textLines(j.additionalPlain)],
    };
  }
  if (ats === "ashby") {
    const location = [j.location, ...(j.secondaryLocations ?? []).map((/** @type {any} */ l) => l.location)].filter(Boolean).join(", ");
    return {
      externalId: j.id,
      title: plain(j.title),
      url: j.jobUrl,
      location,
      remote: Boolean(j.isRemote) || REMOTE.test(location),
      workType: workTypeOf(j.employmentType),
      postedAt: date(j.publishedAt),
      lines: j.descriptionHtml ? htmlLines(j.descriptionHtml) : textLines(j.descriptionPlain),
    };
  }
  // SmartRecruiters' list answer has no description (one GET per board), so its posts name only the title's skills.
  const loc = j.location ?? {};
  const location = [loc.fullLocation, loc.city, loc.region, loc.country === "in" || loc.country === "IN" ? "India" : loc.country].filter(Boolean).join(", ");
  return {
    externalId: j.id,
    title: plain(j.name),
    url: `https://jobs.smartrecruiters.com/${encodeURIComponent(j.company?.identifier ?? token)}/${encodeURIComponent(j.id)}`,
    location,
    remote: Boolean(loc.remote) || REMOTE.test(location),
    workType: workTypeOf(j.typeOfEmployment?.label),
    postedAt: date(j.releasedDate),
    lines: [],
  };
}

const RANGE = /(?<![\d.])(\d{1,2}) ?(?:-|–|—|to) ?(\d{1,2}) ?(?:\+ ?)?(?:years?|yrs?)\b/gi;
const SINGLE = /(?<![\d.\-–—]|[\-–—] |to )(\d{1,2}) ?(\+|plus)? ?(?:years?|yrs?)\b/gi;
const EXPERIENCE = /experience|\bexp\b|working|industry|hands-on|professional|background|relevant/i;

/**
 * The experience a post states, as the row shows it: "2 to 4 years" or "5+ years", from the highest stated minimum,
 * as /market's band reads it (experienceBand, which also skips company blurbs such as "founded 30 years ago"). Null
 * when the post states no years: never guessed from the title.
 */
export function experienceNoteOf(/** @type {string} */ raw) {
  if (!experienceBand(raw)) return null;
  const text = raw.replace(/\s+/g, " ");
  const near = (/** @type {RegExpMatchArray} */ m) => EXPERIENCE.test(text.slice(Math.max(0, (m.index ?? 0) - 40), (m.index ?? 0) + m[0].length + 60));
  /** @type {{ min: number; max: number | null } | null} */
  let best = null;
  for (const m of text.matchAll(RANGE)) {
    const min = Number(m[1]);
    const max = Number(m[2]);
    if (min <= 15 && max > min && max <= 20 && near(m) && (!best || min > best.min)) best = { min, max };
  }
  for (const m of text.matchAll(SINGLE)) {
    const min = Number(m[1]);
    if (min >= 1 && min <= 15 && near(m) && (!best || min > best.min)) best = { min, max: null };
  }
  if (!best) return null;
  return best.max === null ? `${best.min}+ years` : `${best.min} to ${best.max} years`;
}

/** The place a row shows: "Remote" for a remote India post, else the first Indian city named, else "India". */
export function cityOf(/** @type {string} */ location, /** @type {boolean} */ remote) {
  if (remote) return "Remote";
  return placesOf(location).find((p) => p.city)?.city ?? "India";
}

/** How far ahead of the fetch a posted time may be and still count, as clock skew: it is then the fetch time. */
export const FUTURE_SKEW_MS = 10 * 60 * 1000;

/**
 * A board's posted time as the feed keeps it (T90): a time more than a few minutes after the fetch is wrong, so it
 * is null (unknown) and can't sort to the top of Departures and Today or always survive the caps; one a few minutes
 * ahead is clock skew and becomes the fetch time. Null rather than the fetch time, because a post that stays dated
 * ahead would otherwise be "posted now" again on every run.
 * @param {Date | null} postedAt
 * @param {Date} now the fetch time
 * @returns {Date | null}
 */
export function postedAtOf(postedAt, now) {
  if (!postedAt || postedAt.getTime() <= now.getTime()) return postedAt;
  return postedAt.getTime() - now.getTime() <= FUTURE_SKEW_MS ? new Date(now.getTime()) : null;
}

/**
 * The job_posts row for one posting, or null when the rules leave it out: not in India (a remote post must say
 * India), not an https link, or a title too short to show. Not yet checked by `jobPostRow`; the feed does that.
 * @param {Ats} ats
 * @param {{ token: string; company: string }} board
 * @param {RawPost} post
 * @param {SkillMatcher[]} matchers
 * @param {Date} [now] the fetch time, for a posted time dated ahead of it (postedAtOf)
 */
export function postRow(ats, board, post, matchers, now = new Date()) {
  if (!INDIA.test(post.location) && !placesOf(post.location).length) return null;
  if (!/^https:\/\/[^\s"<>]+$/.test(post.url ?? "") || post.url.length > 500) return null;
  const title = post.title.length > 160 ? `${post.title.slice(0, 159).trimEnd()}…` : post.title;
  if (title.length < 2) return null;
  const text = post.lines.join("\n");
  const skills = skillsOf(post.lines.length ? post.lines : [post.title], matchers);
  return {
    ats,
    boardToken: board.token,
    externalId: String(post.externalId).slice(0, 120),
    url: post.url,
    title,
    company: board.company,
    city: cityOf(post.location, post.remote),
    workType: post.workType,
    experienceNote: experienceNoteOf(text),
    roleSlug: classify(title, text),
    requiredSkillIds: skills.required,
    niceSkillIds: skills.nice,
    postedAt: postedAtOf(post.postedAt, now),
  };
}

/**
 * The caps: at most `perBoard` posts a board and `total` in all, the newest kept (by posted time, then id).
 * @template {{ boardToken: string; ats: string; externalId: string; postedAt: Date | null }} T
 * @param {T[]} rows
 * @returns {T[]}
 */
export function capPosts(rows, perBoard = FEED_LIMITS.postsPerBoard, total = FEED_LIMITS.openPosts) {
  const newest = [...rows].sort((a, b) => (b.postedAt?.getTime() ?? 0) - (a.postedAt?.getTime() ?? 0) || a.externalId.localeCompare(b.externalId));
  /** @type {Map<string, number>} */
  const perKey = new Map();
  const kept = [];
  for (const r of newest) {
    const key = `${r.ats}:${r.boardToken}`;
    const n = perKey.get(key) ?? 0;
    if (n >= perBoard) continue;
    perKey.set(key, n + 1);
    kept.push(r);
    if (kept.length >= total) break;
  }
  return kept;
}
