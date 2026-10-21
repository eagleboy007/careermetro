import "server-only";
import { marketTable, type MarketTable } from "@/lib/schemas";
import { exampleMarketTable } from "./example";

export { marketStates } from "./places";

/**
 * Which rows the screen shows (docs/plans/market-trends-plan.md): "live" (signed in: open posts and new posts a month
 * from the daily Departures feed, read per request in src/lib/market/live-store.ts) or "example" (labelled EXAMPLE
 * DATA). The monthly Lever and Greenhouse feed ("feed") was retired by the plan's PR 3 (D4).
 *
 * Switched to "live" by Market trends PR 2 (Milin's D1, 2026-10-21). The switch-on checklist, done for "live":
 * 1. The loader (src/lib/market/live.ts) reads market_openings_monthly and today's open job_posts into the same table
 *    shape, with the 15 floor of MARKET_MIN_OPENINGS on every figure.
 * 2. The header names the source and the day, and carries the undercount note (UNDERCOUNT_NOTE in live.ts).
 * 3. No pay (D3 (a)): the pay card and the compare card say "Pay comes later", the place panel shows no pay, and the
 *    map's Median pay metric is hidden.
 * 4. The rollup's first month is a baseline and is dropped; until the trend has 12 months it says "Counting since
 *    {month}; the trend shows from {month + 13}" (D6).
 * 5. Every card's source line names the boards and the day (or the month counting began).
 * 6. The example table stays for /design and for the signed-out preview, both labelled EXAMPLE DATA.
 */
export const MARKET_DATA = "live" as "example" | "live";

/**
 * The example table (EXAMPLE DATA), for /design, the signed-out preview, and the signed-in screen on "example".
 * Validated when the module loads, so a bad row fails the tests and the build.
 */
export const exampleMarket: MarketTable = marketTable.parse(exampleMarketTable);
