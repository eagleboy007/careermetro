// Market openings for /market (dev/market-plan.md): which live role a posting is, where in India it is, and the
// experience band it states. Plain code over public Lever and Greenhouse postings; nothing is guessed. A posting that
// states no years gets no band, and one whose place can't be read gets no state. Only the posting's URL, role, place
// and band are kept: no posting text, no names or emails of recruiters or anyone else.
// Reviewed from the Data research handoff (data/market/jd-mining-market), 2026-10-13.

/** The source the openings rows carry (src/content/market/feed.ts reads the same string). */
export const FEED_SOURCE = "Public company job boards (Lever, Greenhouse)";

/** Only these boards feed the market counts; Ashby postings still feed skill mining. */
export const MARKET_ATS = new Set(["lever", "greenhouse"]);

/** Live role for a title, for counting openings (seniority is kept, unlike skill mining). First match wins. */
export const MARKET_ROLES = [
  ["soc-lead", /\b(soc|security operations)\b.*\b(lead|manager|head)\b/i],
  ["soc-analyst-l2", /\b(soc|security operations)\b.*\b(analyst|engineer)\b|\bincident respon(se|der)\b/i],
  ["privacy-analyst", /\b(privacy|data protection|dpo)\b/i],
  ["grc-manager", /\b(grc|governance,? risk|security (compliance|governance|risk)|information security|cyber ?risk|it risk)\b.*\b(manager|lead|head)\b/i],
  ["information-security-analyst", /\b(grc|governance,? risk|security (compliance|governance|risk)|information security|infosec|cyber ?risk|it risk|it audit)\b/i],
  ["penetration-tester", /\b(penetration|pen ?test(er|ing)?|vapt|offensive security|red team)\b/i],
  ["cloud-security-engineer", /\bcloud security\b/i],
  ["appsec-engineer", /\b(application|product|appsec) security\b|\bappsec\b|\bdevsecops\b/i],
  ["cyber-security-analyst", /\b(security (analyst|engineer|specialist)|cyber ?security|threat|detection engineer|blue team)\b/i],
  ["engineering-manager", /\b(engineering manager|manager,? (software )?engineering|software development manager)\b/i],
  ["product-manager", /\b(product manager|product owner)\b/i],
  ["ui-ux-designer", /\b(ui|ux|product|interaction|visual)\b.*\bdesigner\b|\bux researcher\b/i],
  ["site-reliability-engineer", /\b(site reliability|sre)\b/i],
  ["devops-engineer", /\b(devops|platform engineer|infrastructure engineer|build and release|release engineer)\b/i],
  ["cloud-engineer", /\bcloud (engineer|architect|administrator|operations)\b/i],
  ["ml-engineer", /\b(machine learning|ml|ai|mlops|llm|genai)\b.*\bengineer\b/i],
  ["senior-data-scientist", /\b(senior|lead|staff|principal)\b.*\b(data scientist|applied scientist)\b/i],
  ["data-scientist", /\b(data scientist|applied scientist|machine learning scientist)\b/i],
  ["data-engineer", /\b(data|analytics|etl|big data) engineer\b/i],
  ["database-architect", /\b(database (architect|administrator|engineer|reliability)|dba|data architect|data modeler)\b/i],
  ["data-analyst", /\b(data|analytics|bi|business intelligence|product|insights|reporting) analyst\b/i],
  ["business-analyst", /\bbusiness (systems )?analyst\b/i],
  ["qa-automation-engineer", /\b(qa|sdet|test|testing|quality|automation test)\b.*\b(engineer|analyst|developer)\b|\bsdet\b/i],
  ["android-developer", /\bandroid\b/i],
  ["ios-developer", /\bios\b/i],
  ["cross-platform-mobile-developer", /\b(flutter|react native|mobile)\b.*\b(engineer|developer)\b/i],
  ["full-stack-developer", /\bfull[- ]?stack\b/i],
  ["frontend-developer", /\b(front[- ]?end|ui|react|web)\b.*\b(engineer|developer)\b/i],
  ["senior-backend-engineer", /\b(senior|lead|staff)\b.*\b(back[- ]?end|server[- ]side|software) (engineer|developer)\b/i],
  ["java-backend-developer", /\b(back[- ]?end|java|server[- ]side)\b.*\b(engineer|developer)\b/i],
  ["digital-marketing-executive", /\b(digital|performance|growth|paid|search|seo|sem|social media|content|lifecycle|email) market(ing|er)\b|\b(seo|sem|ppc|paid social|paid search) (specialist|executive|manager|associate)\b/i],
];
// Not one of the live roles, whatever else the title says. Executives (a CISO is not an information security
// analyst) are out; heads and leads stay, since soc-lead and grc-manager are live roles.
const OUT =
  /\b(counsel|attorney|legal|paralegal|sales|account executive|recruit(er|ing)|intern|internship|hardware|mechanical|electrical|silicon|asic|firmware|chief|director|vice president|vp)\b/i;
// The same guard skill mining uses: quality and test titles outside software.
const NOT_SOFTWARE = /\b(hardware|manufacturing|supplier|mechanical|electrical|silicon|asic|firmware|validation)\b/i;

export function marketRole(title, text = "") {
  if (OUT.test(title)) return null;
  for (const [slug, re] of MARKET_ROLES) {
    if (!re.test(title)) continue;
    if (slug === "qa-automation-engineer" && NOT_SOFTWARE.test(title)) continue;
    if (slug === "java-backend-developer" && !/\bjava\b/i.test(`${title} ${text}`)) continue;
    return slug;
  }
  return null;
}

/**
 * City → state code (STATE_CODES in src/lib/schemas/market.ts). The cities are exactly the ones on the /market tile
 * map (src/content/market/places.ts), spelt the same, so every city row links on screen; a test keeps them in step.
 */
export const CITIES = [
  ["KA", "Bengaluru", /\b(bengaluru|bangalore)\b/i],
  ["KA", "Mysuru", /\b(mysuru|mysore)\b/i],
  ["KA", "Mangaluru", /\b(mangaluru|mangalore)\b/i],
  ["TG", "Hyderabad", /\b(hyderabad|secunderabad)\b/i],
  ["MH", "Pune", /\bpune\b/i],
  ["MH", "Mumbai", /\b(mumbai|bombay)\b/i],
  ["MH", "Nagpur", /\bnagpur\b/i],
  ["TN", "Chennai", /\b(chennai|madras)\b/i],
  ["TN", "Coimbatore", /\bcoimbatore\b/i],
  ["HR", "Gurugram", /\b(gurugram|gurgaon)\b/i],
  ["HR", "Faridabad", /\bfaridabad\b/i],
  ["UP", "Noida", /\bnoida\b/i],
  ["UP", "Lucknow", /\blucknow\b/i],
  // "Delhi NCR" names a region, not the city.
  ["DL", "New Delhi", /\b(new delhi|delhi)\b(?![\s/-]*ncr\b)/i],
  ["WB", "Kolkata", /\b(kolkata|calcutta)\b/i],
  ["GJ", "Ahmedabad", /\bahmedabad\b/i],
  ["GJ", "Vadodara", /\b(vadodara|baroda)\b/i],
  ["GJ", "Gandhinagar", /\b(gandhinagar|gift city)\b/i],
  ["RJ", "Jaipur", /\bjaipur\b/i],
  ["RJ", "Udaipur", /\budaipur\b/i],
  ["KL", "Kochi", /\b(kochi|cochin)\b/i],
  ["KL", "Thiruvananthapuram", /\b(thiruvananthapuram|trivandrum)\b/i],
  ["MP", "Indore", /\bindore\b/i],
  ["MP", "Bhopal", /\bbhopal\b/i],
  ["CH", "Chandigarh", /\bchandigarh\b/i],
  ["PB", "Mohali", /\bmohali\b/i],
  ["PB", "Ludhiana", /\bludhiana\b/i],
  ["OD", "Bhubaneswar", /\b(bhubaneswar|bhubaneshwar)\b/i],
  ["AP", "Visakhapatnam", /\b(visakhapatnam|vizag)\b/i],
  ["AP", "Vijayawada", /\bvijayawada\b/i],
  ["JK", "Srinagar", /\bsrinagar\b/i],
  ["JK", "Jammu", /\bjammu\b(?!\s*(and|&)\s*kashmir)/i],
  ["LA", "Leh", /\bleh\b/i],
  ["HP", "Shimla", /\bshimla\b/i],
  ["UK", "Dehradun", /\bdehradun\b/i],
  ["BR", "Patna", /\bpatna\b/i],
  ["SK", "Gangtok", /\bgangtok\b/i],
  ["AR", "Itanagar", /\bitanagar\b/i],
  ["CG", "Raipur", /\braipur\b/i],
  ["JH", "Ranchi", /\branchi\b/i],
  ["AS", "Guwahati", /\bguwahati\b/i],
  ["NL", "Kohima", /\bkohima\b/i],
  ["DH", "Silvassa", /\bsilvassa\b/i],
  ["ML", "Shillong", /\bshillong\b/i],
  ["MN", "Imphal", /\bimphal\b/i],
  ["GA", "Panaji", /\b(panaji|panjim)\b/i],
  ["TR", "Agartala", /\bagartala\b/i],
  ["MZ", "Aizawl", /\baizawl\b/i],
  ["LD", "Kavaratti", /\bkavaratti\b/i],
  ["PY", "Puducherry", /\b(puducherry|pondicherry)\b/i],
  ["AN", "Port Blair", /\bport blair\b/i],
];
/**
 * State and union-territory names, for a location that names a state but no city of it ("Karnataka, India"): the
 * posting counts in the state, with no city. Delhi is left to the city pattern above.
 */
export const STATES = [
  ["AN", /\bandaman\b/i], ["AP", /\bandhra pradesh\b/i], ["AR", /\barunachal pradesh\b/i], ["AS", /\bassam\b/i],
  ["BR", /\bbihar\b/i], ["CG", /\bchhattisgarh\b/i], ["CH", /\bchandigarh\b/i], ["DH", /\b(dadra|daman)\b/i],
  ["GA", /\bgoa\b/i], ["GJ", /\bgujarat\b/i], ["HP", /\bhimachal\b/i], ["HR", /\bharyana\b/i], ["JH", /\bjharkhand\b/i],
  ["JK", /\bjammu (and|&) kashmir\b/i], ["KA", /\bkarnataka\b/i], ["KL", /\bkerala\b/i], ["LA", /\bladakh\b/i],
  ["LD", /\blakshadweep\b/i], ["MH", /\bmaharashtra\b/i], ["ML", /\bmeghalaya\b/i], ["MN", /\bmanipur\b/i],
  ["MP", /\bmadhya pradesh\b/i], ["MZ", /\bmizoram\b/i], ["NL", /\bnagaland\b/i], ["OD", /\b(odisha|orissa)\b/i],
  ["PB", /\bpunjab\b/i], ["PY", /\b(puducherry|pondicherry)\b/i], ["RJ", /\brajasthan\b/i], ["SK", /\bsikkim\b/i],
  ["TG", /\btelangana\b/i], ["TN", /\btamil ?nadu\b/i], ["TR", /\btripura\b/i], ["UK", /\b(uttarakhand|uttaranchal)\b/i],
  ["UP", /\buttar pradesh\b/i], ["WB", /\bwest bengal\b/i],
];
const INDIA = /\b(india|ind|delhi ncr|ncr)\b/i;
// Names shared with places outside India ("Delhi, NY", "Hyderabad, Sindh", Pakistan's Punjab) count only when the
// location also says India or names another Indian place, or names no other country.
const SHARED_NAMES = new Set(["New Delhi", "Hyderabad", "PB"]);
const ABROAD = /\b(united states|usa|new york|ny|ontario|canada|pakistan|sindh|lahore|karachi|islamabad|united kingdom)\b|\bU\.?S\.?(?![a-z])/i;

/**
 * Every Indian place a posting lists, de-duplicated, as { state, city }: each city named, and each state named with
 * no city of it named (city ""). Empty when it names none.
 */
export function placesOf(location) {
  const cities = CITIES.filter(([, , re]) => re.test(location)).map(([state, city]) => ({ state, city }));
  const states = STATES.filter(([state, re]) => re.test(location) && !cities.some((c) => c.state === state)).map(([state]) => ({ state, city: "" }));
  const all = [...cities, ...states];
  const shared = (p) => SHARED_NAMES.has(p.city || p.state);
  const india = INDIA.test(location) || all.some((p) => !shared(p)) || !ABROAD.test(location);
  return india ? all : all.filter((p) => !shared(p));
}
export const isIndia = (location) => INDIA.test(location) || placesOf(location).length > 0;

/*
 * Experience band from the years a posting states: "3-5 years of experience", "5+ years", "minimum 4 years",
 * "4 to 6 yrs". No years stated → null (never guessed from the title).
 *
 * Changed from the handoff, which took the lowest stated minimum: postings often add shorter asks for one skill
 * ("8+ years of experience, including 2+ years with Kafka"), so the band comes from the highest stated minimum.
 * Company blurbs ("for over 25 years", "founded 30 years ago") are skipped by their wording and by ignoring anything
 * over 15 years, which no requirement in the bands needs to be read exactly.
 * Whitespace is collapsed first, so the patterns allow at most one space between parts and never backtrack over long
 * runs of spaces.
 */
const NUM = String.raw`(\d{1,2}(?:\.\d)?)`;
const YEARS = new RegExp(String.raw`(?<![\d.])${NUM} ?(?:(?:\+|plus) ?)?(?:(?:-|–|—|to) ?\d{1,2}(?:\.\d)? ?)?(?:\+ ?)?(?:years?|yrs?)\b`, "gi");
const MIN_WORDS = new RegExp(String.raw`\b(?:minimum|min\.?|at least) (?:of )?${NUM} ?(?:\+ ?)?(?:years?|yrs?)\b`, "gi");
const CONTEXT = /experience|\bexp\b|working|industry|hands-on|professional|background|relevant/;
const NOT_REQUIREMENT_AFTER = /\b(old|age|warranty|contract|tenure|founded|history|ago|in business|of (our|the) company)\b/;
const NOT_REQUIREMENT_BEFORE = /\b(for over|for more than|founded|since|trusted|serving|we've been|we have been|history of|legacy of) ?$/;
const MAX_YEARS = 15;

export function experienceBand(raw) {
  const text = raw.replace(/\s+/g, " ");
  const mins = [];
  const keep = (m, needsContext) => {
    const after = text.slice(m.index + m[0].length, m.index + m[0].length + 30).toLowerCase();
    const before = text.slice(Math.max(0, m.index - 40), m.index).toLowerCase();
    if (NOT_REQUIREMENT_AFTER.test(after) || NOT_REQUIREMENT_BEFORE.test(before)) return;
    if (needsContext && !CONTEXT.test(before + text.slice(m.index, m.index + 80).toLowerCase())) return;
    const y = Number(m[1]);
    if (y >= 0 && y <= MAX_YEARS) mins.push(y);
  };
  for (const m of text.matchAll(MIN_WORDS)) keep(m, false);
  for (const m of text.matchAll(YEARS)) keep(m, true);
  if (!mins.length) return null;
  const y = Math.max(...mins);
  return y < 3 ? "0-2" : y < 6 ? "3-5" : y < 10 ? "6-10" : "10+";
}

/**
 * This run's India postings for the market counts: one row per posting and place it lists, as
 * { url, role, state, city, band } (city "" when only the state is named). A posting that names India but no place
 * gets one row with state and city blank: it counts only in the India row. Deduped on URL, state and city.
 */
export function marketPostings(postings) {
  const rows = [];
  const keys = new Set();
  for (const p of postings) {
    if (!MARKET_ATS.has(p.ats) || !isIndia(p.location ?? "")) continue;
    if (!/^https:\/\/[^\s"]+$/.test(p.url ?? "")) continue;
    const role = marketRole(p.title ?? "", p.text ?? "");
    if (!role) continue;
    const band = experienceBand(p.text ?? "") ?? "";
    const places = placesOf(p.location);
    for (const { state, city } of places.length ? places : [{ state: "", city: "" }]) {
      const key = `${p.url}|${state}|${city}`;
      if (keys.has(key)) continue;
      keys.add(key);
      rows.push({ url: p.url, role, state, city, band });
    }
  }
  return rows;
}

export const MARKET_POSTING_COLUMNS = ["url", "role", "state", "city", "band"];
