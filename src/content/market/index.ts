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
 * when (dev/market-plan.md). To switch, copy market/market-rows.csv from the data/jd-snapshot branch to
 * src/content/market/feed-rows.csv and set this to "feed". The feed's first month is a baseline (a stock count).
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
