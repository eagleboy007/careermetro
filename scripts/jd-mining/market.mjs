// Where in India a posting is, and the experience band it states: plain code over public job-board postings, used by
// the daily Departures feed (src/lib/departures/feed-rules.mjs), whose job_posts the /market rollup counts. Nothing is
// guessed: a posting that states no years gets no band, and one whose place can't be read gets no place. The monthly
// Lever and Greenhouse openings count that first used these was retired by Market trends PR 3 (D4, 2026-10-21).
// Reviewed from the Data research handoff (data/market/jd-mining-market), 2026-10-13.
import { CITIES } from "../../src/lib/market/cities.mjs";

/**
 * State and union-territory names, for a location that names a state but no city of it ("Karnataka, India"): the
 * posting is in the state, with no city. Delhi is left to its city pattern (CITIES).
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
