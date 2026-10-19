import { nameMatches } from "@/lib/corporate/find-rules";
import { CONNECTION_REQUEST_DAYS, type ConnectionState, type GapsVisibleTo } from "@/lib/schemas/network";

/* The Network's pure rules (FR-49, handoff 12j). The store reads and writes; these decide. */

const DAY = 24 * 3600_000;
const WINDOW = CONNECTION_REQUEST_DAYS * DAY;

/** The pair as stored in connections: user_low is the smaller id, so a pair has one row whoever asked. */
export function pairOf(x: string, y: string): { userLow: string; userHigh: string } {
  return x < y ? { userLow: x, userHigh: y } : { userLow: y, userHigh: x };
}

export type RequestRow = { fromUser: string; toUser: string; status: "pending" | "accepted" | "ignored" | "withdrawn" | "expired"; createdAt: Date; decidedAt: Date | null };

/** When a request ends unanswered: CONNECTION_REQUEST_DAYS after it was sent. */
export const endsAt = (row: Pick<RequestRow, "createdAt">) => new Date(row.createdAt.getTime() + WINDOW);

/** Requests sent before this time have ended. */
export const openSince = (now: Date) => new Date(now.getTime() - WINDOW);

/** A pending request still stands until it ends. */
export const requestOpen = (row: Pick<RequestRow, "status" | "createdAt">, now: Date) => row.status === "pending" && now < endsAt(row);

/**
 * Whether the sender's copy still reads Requested: an open request, or one the other person ignored, until it would
 * have ended. Ignore is silent, so the sender sees no difference.
 */
export const senderSeesRequested = (row: Pick<RequestRow, "status" | "createdAt">, now: Date) =>
  (row.status === "pending" || row.status === "ignored") && now < endsAt(row);

/**
 * After an ignore or an expiry the same sender can ask the same person again only CONNECTION_REQUEST_DAYS later
 * (handoff 12j): counted from the ignore, or from the day the request ended. Null when they can ask now.
 */
export function askAgainFrom(rows: readonly RequestRow[], fromId: string, toId: string, now: Date): Date | null {
  let until: Date | null = null;
  for (const r of rows) {
    if (r.fromUser !== fromId || r.toUser !== toId) continue;
    const ended = r.status === "ignored" ? (r.decidedAt ?? r.createdAt) : r.status === "expired" || (r.status === "pending" && !requestOpen(r, now)) ? endsAt(r) : null;
    if (!ended) continue;
    const from = new Date(ended.getTime() + WINDOW);
    if (from > now && (!until || from > until)) until = from;
  }
  return until;
}

/**
 * How two people stand, seen by `viewerId`, from whether they are connected and the requests between them. A request
 * the viewer ignored reads "none" to them (Connect then connects, as two requests at once do).
 */
export function connectionState(connected: boolean, rows: readonly RequestRow[], viewerId: string, now: Date): ConnectionState {
  if (connected) return "connected";
  if (rows.some((r) => r.fromUser !== viewerId && requestOpen(r, now))) return "incoming";
  if (rows.some((r) => r.fromUser === viewerId && senderSeesRequested(r, now))) return "requested";
  return "none";
}

/** A typed handle: "@Asha_R" reads as "asha_r", as usernames are stored. */
export const handleOf = (query: string) => query.replace(/^@/, "").toLowerCase();

/**
 * Whether a person is found by what was typed (handoff 12j): the start of their first name, last name or handle. An
 * "@" means a handle only. Several words must each start a word of the name.
 */
export function networkMatches(query: string, person: { name: string | null; username: string | null }): boolean {
  const handle = handleOf(query);
  if (person.username && handle && !handle.includes(" ") && person.username.toLowerCase().startsWith(handle)) return true;
  return !query.startsWith("@") && nameMatches(query, person.name);
}

/** Skills both people have met, counted only when the other person shows skills on their profile. */
export function skillsInCommon(mine: readonly string[], theirs: readonly string[], theyShowSkills: boolean): number {
  if (!theyShowSkills) return 0;
  const set = new Set(mine);
  return new Set(theirs.filter((s) => set.has(s))).size;
}

/** People both are connected to, never counting either of them. */
export function mutualOf(mine: ReadonlySet<string>, theirs: ReadonlySet<string>): string[] {
  return [...mine].filter((id) => theirs.has(id));
}

/** Search order: connections first, then most skills in common, then most mutual connections, then name. */
export function byNetworkRank(
  a: { state: ConnectionState; common: number; mutual: number; name: string },
  b: { state: ConnectionState; common: number; mutual: number; name: string },
): number {
  const ca = a.state === "connected" ? 0 : 1;
  const cb = b.state === "connected" ? 0 : 1;
  return ca - cb || b.common - a.common || b.mutual - a.mutual || a.name.localeCompare(b.name, "en");
}

/**
 * Whether a viewer sees the owner's gaps (handoff 12j "Your gaps show to"), given they can already open the profile.
 * Companies never see gaps; that is decided where companies read profiles.
 */
export function seesGaps(to: GapsVisibleTo, viewer: { self: boolean; connected: boolean }): boolean {
  if (viewer.self) return true;
  if (to === "profile") return true;
  return to === "connections" && viewer.connected;
}
