import { nameMatches } from "@/lib/corporate/find-rules";
import { nowPitstop, pitstopsFor } from "@/lib/map/layout";
import { CONNECTION_REQUEST_DAYS, type ConnectionState, type GapsVisibleTo } from "@/lib/schemas/network";
import type { LineStep, PathTogether } from "./types";

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
 * When the same sender can ask the same person again, or null when they can now (handoff 12j: "a request expires
 * after 30 days, then it can be sent again"). Every request they sent holds them until it would have ended, whatever
 * became of it: an ignore stays silent because it reads exactly like no answer, and Withdraw can't be looped to send
 * a fresh request every day. An accepted one never holds them (a removed connection can be asked again).
 */
export function askAgainFrom(rows: readonly RequestRow[], fromId: string, toId: string, now: Date): Date | null {
  let until: Date | null = null;
  for (const r of rows) {
    if (r.fromUser !== fromId || r.toUser !== toId || r.status === "accepted") continue;
    const ends = endsAt(r);
    if (ends > now && (!until || ends > until)) until = ends;
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

/** A goal as a line reads it: its skill, its place, whether it is proved or skipped, and a "Not for me" swap. */
export type LineGoalRow = { skillId: string; position: number; proved: boolean; status: string; swappedTo: string | null };
/** A gap of the person's current analysis, as their line reads it. */
export type LineGap = { skillId: string; status: "missing" | "weak" | "outdated" };
/**
 * One goal of a person's line: the gap's skill, the skill they learn for it, its status as the Map draws it (a goal
 * waiting for a renewed certificate is weak), whether its learn pitstop is done, and whether it is proved or skipped.
 */
export type LineStop = { skillId: string; learns: string; status: LineGap["status"]; learnDone: boolean; proved: boolean; skipped: boolean };

/**
 * A person's line: their current gaps in the order of their goals, as on the Map (a gap with no goal yet goes last).
 * Only gaps are on it: "Your choice" goals sit off the line on the Map and aren't numbered. `learned` holds the skills
 * whose step on their newest path is ticked done.
 */
export function lineOrder(gaps: readonly LineGap[], goals: readonly LineGoalRow[], learned: ReadonlySet<string> = new Set()): LineStop[] {
  const bySkill = new Map(goals.map((g) => [g.skillId, g]));
  const at = (id: string) => bySkill.get(id)?.position ?? Number.MAX_SAFE_INTEGER;
  return [...new Map(gaps.map((g) => [g.skillId, g])).values()]
    .sort((a, b) => at(a.skillId) - at(b.skillId))
    .map(({ skillId, status }): LineStop => {
      const g = bySkill.get(skillId);
      const proved = g?.proved ?? false;
      return {
        skillId,
        learns: (!proved && g?.swappedTo) || skillId,
        status: g?.status === "renew" ? "weak" : status,
        learnDone: learned.has(skillId),
        proved,
        skipped: g?.status === "skipped",
      };
    });
}

/**
 * Where a line's person is, numbered as the Map numbers its pitstops (a missing skill has learn then prove, a weak or
 * outdated one prove only): the first pitstop not done, passing skipped goals. Null when every pitstop is done.
 */
export function currentStep(line: readonly LineStop[], name: (skillId: string) => string): LineStep | null {
  const stops = pitstopsFor(line);
  const i = nowPitstop(stops);
  return i === -1 ? null : { step: i + 1, name: name(stops[i].goal.learns) };
}

/**
 * "Gaps and path" for two people on the same role's line (handoff 12j): the gaps both still have, each one's current
 * pitstop (numbered as on the Map), and how many pitstops apart they are. The caller has already decided the viewer
 * may see the owner's gaps.
 */
export function pathTogether(mine: readonly LineStop[], theirs: readonly LineStop[], name: (skillId: string) => string, sharedWith: PathTogether["sharedWith"]): PathTogether {
  const open = new Set(theirs.filter((g) => !g.proved).map((g) => g.skillId));
  const gaps = [...new Set(mine.filter((g) => !g.proved && open.has(g.skillId)).map((g) => name(g.skillId)))].sort((a, b) => a.localeCompare(b, "en"));
  const you = currentStep(mine, name);
  const them = currentStep(theirs, name);
  return { gaps, you, them, apart: you && them ? Math.abs(you.step - them.step) : null, sharedWith };
}
