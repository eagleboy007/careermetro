import { indiaDay } from "@/lib/ride/days";
import { LIVE_SOURCE, liveMarketTable, MARKET_MIN_OPENINGS, type MarketRow, type MarketState, type MarketTable } from "@/lib/schemas";
import { createMarket, count, monthLabel, type MarketData, type MarketLive } from "./query";
import { addMonths, bandOfNote, monthOf, placesOfPost } from "./rollup.mjs";

/*
 * Live counts for /market (MARKET_DATA = "live", docs/plans/market-trends-plan.md PR 2): plain code over two reads the
 * store makes (./live-store.ts), never the model.
 * - Open now: today's open job_posts, grouped by role, city and experience note, counted with the rollup's own rules
 *   (./rollup.mjs): once in the city, once in its state, once in all of India; "Remote" and "India" in India only; the
 *   band from the stated years, null when none are stated.
 * - The trend: new posts a month from market_openings_monthly (state and India rows). The rollup's first month is
 *   dropped, like the old feed's baseline: the Departures feed counted every post open on its first day as new, so that
 *   month is a stock, not a month's flow. The current month is left out until it ends.
 * Pay is null everywhere (D3 (a), 2026-10-21): company job boards in India rarely state pay.
 */

/** Open job_posts with a live role, grouped: no title, company or URL. */
export type OpenGroup = { roleSlug: string; city: string; experienceNote: string | null; posts: number };
/** market_openings_monthly state and India rows (city null), with the month as YYYY-MM-01. */
export type RollupGroup = { month: string; roleSlug: string; state: string; band: string | null; newPosts: number };
export type LiveInputs = {
  open: OpenGroup[];
  rollup: RollupGroup[];
  /** The rollup's first month (YYYY-MM-01), over the whole table; null when it is empty. */
  firstMonth: string | null;
  /** When the last feed run that read a board finished. */
  lastRun: Date | null;
};

/** The months of a trend: at most 12, so the chart and the 12-month rule read the same list. */
export const TREND_MONTHS = 12;

/** The India month `d` falls in, as YYYY-MM (monthOf in ./rollup.mjs, the rollup's own cut). */
const ym = (d: Date) => monthOf(d).slice(0, 7);
/** "2026-10" plus `n` months, as YYYY-MM (addMonths in ./rollup.mjs). */
export { addMonths };

/** The months the trend can read: after the first (baseline) month, up to the last full month, the latest 12. */
export function trendMonths(firstMonth: string | null, now: Date): string[] {
  if (!firstMonth) return [];
  const months: string[] = [];
  for (let m = addMonths(firstMonth.slice(0, 7), 1); m < ym(now); m = addMonths(m, 1)) months.push(m);
  return months.slice(-TREND_MONTHS);
}

/**
 * Today's open posts as market rows: one per role × place × band, with pay null. Posts of a role the Market doesn't
 * offer (a role profile taken down since the feed read it) are left out and counted in `dropped`.
 */
export function openRows(open: OpenGroup[], { month, roles }: { month: string; roles: string[] }): { rows: MarketRow[]; dropped: number } {
  const live = new Set(roles);
  const cells = new Map<string, MarketRow>();
  let dropped = 0;
  for (const g of open) {
    if (!live.has(g.roleSlug)) {
      dropped += g.posts;
      continue;
    }
    const band = bandOfNote(g.experienceNote);
    for (const { state, city } of placesOfPost(g.city)) {
      const key = [g.roleSlug, state, city ?? "", band ?? ""].join("|");
      const cell = cells.get(key);
      if (cell) cell.openings += g.posts;
      else
        cells.set(key, {
          role: g.roleSlug,
          state: state as MarketRow["state"],
          city,
          band,
          openings: g.posts,
          payP25: null,
          payMedian: null,
          payP75: null,
          source: LIVE_SOURCE,
          month,
        });
    }
  }
  return { rows: [...cells.values()], dropped };
}

/** The rollup's new posts a month as market rows, for the trend months only (state and India rows). */
export function trendRows(rollup: RollupGroup[], { months, roles }: { months: string[]; roles: string[] }): MarketRow[] {
  const live = new Set(roles);
  const wanted = new Set(months);
  return rollup
    .filter((r) => r.newPosts > 0 && live.has(r.roleSlug) && wanted.has(r.month.slice(0, 7)))
    .map((r) => ({
      role: r.roleSlug,
      state: r.state as MarketRow["state"],
      city: null,
      band: r.band as MarketRow["band"],
      openings: r.newPosts,
      payP25: null,
      payMedian: null,
      payP75: null,
      source: LIVE_SOURCE,
      month: r.month.slice(0, 7),
    }));
}

/**
 * The live Market: open posts now for every figure, new posts a month for the trend. Both tables are checked by the
 * live table schema, so a row the screen can't place (an unknown state, a city in the wrong state) fails loudly.
 * `failed`: the counts couldn't be read (pass liveNothing); the screen then shows only that and Nearby lines.
 */
export function liveMarket(
  inputs: LiveInputs,
  { now, roles, states, failed = false }: { now: Date; roles: string[]; states: MarketState[]; failed?: boolean },
): { market: MarketData; dropped: number } {
  const month = ym(now);
  const { rows, dropped } = openRows(inputs.open, { month, roles });
  const table: MarketTable = liveMarketTable.parse({ latestMonth: month, rows });
  const months = trendMonths(inputs.firstMonth, now);
  const trend: MarketTable = liveMarketTable.parse({ latestMonth: months.at(-1) ?? addMonths(month, -1), rows: trendRows(inputs.rollup, { months, roles }) });
  const live: MarketLive = { asOf: inputs.lastRun ? indiaDay(inputs.lastRun) : null, countingSince: inputs.firstMonth?.slice(0, 7) ?? null, failed };
  return { market: createMarket(table, states, { trend: { table: trend, months }, live }), dropped };
}

/* The words live counts use (tested in ./live.test.ts, so the screen never claims more than the data says). */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "2026-10-20" → "20 Oct 2026". */
export const dayLabel = (day: string) => `${Number(day.slice(8, 10))} ${MONTHS[Number(day.slice(5, 7)) - 1]} ${day.slice(0, 4)}`;

/** The source's name in a sentence: "public company job boards (Greenhouse, Lever, Ashby, SmartRecruiters)". */
const SOURCE_WORDS = LIVE_SOURCE[0]!.toLowerCase() + LIVE_SOURCE.slice(1);

/**
 * The undercount note (dev/market-plan.md, 2026-10-13), in short. The header carries it on live counts.
 */
export const UNDERCOUNT_NOTE =
  "These counts undercount the market. They include only the companies on our list of public Greenhouse, Lever, Ashby and SmartRecruiters boards, so they lean to tech companies and startups; most hiring in India goes through job portals and staffing firms we don't read. A post counts once, in the first city it lists. Remote posts count in India only. Posts whose title matches none of our roles are left out.";

/** What the pay card and the compare card say on live counts (D3 (a), 2026-10-21): no pay figure anywhere. */
export const PAY_LATER = "Pay comes later: company job boards in India rarely state pay.";

/** The header's first line: what is counted and the day it was read. */
export function liveHeadline(live: MarketLive): string {
  return live.asOf ? `Open roles on ${SOURCE_WORDS}, as of ${dayLabel(live.asOf)}.` : `Open roles on ${SOURCE_WORDS}. The daily read hasn't run yet.`;
}

/** A card's source line on live counts: open posts with their day, or new posts a month with the month counting began. */
export function liveSourceLine(kind: "open" | "new" | "pay", live: MarketLive): string {
  if (kind === "pay") return "Source: none yet";
  if (kind === "open") return `Source: Open on ${SOURCE_WORDS} · ${live.asOf ? dayLabel(live.asOf) : "not read yet"}`;
  return `Source: New each month on ${SOURCE_WORDS} · ${live.countingSince ? `counting since ${monthLabel(live.countingSince)}` : "not counted yet"}`;
}

/**
 * The month the trend first shows: the rollup's first month is a baseline, the next 12 are the trend, and the last of
 * them is read once it ends, so counting since Oct 2026 shows the trend from Nov 2027.
 */
export const trendFrom = (countingSince: string) => addMonths(countingSince, TREND_MONTHS + 1);

/**
 * Why the trend card shows no line yet. Until the trend has 12 months to read it says when counting began and the
 * month the trend shows from (D6, 2026-10-21); after that, a thin role or place gets the floor in words.
 */
export function trendWaitText(live: MarketLive, months: string[], where: string | null): string {
  if (months.length < TREND_MONTHS)
    return live.countingSince
      ? `Counting since ${monthLabel(live.countingSince)}; the trend shows from ${monthLabel(trendFrom(live.countingSince))}.`
      : "Counting hasn't started yet; the trend shows 13 months after it starts.";
  return `A trend needs at least ${MARKET_MIN_OPENINGS} new roles in each of the last 12 months${where ? ` in ${where}` : ""}.`;
}

/** The floor in words: example figures are a month's openings, live ones are open posts. */
export const floorText = (live: boolean) =>
  live ? `We show a figure only when at least ${MARKET_MIN_OPENINGS} open roles back it.` : `We show a figure only when at least ${MARKET_MIN_OPENINGS} openings a month back it.`;

/** The Market's parts that show: on a failed live read only Nearby lines (and the header's status line), never a figure. */
export const MARKET_CARDS = ["map", "trend", "pay", "cities", "compare", "nearby"] as const;
export type MarketCard = (typeof MARKET_CARDS)[number];
export const marketCards = (live: MarketLive | null): readonly MarketCard[] => (live?.failed ? ["nearby"] : MARKET_CARDS);

/** A count with its unit: "1,240 open now" on live counts, "1,240 a month" on example data. */
export const openingsWords = (n: number, live: boolean) => `${count(n)} ${live ? "open now" : "a month"}`;
