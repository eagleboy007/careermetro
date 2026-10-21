import "server-only";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { roleProfiles } from "@/content";
import { marketTable, type MarketTable } from "@/lib/schemas";
import { exampleMarketTable } from "./example";
import { feedTableFromCsv } from "./feed";
import { marketStates } from "./places";

export { marketStates } from "./places";

/**
 * Which rows the screen shows (docs/plans/market-trends-plan.md): "live" (signed in: open posts and new posts a month
 * from the daily Departures feed, read per request in src/lib/market/live-store.ts), "example" (labelled EXAMPLE DATA)
 * or "feed" (the monthly Lever and Greenhouse counts, ./feed.ts, retired by the plan's PR 3).
 *
 * Switched to "live" by Market trends PR 2 (Milin's D1, 2026-10-21). The switch-on checklist, done for "live":
 * 1. The loader (src/lib/market/live.ts) reads market_openings_monthly and today's open job_posts into the same table
 *    shape, with the 15 floor of MARKET_MIN_OPENINGS on every figure.
 * 2. The header names the source and the day, and carries the undercount note (UNDERCOUNT_NOTE in live.ts).
 * 3. No pay (D3 (a)): the pay card and the compare card say "Pay comes later", the place panel shows no pay, and the
 *    map's Median pay metric is hidden.
 * 4. The rollup's first month is a baseline and is dropped; until the trend has 12 months it says "Counting since
 *    {month}; the trend shows after 12 months" (D6).
 * 5. Every card's source line names the boards and the day (or the month counting began).
 * 6. The example table stays for /design and for the signed-out preview, both labelled EXAMPLE DATA.
 */
export const MARKET_DATA = "live" as "example" | "feed" | "live";

const feedTable = () =>
  feedTableFromCsv(readFileSync(join(process.cwd(), "src/content/market/feed-rows.csv"), "utf8"), {
    roles: roleProfiles.map((r) => r.slug),
    states: marketStates,
  }).table;

/** The example table (EXAMPLE DATA), for /design and the signed-out preview. Validated when the module loads. */
export const exampleMarket: MarketTable = marketTable.parse(exampleMarketTable);

/**
 * The table the screen reads when it isn't on live counts: the feed's, or the example. Live counts are read per
 * request instead (src/lib/market/live-store.ts). Validated when the module loads, so a bad row fails the tests and the
 * build.
 */
export const market: MarketTable = MARKET_DATA === "feed" ? feedTable() : exampleMarket;
