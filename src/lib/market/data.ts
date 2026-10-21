import "server-only";
import { roleProfiles } from "@/content";
import { exampleMarket, marketStates } from "@/content/market";
import { createMarket } from "./query";

/** The example figures (EXAMPLE DATA), indexed once per server: /design and the signed-out preview. */
export const exampleMarketData = createMarket(exampleMarket, marketStates);

/**
 * The static figures the screen falls back to: the example. On "live" the signed-in screen reads its figures per
 * request (src/lib/market/live-store.ts) instead.
 */
export const marketData = exampleMarketData;

/** The roles the Market offers: the live role profiles, by title. */
export const marketRoles = roleProfiles.map((r) => ({ slug: r.slug, title: r.title })).sort((a, b) => a.title.localeCompare(b.title));

/** The role the Market opens on when the person has no target role yet. */
export const DEFAULT_MARKET_ROLE = "data-analyst";
