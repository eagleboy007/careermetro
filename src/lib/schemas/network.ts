import { z } from "zod";
import { CONNECTION_STATUSES, NETWORK_QUERY_MAX } from "./constants";

/*
 * Network (FR-49, docs/plans/network-plan.md): connections between people and search by name or username. What a person
 * types is matched in memory only: it never goes into a log, an audit line or an address.
 */

export { CONNECTION_PENDING_MAX, CONNECTION_REQUEST_DAYS, CONNECTION_STATUSES, NETWORK_RESULTS_MAX } from "./constants";
export type ConnectionStatus = (typeof CONNECTION_STATUSES)[number];

/** How two people stand, seen by one of them. "incoming": the other asked and this person hasn't answered. */
export const CONNECTION_STATES = ["none", "requested", "incoming", "connected"] as const;
export type ConnectionState = (typeof CONNECTION_STATES)[number];

export const NETWORK_QUERY_MESSAGE = "Type at least 2 letters of the name or username.";

/** A network search: a name or a username ("@" allowed), trimmed and single-spaced, with at least 2 letters or digits (T63). */
export const networkQuery = z
  .string()
  .max(NETWORK_QUERY_MAX)
  .transform((t) => t.trim().replace(/\s+/g, " "))
  .refine((t) => t.normalize("NFKD").replace(/[^\p{L}\p{N}]/gu, "").length >= 2, { message: NETWORK_QUERY_MESSAGE });

/** The receiver's answer to a request. Ignore hides it without telling the sender. */
export const connectionAnswer = z.enum(["accept", "ignore"]);
export type ConnectionAnswer = z.infer<typeof connectionAnswer>;

/** "Let people find me by name": off until the person turns it on. */
export const peopleCanFind = z.boolean();
