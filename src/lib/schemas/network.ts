import { z } from "zod";
import { CONNECTION_HOWS, GAPS_VISIBLE_TO, NETWORK_QUERY_MAX, REQUESTS_FROM } from "./constants";

/*
 * Network (FR-49, handoff 12j, docs/plans/network-plan.md): two-way connections, requests and name search. What a
 * person types is matched in memory only: it never goes into a log, an audit line or an address.
 */

export {
  CONNECTION_HOW_LABELS,
  CONNECTION_HOWS,
  CONNECTION_PENDING_MAX,
  CONNECTION_REQUEST_DAYS,
  CONNECTION_REQUEST_STATUSES,
  GAPS_VISIBLE_TO,
  NETWORK_RESULTS_MAX,
  REQUESTS_FROM,
} from "./constants";

export const connectionHow = z.enum(CONNECTION_HOWS);
export type ConnectionHow = z.infer<typeof connectionHow>;
export const gapsVisibleTo = z.enum(GAPS_VISIBLE_TO);
export type GapsVisibleTo = z.infer<typeof gapsVisibleTo>;
export const requestsFrom = z.enum(REQUESTS_FROM);
export type RequestsFrom = z.infer<typeof requestsFrom>;

/** How two people stand, seen by one of them. "incoming": the other asked and this person hasn't answered. */
export const CONNECTION_STATES = ["none", "requested", "incoming", "connected"] as const;
export type ConnectionState = (typeof CONNECTION_STATES)[number];

export const NETWORK_QUERY_MESSAGE = "Type at least 2 letters of the name, or an @handle.";

/** A name search: a name or an @handle, trimmed and single-spaced, with at least 2 letters or digits (T63). */
export const networkQuery = z
  .string()
  .max(NETWORK_QUERY_MAX)
  .transform((t) => t.trim().replace(/\s+/g, " "))
  .refine((t) => t.normalize("NFKD").replace(/[^\p{L}\p{N}]/gu, "").length >= 2, { message: NETWORK_QUERY_MESSAGE });

/** A name search with its optional filters (handoff 12j): aiming for my role, my city, verified. */
export const networkSearchInput = z.object({
  q: networkQuery,
  sameRole: z.boolean().default(false),
  sameCity: z.boolean().default(false),
  verified: z.boolean().default(false),
});
export type NetworkSearchInput = z.input<typeof networkSearchInput>;

/** The receiver's answer to a request. Ignore hides it without telling the sender. */
export const connectionAnswer = z.enum(["accept", "ignore"]);
export type ConnectionAnswer = z.infer<typeof connectionAnswer>;

/** The Network choices in Account settings > Privacy (handoff 12j). */
export const networkSettings = z.object({ peopleCanFind: z.boolean(), gapsVisibleTo, requestsFrom });
export type NetworkSettings = z.infer<typeof networkSettings>;
/** A new user's Network choices: not findable, gaps to connections (ruling 4), requests from anyone. */
export const DEFAULT_NETWORK_SETTINGS: NetworkSettings = { peopleCanFind: false, gapsVisibleTo: "connections", requestsFrom: "anyone" };
