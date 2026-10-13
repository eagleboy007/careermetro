import { FEED_SOURCE, marketTable, type MarketState, type MarketTable } from "@/lib/schemas";
import { parseCsvObjects } from "@/lib/market/csv.mjs";

/*
 * Openings counted from public company job boards (Lever and Greenhouse), as the monthly JD-mining run writes them to
 * market/market-rows.csv on the data/jd-snapshot branch (scripts/jd-mining/accumulate.mjs, dev/market-plan.md).
 * The screen does not read these yet: see MARKET_DATA in ./index.ts.
 *
 * The rows carry openings only (pay is blank until a licensed source exists). The first month in the file is a
 * baseline: every posting open on the day of the first run counts as new in it, so it is a stock count, not a month's
 * flow, and must not be read as a trend point.
 */

export const FEED_COLUMNS = ["role", "state", "city", "band", "openings", "payP25", "payMedian", "payP75", "source", "month"] as const;

export type FeedTable = { table: MarketTable; baselineMonth: string };

const pay = (v: string) => (v === "" ? null : Number(v));

/**
 * Reads market-rows.csv into the market table: every row validated by the marketRow schema, from a live role, in a
 * state and city the tile map knows, with the feed's source. Throws on anything else, so a bad file fails the build.
 */
export function feedTableFromCsv(text: string, { roles, states }: { roles: string[]; states: MarketState[] }): FeedTable {
  const [head] = text.split(/\r?\n/, 1);
  const expected = FEED_COLUMNS.map((c) => `"${c}"`).join(",");
  if (head?.replace(/"/g, "") !== FEED_COLUMNS.join(",")) throw new Error(`market-rows.csv header should be ${expected}`);
  const liveRoles = new Set(roles);
  const cities = new Map(states.map((s) => [s.code as string, new Set(s.cities)]));
  const rows = (parseCsvObjects(text) as Record<(typeof FEED_COLUMNS)[number], string>[]).map((r, i) => {
    const where = `market-rows.csv row ${i + 2}`;
    if (!liveRoles.has(r.role)) throw new Error(`${where}: ${r.role} is not a live role`);
    if (r.source !== FEED_SOURCE) throw new Error(`${where}: source should be "${FEED_SOURCE}"`);
    if (r.city !== "" && !cities.get(r.state)?.has(r.city)) throw new Error(`${where}: ${r.city} is not a city of ${r.state} on the map`);
    if (!/^\d+$/.test(r.openings)) throw new Error(`${where}: openings should be a whole number`);
    return {
      role: r.role,
      state: r.state,
      city: r.city === "" ? null : r.city,
      band: r.band,
      openings: Number(r.openings),
      payP25: pay(r.payP25),
      payMedian: pay(r.payMedian),
      payP75: pay(r.payP75),
      source: FEED_SOURCE,
      month: r.month,
    };
  });
  const months = [...new Set(rows.map((r) => r.month))].sort();
  const table = marketTable.parse({ latestMonth: months.at(-1), rows });
  return { table, baselineMonth: months[0]! };
}
