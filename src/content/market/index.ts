import "server-only";
import { marketTable, type MarketTable } from "@/lib/schemas";
import { exampleMarketTable } from "./example";

export { marketStates } from "./places";

/**
 * The market table the screen reads (handoff C6). Example data for now; Data research's licensed rows replace it
 * here, in the same shape. Validated when the module loads, so a bad row fails the tests and the build.
 */
export const market: MarketTable = marketTable.parse(exampleMarketTable);
