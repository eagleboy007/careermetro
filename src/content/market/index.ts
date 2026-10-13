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
 * Which rows the screen shows: "example" (labelled EXAMPLE DATA) or "feed" (openings counted from public company job
 * boards, ./feed.ts). It stays on "example" until the feed has cells at 15 or more openings a month; Data research says
 * when (dev/market-plan.md).
 *
 * Switch-on checklist:
 * 1. Copy market-rows.csv from the data/market branch to src/content/market/feed-rows.csv (next.config.ts already
 *    ships it with the server functions) and set this to "feed".
 * 2. The header in src/components/market/market-view.tsx still says "Example data" and "These figures are made up to
 *    show the design"; change it to name the source ("Openings on public company job boards (Lever, Greenhouse)"),
 *    say these count new postings, not all hiring, and give the month.
 * 3. The feed has no pay: the pay map, pay bands and the compare card's pay show "Not enough data". Hide the pay
 *    metric or say pay comes later.
 * 4. The baseline month (the file's first) is dropped by the loader; the trend needs 12 months after it, so it shows
 *    "Not enough data" for about a year. Say so on the trend card.
 * 5. Openings are by place listed: a posting in two cities counts in each, India rows count it once. Check the
 *    undercounting notes in dev/market-plan.md and put the short version in the source line.
 * 6. Update the example-data tests in ./market.test.ts and the plan's decision log.
 */
export const MARKET_DATA = "example" as "example" | "feed";

const feedTable = () =>
  feedTableFromCsv(readFileSync(join(process.cwd(), "src/content/market/feed-rows.csv"), "utf8"), {
    roles: roleProfiles.map((r) => r.slug),
    states: marketStates,
  }).table;

/**
 * The market table the screen reads (handoff C6). Example data for now; real rows replace it here, in the same shape.
 * Validated when the module loads, so a bad row fails the tests and the build.
 */
export const market: MarketTable = MARKET_DATA === "feed" ? feedTable() : marketTable.parse(exampleMarketTable);
