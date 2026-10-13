import "server-only";
import { roleProfiles } from "@/content";
import { market, marketStates } from "@/content/market";
import { createMarket } from "./query";

/** The market figures the screen reads, indexed once per server. */
export const marketData = createMarket(market, marketStates);

/** The roles the Market offers: the live role profiles, by title. */
export const marketRoles = roleProfiles.map((r) => ({ slug: r.slug, title: r.title })).sort((a, b) => a.title.localeCompare(b.title));

/** The role the Market opens on when the person has no target role yet. */
export const DEFAULT_MARKET_ROLE = "data-analyst";
