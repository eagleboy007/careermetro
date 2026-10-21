// The monthly openings rollup (docs/plans/market-trends-plan.md, "Data model"; migration 0048): what the daily
// Departures feed (scripts/departures/fetch-feeds.mjs) writes to market_openings_monthly from job_posts, so the
// Market's history outlives the 180-day purge of closed posts. Plain code over rows the feed already checked: no model,
// no network, and no post text or URL (only the role, the place, the experience note and the dates are read). A post
// belongs to no one, so nothing here is personal data. Plain JavaScript, so the feed runs with plain Node.
//
// Counting rules, kept from scripts/jd-mining/accumulate.mjs so the numbers mean the same: a post counts once in its
// city, once in that city's state and once in all of India ("IN"); "Remote" and "India" count in "IN" only; a repost
// under a new URL is a new job_posts row, so it counts again. A post whose title reads as no live role (role_slug
// null) is left out, and the run log reports how many. Months are calendar months in UTC (the feed runs at 01:00 UTC,
// 06:30 IST, so a run's date is the same in both).
import { z } from "zod";
import { CITIES } from "../../../scripts/jd-mining/market.mjs";

/** The state code of an all-India row (INDIA_ROW in src/lib/schemas/market.ts). */
export const INDIA_ROW = "IN";

/** Experience bands (MARKET_BANDS in src/lib/schemas/market.ts). Null on a row means the posts stated no years. */
export const ROLLUP_BANDS = /** @type {const} */ (["0-2", "3-5", "6-10", "10+"]);

/**
 * City → state code, from the /market city list (scripts/jd-mining/market.mjs, kept in step with
 * src/content/market/places.ts and STATE_CODES by src/lib/market/feed-scripts.test.ts).
 * @type {Map<string, string>}
 */
export const STATE_OF_CITY = new Map(CITIES.map(([state, city]) => [/** @type {string} */ (city), /** @type {string} */ (state)]));
const STATES = /** @type {[string, ...string[]]} */ ([...new Set(STATE_OF_CITY.values())].sort());

const slug = z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/).max(80);

/** One market_openings_monthly row, as the feed writes it. */
export const marketRollupRow = z
  .object({
    /** The first day of the month, YYYY-MM-01. */
    month: z.iso.date().refine((m) => m.endsWith("-01"), { message: "month is the first day of the month" }),
    roleSlug: slug,
    /** A state's code, or INDIA_ROW for all of India. */
    state: z.union([z.enum(STATES), z.literal(INDIA_ROW)]),
    /** Null for the whole state (or India). */
    city: z.string().min(1).max(60).nullable(),
    /** Null when the posts state no years. */
    band: z.enum(ROLLUP_BANDS).nullable(),
    /** Posts first seen in the month. */
    newPosts: z.number().int().min(0),
    /** Posts open on the month's last run (so far: the latest run). */
    openAtEnd: z.number().int().min(0),
    /** The month's lowest daily count of boards read, so a jump from a board added or fixed can be explained. */
    boardsOk: z.number().int().min(0),
    computedAt: z.date(),
  })
  .strict()
  .refine((r) => r.state !== INDIA_ROW || r.city === null, { message: "an India row has no city" })
  .refine((r) => r.city === null || STATE_OF_CITY.get(r.city) === r.state, { message: "a city row is in its city's state" })
  .refine((r) => r.newPosts + r.openAtEnd > 0, { message: "a row counts at least one post" });

/** @typedef {import("zod").infer<typeof marketRollupRow>} MarketRollupRow */
/** @typedef {(typeof ROLLUP_BANDS)[number]} RollupBand */
/**
 * A job_posts row as the rollup reads it: no title, company, URL or skills.
 * @typedef {{ city: string; experienceNote: string | null; roleSlug: string | null; firstSeenAt: Date; closedAt: Date | null }} RollupPost
 */

/** The month `date` falls in, in UTC, as its first day (YYYY-MM-01). */
export function monthOf(/** @type {Date} */ date) {
  return `${date.toISOString().slice(0, 7)}-01`;
}

/** The start of a month (YYYY-MM-01) and of the next one, as UTC instants. */
export function monthBounds(/** @type {string} */ month) {
  const start = new Date(`${month}T00:00:00.000Z`);
  if (Number.isNaN(start.getTime()) || !month.endsWith("-01")) throw new Error("month must be YYYY-MM-01");
  const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
  return { start, end };
}

/**
 * The band of a stored experience note ("2 to 4 years", "5+ years", as experienceNoteOf in
 * src/lib/departures/feed-rules.mjs writes it), from its lowest stated years, on the same cut-offs as experienceBand
 * (scripts/jd-mining/market.mjs). Null for no note or one in any other shape: never guessed.
 * @returns {RollupBand | null}
 */
export function bandOfNote(/** @type {string | null | undefined} */ note) {
  const m = /^(\d{1,2}) ?(?:\+|(?:to|-|–) ?\d{1,2}) years?$/.exec((note ?? "").trim());
  if (!m) return null;
  const y = Number(m[1]);
  if (y > 15) return null;
  return y < 3 ? "0-2" : y < 6 ? "3-5" : y < 10 ? "6-10" : "10+";
}

/**
 * The places a post counts in: all of India always; its city and the city's state when the city is on the /market
 * list. "Remote", "India" and any city off the list count in India only.
 * @returns {{ state: string; city: string | null }[]}
 */
export function placesOfPost(/** @type {string} */ city) {
  const state = STATE_OF_CITY.get(city);
  const india = { state: INDIA_ROW, city: null };
  return state ? [india, { state, city: null }, { state, city }] : [india];
}

/**
 * The month's rows from the posts that matter to it, as of `computedAt` (the run's time): one per role × place × band,
 * with the posts first seen in the month and the posts open now. A post neither new this month nor open now is left
 * out, so the same posts give the same rows however often a day is re-run. Every row is checked; rows are sorted.
 * @param {{ posts: RollupPost[]; month: string; boardsOk: number; computedAt: Date }} input
 */
export function rollupMonth({ posts, month, boardsOk, computedAt }) {
  const { start, end } = monthBounds(month);
  /** @type {Map<string, { roleSlug: string; state: string; city: string | null; band: RollupBand | null; newPosts: number; openAtEnd: number }>} */
  const cells = new Map();
  let counted = 0;
  let unmatched = 0;
  let indiaOnly = 0;
  for (const p of posts) {
    if (p.firstSeenAt > computedAt) continue;
    const isNew = p.firstSeenAt >= start && p.firstSeenAt < end;
    const isOpen = p.closedAt === null || p.closedAt > computedAt;
    if (!isNew && !isOpen) continue;
    if (!p.roleSlug) {
      unmatched++;
      continue;
    }
    counted++;
    const band = bandOfNote(p.experienceNote);
    const places = placesOfPost(p.city);
    if (places.length === 1) indiaOnly++;
    for (const { state, city } of places) {
      const key = [p.roleSlug, state, city ?? "", band ?? ""].join("|");
      const cell = cells.get(key) ?? { roleSlug: p.roleSlug, state, city, band, newPosts: 0, openAtEnd: 0 };
      if (isNew) cell.newPosts++;
      if (isOpen) cell.openAtEnd++;
      cells.set(key, cell);
    }
  }
  // Sorted by role, then India, then each state followed by its cities, then band (no band last).
  const order = (/** @type {{ roleSlug: string; state: string; city: string | null; band: string | null }} */ r) =>
    [r.roleSlug, r.state === INDIA_ROW ? "" : r.state, r.city ?? "", r.band === null ? "~" : r.band];
  const compare = (/** @type {string[]} */ x, /** @type {string[]} */ y) => {
    const i = x.findIndex((v, j) => v !== y[j]);
    return i < 0 ? 0 : x[i] < y[i] ? -1 : 1;
  };
  const rows = [...cells.values()]
    .sort((a, b) => compare(order(a), order(b)))
    .map((c) => marketRollupRow.parse({ month, ...c, boardsOk, computedAt }));
  return { rows, stats: { month, rows: rows.length, counted, unmatched, indiaOnly } };
}
