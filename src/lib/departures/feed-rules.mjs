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
  /** One SmartRecruiters page, and the most pages read per board; India posts past them leave the board cut short. */
  smartRecruitersPage: 100,
  smartRecruitersPages: 20,
  timeoutMs: 15_000,
  /** The biggest board answer read. A large Greenhouse board with full descriptions is a few MB. */
  maxBytes: 25 * 1024 * 1024,
  /** Skill ids kept per list. */
  skills: 40,
  /**
   * The least time between two SmartRecruiters requests across the run, and the longest Retry-After waited on a 429:
   * SmartRecruiters publishes 10 requests a second and 8 at once; the feed stays near 6 a second and at most 4 at once.
   */
  smartRecruitersGapMs: 160,
  retryAfterMaxMs: 10_000,
  /** Runs in a row a board fails or keeps no India post before the run summary and /api/health name it. */
  badRuns: 3,
};

/** Names CareerMetro and where an employer reads how its board is used and asks for it to be removed (/terms#job-boards). */
export const USER_AGENT = "CareerMetroJobs/1.0 (+https://careermetro.vercel.app/terms#job-boards)";

/** @typedef {"eu"} BoardHost A Greenhouse board on its EU host; every other board is on the default host. */

/**
 * The one public GET per board. A Greenhouse board with `host: "eu"` is read from Greenhouse's EU host. SmartRecruiters
 * answers a page at a time, asked for India posts only; `offset` reads a later page.
 */
export function feedUrl(/** @type {Ats} */ ats, /** @type {string} */ token, /** @type {BoardHost | undefined} */ host = undefined, offset = 0) {
  const t = encodeURIComponent(token);
  if (ats === "greenhouse") return `https://boards-api${host === "eu" ? ".eu" : ""}.greenhouse.io/v1/boards/${t}/jobs?content=true`;
  if (ats === "lever") return `https://api.lever.co/v0/postings/${t}?mode=json`;
  if (ats === "ashby") return `https://api.ashbyhq.com/posting-api/job-board/${t}`;
  return `https://api.smartrecruiters.com/v1/companies/${t}/postings?country=in&limit=${FEED_LIMITS.smartRecruitersPage}${offset ? `&offset=${offset}` : ""}`;
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
// "Member of Technical Staff" is a plain engineering title, not a staff-level one.
const SENIOR = /\b(director|head of|vice president|vp|principal|(?<!technical )staff|chief|intern|internship)\b/i;
// The principal, staff and head-of titles that a senior role is built for, so they read as it rather than being dropped.
const SENIOR_TITLES = /\b(principal|staff) (data architect|database engineer|back[- ]?end (engineer|developer)|data scientist)\b|\bhead of (engineering|grc|security operations|soc)\b/i;
// Order matters: the first matching role wins, so a narrower role comes before the broader one that would also match
// ("Cloud security engineer" before security, "SRE" and "Cloud engineer" before DevOps, "React Native" before front end).
export const ROLE_TITLES = {
  // An architect title before the analyst and engineer rules that would also read "security" in it ("Cloud Security Architect").
  "security-architect": /\b(security|cyber ?security|infosec|zero trust) (solutions? )?architect\b|\barchitect,? (information |cyber ?)?security\b/i,
  "cloud-security-engineer": /\b(cloud security|security engineer,? cloud|(aws|azure|gcp|google cloud) security (engineer|analyst|specialist)|cspm (engineer|analyst|specialist))\b/i,
  "grc-manager": /\b(grc|governance,? risk|risk and compliance|security governance|it risk|cyber ?risk|isms|(information )?security compliance)\b.*\b(manager|lead)\b|\bhead of grc\b/i,
  "privacy-analyst": /\b(privacy|data protection|dpdp|gdpr)\b.*\b(analyst|specialist|associate|engineer|consultant)\b/i,
  // A plant or control-system security title before the broad security rules.
  "ot-security-engineer": /\b(ot\/ics|ot|ics|scada|operational technology) (cyber ?security|security)\b|\bindustrial cyber ?security\b/i,
  // Security built into pipelines, before the security and DevOps rules that would read either half of it.
  "devsecops-engineer": /\bdevsecops\b|\b(security platform|ci\/cd security|pipeline security) engineer\b/i,
  "iam-engineer": /^(?=.*\b(engineer|analyst|developer|specialist|consultant|administrator|admin)\b).*\b(iam|idam|identity (and |& )?access( management)?|identity (governance|management|security)|access management|sailpoint|saviynt|okta|cyberark|ping ?identity|privileged access( management)?|pam)\b/i,
  "information-security-analyst": /\b(information security|infosec|grc|governance,? risk|security (compliance|governance|risk)|it risk|cyber ?risk|risk and compliance|it audit|isms|it compliance|third[- ]party risk)\b/i,
  "penetration-tester": /\b(penetration test(er|ing)?|pen ?test(er|ing)?|offensive security|red team|ethical hack(er|ing)|security tester|vulnerability assessment (analyst|engineer|specialist))\b/i,
  // After the penetration testing rule, so a "VAPT" pen tester title stays there.
  "vulnerability-management-analyst": /\b(vulnerability (management|analyst|engineer|specialist)|vapt analyst|qualys (analyst|engineer)|cyber hygiene)\b/i,
  "appsec-engineer": /\b(appsec|application security|product security|software security (engineer|analyst)|secure code review(er)?)\b|\bsoftware (engineer|developer)\b.*\bsecurity\b/i,
  "soc-lead": /\b(soc( shift)?|security operations( cent(er|re))?|cyber defen[cs]e|detection (and|&) response) (lead|manager)\b|\b(lead|manager),? soc\b|\bhead of (security operations|soc)\b/i,
  // Detection and hunting titles are L2 work, before the broad security rule that would read "threat" in them.
  "soc-analyst-l2": /\b(soc|security) analyst,? (l2|ii|2|level ?2)\b|\bl2 soc\b|\b(senior|sr\.?) soc analyst\b|\b(security operations|cyber defen[cs]e|siem) analyst\b|\bdetection engineer\b|\bthreat hunter\b/i,
  "threat-intelligence-analyst": /^(?=.*\b(analyst|engineer|specialist|researcher|consultant)\b).*\b(threat intel(ligence)?|cti|threat research|dark web)\b/i,
  "incident-response-analyst": /\b(incident respon(se|der)s?|incident handl(er|ing)|dfir|digital forensics?|cyber forensics?|forensic (analyst|investigator|examiner|specialist)|(csirt|cert) (analyst|engineer))\b/i,
  // Never a "Network Security Engineer": the network rule below takes that.
  "cyber-security-analyst": /^(?!.*\bnetwork security engineer\b).*\b(security (analyst|engineer|operations|specialist)|soc analyst|cyber ?security|threat|blue team)\b/i,
  "network-engineer": /\b(network (automation |operations |support |infrastructure |implementation )?(engineer|administrator|admin|specialist|consultant|analyst)|network security engineer|noc (engineer|analyst|specialist)|(routing (and|&) switching|lan|wan|sd-?wan) (engineer|specialist)|firewall (engineer|specialist))\b/i,
  "system-administrator": /\b(sys ?admin|systems? (administrator|admin)|(it )?server (administrator|admin)|it administrator|infrastructure support engineer|(linux|unix|windows|wintel|vmware|active directory)( server| system| systems)? (administrator|admin|engineer|support engineer))\b/i,
  "it-support-engineer": /\b(desktop support|deskside support|service desk|help ?desk|end user computing( \(euc\))?|euc|it support|field support) (engineer|specialist|analyst|associate|executive|technician)\b/i,
  // A cloud support title before the product support one that would read "Technical Support Engineer" in it.
  "cloud-support-engineer": /\b(cloud|aws|azure|gcp|google cloud)( technical)? support (engineer|associate|specialist|analyst)\b|\bcloud support\b/i,
  // A product support title; "Database Support Engineer" stays a DBA one.
  "technical-support-engineer": /\b(technical|tech|product|customer|saas|application|l[123]) support (engineer|specialist|associate|analyst)\b|\bcustomer success engineer\b/i,
  "database-administrator": /\b(database (administrator|admin|support engineer)|dba|(sql server|oracle|mysql|postgres(ql)?|mongodb|db2) (database administrator|administrator|admin))\b/i,
  // A governance or data quality title before the data, analyst and test rules that would read "Data" or "Quality" in it.
  "data-governance-analyst": /\bdata steward\b|\b(data governance|data quality|metadata|data catalog|collibra)\b.*\b(analyst|specialist|associate|consultant)\b/i,
  // A data architect designs the whole data platform; a database architect stays with database design.
  "data-architect": /\b(data|data platform|lakehouse) architect\b/i,
  "database-architect": /\b(database (design )?(architect|engineer)|database reliability|data modeler)\b/i,
  // Before the data, AI and machine learning rules, which would read "Video Analytics Engineer" or "Vision AI Engineer".
  "computer-vision-engineer": /^(?=.*\b(engineer|developer)\b).*\b(computer vision|cv|vision ai|image processing|machine vision|video analytics|perception)\b/i,
  // An ETL tool title before the data engineering rule; never a test one.
  "etl-developer": /^(?!.*\b(test|tester|testing|qa)\b).*\b(etl|informatica|ssis|talend|iics|datastage|data warehouse|dwh)\b.*\b(developer|engineer|consultant)\b/i,
  "data-engineer": /\b(data engineer|big data engineer|analytics engineer|data platform engineer|data (pipeline|integration) engineer|pyspark (developer|engineer)|databricks (engineer|developer))\b|\bsoftware (engineer|developer)\b.*\bdata\b/i,
  "mlops-engineer": /\b(ml[- ]?ops|llm[- ]?ops|machine learning operations|ml devops|model ?ops)\b.*\b(engineer|developer|specialist)\b|\b(ml|machine learning|ai) (platform|infrastructure|infra) engineer\b|\bsoftware (engineer|developer)\b.*\b(ml[- ]?ops|llm[- ]?ops)\b/i,
  // A generative AI title; "AI/ML Engineer" and "ML/AI Engineer" stay machine learning ones.
  "ai-engineer": /(?<![\w/])(gen(erative)?[- ]?ai|llm|agentic ai|ai agents?|prompt|conversational ai|applied ai|ai application|ai) (engineer|developer)\b|\bsoftware (engineer|developer)\b.*\b(gen(erative)?[- ]?ai|llm|agentic)\b/i,
  "ml-engineer": /\b(machine learning|ml|ai|deep learning|nlp) engineer\b|\b(machine learning|ml) developer\b|\bsoftware (engineer|developer)\b.*\b(machine learning|ml|ai)\b/i,
  // A BI developer builds the reports; a "BI Analyst" stays a data analyst.
  "bi-developer": /\b(bi|power ?bi|msbi|business intelligence|tableau|qlik( ?sense| ?view)?|looker|ssrs|reporting|dashboard) (developer|engineer|consultant|specialist)\b/i,
  "data-analyst": /\b(data|analytics|bi|business intelligence|product|insights|reporting|mis) analyst\b|\banalytics associate\b/i,
  "business-analyst": /\bbusiness (systems )?analyst\b|^(?!.*\bsap\b).*\b(functional|techno-?functional|requirements) (analyst|consultant)\b/i,
  // Before the manual and automation test rules, which would read "QA" or "Test" in it.
  "performance-test-engineer": /^(?!.*\bmarket).*\b(performance|load|stress|non-functional|nft)\b.*\b(test(er|ing)?|engineer|consultant)\b/i,
  // A test lead title before the manual and automation test rules.
  "qa-lead": /\b(qa|test|testing|quality assurance|sdet)( automation| test)? (team )?lead\b|\b(automation test|qa automation) lead\b|\blead (qa|sdet|test|quality assurance)\b/i,
  // A manual testing title, never an automation one, before the mobile and front-end rules ("Mobile Manual Tester").
  // A plain "QA Analyst", "Quality Analyst" or "Test Engineer" is manual testing; "QA Engineer" stays automation.
  "manual-test-engineer": /^(?!.*\b(automation|sdet|selenium)\b).*(\bmanual\b.*\b(test(er|ers|ing)?|qa|quality)\b|\b(test(er|ing)?|qa|quality)\b.*\bmanual\b|\b(software|functional|manual|qa) tester\b|^((senior|sr\.?|junior|jr\.?|associate|trainee) )?((qa|quality) analyst|test engineer)\b)/i,
  // Platform developer titles before the front-end and back-end rules that would read "Lightning" or "Backend" in them.
  "salesforce-developer": /\b(salesforce|sfdc)\b.*\b(developer|engineer|technical consultant)\b|\b(apex|salesforce lightning) developer\b/i,
  "servicenow-developer": /\bservicenow\b.*\b(developer|engineer|technical consultant)\b/i,
  "sap-abap-developer": /^(?=.*\b(developer|consultant|engineer|lead|programmer)\b).*\babap\b|\bsap technical consultant\b/i,
  "power-platform-developer": /^(?=.*\b(developer|engineer|consultant)\b).*\b(power platform|power ?apps|power automate)\b/i,
  "mainframe-developer": /^(?!.*\b(test|tester|testing|qa)\b).*\b(mainframe|cobol)\b.*\b(developer|programmer|engineer)\b/i,
  // Never a test or validation title: those stay with hardware testing, which no role covers.
  "embedded-software-engineer": /^(?!.*\b(test|tester|testing|validation|qa)\b).*\b(embedded|firmware)\b.*\b(engineer|developer|programmer)\b/i,
  // Before the mobile, front-end and full-stack rules ("Mobile Game Developer", "Web3 Developer").
  "game-developer": /^(?!.*\b(test|tester|testing|qa)\b).*\b(game|gameplay|unity( ?3d)?|unreal( engine)?)\b.*\b(developer|programmer|engineer)\b/i,
  "blockchain-developer": /^(?!.*\b(test|tester|testing|qa)\b).*\b(blockchain|solidity|smart contracts?|web3|dapp|hyperledger( fabric)?|ethereum)\b.*\b(developer|engineer|programmer)\b/i,
  "php-developer": /^(?!.*\b(full[- ]?stack|test|tester|testing|qa)\b).*\b(php|laravel|codeigniter|symfony|cakephp|wordpress)\b.*\b(developer|engineer|programmer)\b/i,
  "android-developer": /\bandroid\b.*\b(engineer|developer)\b|\b(engineer|developer)\b.*\bandroid\b|^(?!.*\b(back[- ]?end|server[- ]side|spring)\b).*\b(kotlin|jetpack compose)\b.*\b(engineer|developer)\b/i,
  "ios-developer": /\bios\b.*\b(engineer|developer)\b|\b(engineer|developer)\b.*\bios\b|\b(iphone( app)?|swift|swiftui) (engineer|developer)\b/i,
  "cross-platform-mobile-developer": /\b(react native|flutter|mobile( app)?|cross[- ]platform( app| mobile)?)\b.*\b(engineer|developer)\b/i,
  // A technical lead title, never a test, QA or backend one ("Backend Tech Lead" is a senior backend title, below).
  "tech-lead": /^(?!.*\b(test|testing|qa|sdet|quality|back[- ]?end)\b).*\b(tech(nical)?( team)? lead|lead software (engineer|developer)|software development lead)\b/i,
  // Not a test, front-end, mobile, ML, data, security, cloud or infrastructure title ("Senior Software Engineer, Data"):\n  // the later rules catch those.
  "senior-backend-engineer": /\b(senior|sr\.?|lead) (software|back[- ]?end|java|python|golang|go|node(\.?js)?|server[- ]side) (engineer|developer)\b(?!.*\b(test|qa|sdet|front[- ]?end|ui|mobile|android|ios|full[- ]?stack|machine learning|ml|ai|data|security|infra(structure)?|platform|cloud|sre|site reliability|devops)\b)|^(?!.*\b(test|qa)\b).*\b(software (development )?engineer|sde),? (iii|3)\b|\b(staff|principal) back[- ]?end (engineer|developer)\b|\bback[- ]?end tech(nical)? lead\b/i,
  "python-developer": /^(?!.*\b(full[- ]?stack|test|tester|testing|qa|sdet|automation)\b).*\b(python|django|flask|fastapi)\b.*\b(engineer|developer|programmer)\b/i,
  "nodejs-developer": /^(?!.*\b(full[- ]?stack|mern|mean|test|tester|testing|qa|sdet|automation)\b)(?=.*\b(engineer|developer|programmer)\b).*\b(node(\.?js)?|nest\.?js)\b/i,
  "golang-developer": /^(?!.*\b(full[- ]?stack|test|tester|testing|qa|sdet|automation)\b)(?=.*\b(engineer|developer|programmer|sde)\b).*(\bgolang\b|\bgo (back[- ]?end )?(engineer|developer|programmer)\b|\s[-–,]\s?go$)/i,
  "dotnet-developer": /^(?!.*\b(test|tester|testing|qa|sdet)\b)(?=.*\b(engineer|developer|programmer|lead)\b).*(?<![\w.])(\.net|dot ?net|asp\.net|c#|vb\.net)(?![\w#])/i,
  "java-backend-developer": /\b(back[- ]?end|java|server[- ]side|spring( boot)?|j2ee)\b.*\b(engineer|developer)\b|\b(software|backend) (engineer|developer)\b.*\bjava\b/i,
  "frontend-developer": /^(?!.*\b(full[- ]?stack|mern|mean)\b).*(\b(front[- ]?end|ui|react|reactjs|react\.js|javascript|next\.?js|web)\b.*\b(engineer|developer)\b|\b(engineer|developer)\b.*\b(front[- ]?end|react)\b)/i,
  "full-stack-developer": /\bfull[- ]?stack\b|\b(mern|mean) stack\b/i,
  "scrum-master": /\b(scrum master|agile (coach|delivery lead|project manager)|iteration manager)\b/i,
  "engineering-manager": /\b(engineering manager|manager,? (software )?engineering|software (development|engineering) manager|head of engineering)\b|^((senior|sr\.?) )?(development manager|technical manager|engineering lead)\b/i,
  "senior-data-scientist": /\b(senior|sr\.?|lead|staff|principal) (data|applied|ml|machine learning) scientist\b|\bdata science (lead|manager)\b/i,
  "data-scientist": /\b(data scientist|machine learning scientist|applied scientist|ml scientist|decision scientist|data science (associate|analyst)|(predictive|statistical) model(l)?er)\b/i,
  "product-manager": /\b(product manager|product owner|associate product manager|product lead|product specialist)\b/i,
  "ui-ux-designer": /\b(ui ?\/? ?ux|ux ?\/? ?ui|ux|ui|product|interaction|visual|experience|web) designer\b|\bux (researcher|writer)\b/i,
  // After the designer rule, which keeps "UX Writer".
  "technical-writer": /\b(technical|api|documentation|docs) (writer|author|editor)\b|\bdocumentation (specialist|engineer|lead)\b|\binformation developer\b|\bcontent developer\b.*\btechnical\b/i,
  "qa-automation-engineer": /\b(qa|sdet|test|testing|quality|automation test)\b.*\b(engineer|analyst|developer)\b|\bsdet\b|\bsoftware (development )?engineer\b.*\b(in test|qa|quality)\b|\bautomation tester\b|\bselenium\b.*\b(engineer|tester|developer)\b/i,
  // Reliability and production engineers in software only, never in a plant or on hardware.
  "site-reliability-engineer": /\b(site reliability|sre)\b|^(?!.*\b(hardware|mechanical|manufacturing|plant|electrical|civil|chemical|silicon|asic)\b).*\b(((systems?|infrastructure|platform) )?reliability|observability|production) engineer\b/i,
  "cloud-architect": /\b(cloud( solutions?| infrastructure| platform)? architect|(aws|azure|gcp|google cloud|multi-?cloud|hybrid cloud)( cloud)?( solutions?)? architect)\b/i,
  "solutions-architect": /\b(solutions?|technical|software|application|integration|enterprise|pre-?sales) architect\b/i,
  "cloud-engineer": /\b(cloud( solutions?| infrastructure)? (engineer|consultant|administrator|developer|operations|ops)|(aws|azure|gcp|google cloud)( solutions?)? (engineer|consultant|administrator|developer))\b|\bsoftware (engineer|developer)\b.*\bcloud\b/i,
  // A platform title before DevOps, never a DevOps or reliability one; "ML Platform Engineer" is MLOps (above).
  "platform-engineer": /^(?!.*\b(devops|devsecops|reliability|sre)\b).*(\bplatform (engineer|engineering|developer)\b|\b(engineer|developer)\b.*\bplatform\b)/i,
  "devops-engineer": /\b(devops|infrastructure engineer|(build (and|&) release|release|ci\/cd|infrastructure automation|kubernetes) engineer)\b|\bsoftware (engineer|developer)\b.*\binfra(structure)?\b/i,
  // Last of the engineering roles: a plain "Software Engineer" or "SDE", never a test, embedded or hardware one.
  "software-engineer": /^(?!.*\b(in test|qa|embedded|firmware|hardware|silicon|asic|mechanical|electrical)\b).*\b(software (engineer|developer|development engineer)|sde|programmer analyst|application developer|member of technical staff)\b/i,
  "digital-marketing-executive": /\b(digital|performance|growth|paid|search|seo|sem|social media|content|lifecycle|email|online) market(ing|er)\b|\b(seo|sem|ppc|paid social|paid search|social media) (specialist|executive|manager|associate)\b/i,
};
const MANAGER_OK = new Set(["product-manager", "digital-marketing-executive", "grc-manager", "soc-lead", "engineering-manager", "scrum-master", "senior-data-scientist"]);
/** A location in India (moved from mine.mjs). Remote posts count only when they say India too. */
export const INDIA = /\b(india|bengaluru|bangalore|mumbai|pune|hyderabad|chennai|gurgaon|gurugram|noida|delhi|new delhi|kolkata|ahmedabad|jaipur|kochi)\b/i;
const NOT_SOFTWARE = /\b(hardware|manufacturing|supplier|mechanical|electrical|silicon|asic|firmware|validation)\b/i;
const TEST_ROLES = new Set(["qa-automation-engineer", "manual-test-engineer", "performance-test-engineer", "qa-lead"]);

/** The live role a title reads as, or null. `text` only settles Java for a backend title. */
export function classify(/** @type {string} */ title, /** @type {string} */ text = "") {
  // A pre-sales architect designs solutions: "sales" in it is not a sales title.
  if ((SENIOR.test(title) && !SENIOR_TITLES.test(title)) || NOT_IN_SCOPE.test(title.replace(/\bpre-?sales (?=(solutions? )?architect\b)/i, ""))) return null;
  for (const [slug, re] of Object.entries(ROLE_TITLES)) {
    if (!re.test(title)) continue;
    if (!MANAGER_OK.has(slug) && /\bmanager\b/i.test(title)) continue;
    if (TEST_ROLES.has(slug) && NOT_SOFTWARE.test(title)) continue;
    if (slug === "java-backend-developer" && !/\bjava\b/i.test(title + " " + text) && !/\b(spring|j2ee)\b/i.test(title)) continue;
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
