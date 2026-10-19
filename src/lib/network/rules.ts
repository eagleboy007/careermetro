import { nameMatches } from "@/lib/corporate/find-rules";
import { CONNECTION_REQUEST_DAYS, type ConnectionState, type ConnectionStatus } from "@/lib/schemas/network";

/* The Network's pure rules (FR-49, docs/plans/network-plan.md). The store reads and writes; these decide. */

const DAY = 24 * 3600_000;

/** The pair as stored: user_a is the smaller id, so a pair has one row whoever asked. */
export function pairOf(x: string, y: string): { userA: string; userB: string } {
  return x < y ? { userA: x, userB: y } : { userA: y, userB: x };
}

export type ConnectionRow = { status: ConnectionStatus; requestedBy: string; ignoredAt: Date | null; createdAt: Date };

/** A request still stands for CONNECTION_REQUEST_DAYS; after that it lapses and can be sent again. */
export const requestLive = (row: Pick<ConnectionRow, "createdAt">, now: Date) => now.getTime() - row.createdAt.getTime() < CONNECTION_REQUEST_DAYS * DAY;

/** When requests sent before this time have lapsed. */
export const lapsedBefore = (now: Date) => new Date(now.getTime() - CONNECTION_REQUEST_DAYS * DAY);

/**
 * How two people stand, seen by `viewerId`. An ignored request reads "requested" to its sender, who is never told, and
 * "none" to the person who ignored it (Connect then connects them, as two requests at once do).
 */
export function connectionState(row: ConnectionRow | null | undefined, viewerId: string, now: Date): ConnectionState {
  if (!row) return "none";
  if (row.status === "accepted") return "connected";
  if (!requestLive(row, now)) return "none";
  if (row.requestedBy === viewerId) return "requested";
  return row.ignoredAt ? "none" : "incoming";
}

/** A typed username: "@Asha_R" reads as "asha_r", as usernames are stored. */
export const usernameOf = (query: string) => query.replace(/^@/, "").toLowerCase();

/** Whether a person is found by what was typed: every word starts a word of their name, or it is exactly their username. */
export function networkMatches(query: string, person: { name: string | null; username: string | null }): boolean {
  if (person.username && person.username.toLowerCase() === usernameOf(query)) return true;
  return !query.startsWith("@") && nameMatches(query, person.name);
}

/** Skills both people have met, counted only when the other person shows skills on their profile. */
export function skillsInCommon(mine: readonly string[], theirs: readonly string[], theyShowSkills: boolean): number {
  if (!theyShowSkills) return 0;
  const set = new Set(mine);
  return new Set(theirs.filter((s) => set.has(s))).size;
}

/** Search order: connections first, then most skills in common, then name. */
export function byNetworkRank(a: { state: ConnectionState; common: number; name: string }, b: { state: ConnectionState; common: number; name: string }): number {
  const ca = a.state === "connected" ? 0 : 1;
  const cb = b.state === "connected" ? 0 : 1;
  return ca - cb || b.common - a.common || a.name.localeCompare(b.name, "en");
}
