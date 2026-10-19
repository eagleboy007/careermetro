import "server-only";
import { and, asc, count, desc, eq, gte, inArray, isNull, lt, or, sql, type SQL } from "drizzle-orm";
import { getDb } from "@/db";
import type { Tx } from "@/db/lock";
import { blocks, connectionRequests, connections, gapAnalyses, gapProofs, profiles, resumes, userSettings, users } from "@/db/schema";
import { roleProfiles } from "@/content";
import { displayName } from "@/lib/account/name";
import { indiaToday } from "@/lib/goals/store";
import { logEvent } from "@/lib/log";
import { DEFAULT_SETTINGS, gapAnalysis } from "@/lib/schemas";
import { NETWORK_SCAN_MAX } from "@/lib/schemas/constants";
import {
  CONNECTION_PENDING_MAX,
  DEFAULT_NETWORK_SETTINGS,
  NETWORK_RESULTS_MAX,
  ON_YOUR_LINE_MAX,
  connectionAnswer,
  connectionHow,
  networkSearchInput,
  networkSettings,
  type ConnectionHow,
  type ConnectionState,
  type NetworkSettings,
} from "@/lib/schemas/network";
import { LIMITS, takeShared } from "@/lib/shared-limit";
import { askAgainFrom, byNetworkRank, connectionState, endsAt, mutualOf, networkMatches, openSince, pairOf, requestOpen, senderSeesRequested, skillsInCommon, type RequestRow } from "./rules";

/*
 * Network part 1 (FR-49, handoff 12j, docs/plans/network-plan.md): requests, connections, name search and the Network
 * privacy choices. Every function takes the signed-in person's id and acts only on their own pairs. Names, handles and
 * what was typed are never logged.
 */

type Db = ReturnType<typeof getDb>;
type Deps = { db?: Db; now?: Date };

export type NetworkError = "self" | "unavailable" | "closed" | "wait" | "limit" | "pending_max" | "not_found" | "invalid";

/** What each refusal tells the person. "unavailable" is deliberately vague: a block is never revealed. */
export const NETWORK_ERROR_TEXT: Record<NetworkError, string> = {
  self: "You can't connect with yourself.",
  unavailable: "You can't connect with this person.",
  closed: "This person isn't taking connection requests.",
  wait: "You asked this person recently. You can ask again later.",
  limit: "You've reached the limit for this for now. Try again later.",
  pending_max: `You have ${CONNECTION_PENDING_MAX} requests waiting. Withdraw some, or wait for answers, to send more.`,
  not_found: "That request isn't there any more.",
  invalid: "Check the details and try again.",
};

export type NetworkResult<T = object> = ({ ok: true } & T) | { ok: false; error: NetworkError };
const fail = (error: NetworkError) => ({ ok: false as const, error });

/**
 * A person as Network lists them (handoff 12j): name, handle, target role only if they show it, city, verified, a count
 * of skills in common and of mutual connections. Never email, phone, employer history, gaps or pay.
 */
export type NetworkPerson = {
  id: string;
  name: string;
  /** For the /u/<handle> link; null when they have none. */
  username: string | null;
  aim: string | null;
  city: string | null;
  /** At least one proved skill (as Find people's "Verified"). */
  verified: boolean;
  common: number;
  mutual: number;
  state: ConnectionState;
  /** How you know each other: on a connection or a request. */
  how: ConnectionHow | null;
  /** When the request was sent or the connection made; null on a search result. */
  at: Date | null;
  /** When a sent request ends, on Sent. */
  endsAt: Date | null;
};

const roleTitles = new Map(roleProfiles.map((r) => [r.slug, r.title]));

const pairWhere = (x: string, y: string) => {
  const { userLow, userHigh } = pairOf(x, y);
  return and(eq(connections.userLow, userLow), eq(connections.userHigh, userHigh));
};
const requestsBetween = (x: string, y: string) =>
  or(and(eq(connectionRequests.fromUser, x), eq(connectionRequests.toUser, y)), and(eq(connectionRequests.fromUser, y), eq(connectionRequests.toUser, x)));

const pairLock = (x: string, y: string, tx: Tx) => tx.execute(sql`select pg_advisory_xact_lock(hashtext(${["network", ...[x, y].sort()].join("|")}))`);

const requestColumns = {
  id: connectionRequests.id,
  fromUser: connectionRequests.fromUser,
  toUser: connectionRequests.toUser,
  how: connectionRequests.how,
  status: connectionRequests.status,
  createdAt: connectionRequests.createdAt,
  decidedAt: connectionRequests.decidedAt,
};

async function blockedBetween(x: string, y: string, db: Db | Tx): Promise<boolean> {
  const rows = await db
    .select({ x: blocks.blockerId })
    .from(blocks)
    .where(or(and(eq(blocks.blockerId, x), eq(blocks.blockedId, y)), and(eq(blocks.blockerId, y), eq(blocks.blockedId, x))))
    .limit(1);
  return rows.length > 0;
}

/** The account can be reached: it exists, isn't deleted (even within its 30 days) and isn't suspended (FR-46). */
async function reachable(userId: string, db: Db | Tx) {
  const [row] = await db
    .select({ deleted: users.deletionRequestedAt, suspended: users.suspendedAt, requestsFrom: userSettings.requestsFrom })
    .from(users)
    .leftJoin(userSettings, eq(userSettings.userId, users.id))
    .where(eq(users.id, userId));
  return row && !row.deleted && !row.suspended ? { requestsFrom: row.requestsFrom ?? DEFAULT_NETWORK_SETTINGS.requestsFrom } : null;
}

async function pairState(x: string, y: string, db: Db | Tx) {
  const [[connected], requests] = await Promise.all([
    db.select({ how: connections.how }).from(connections).where(pairWhere(x, y)),
    db.select(requestColumns).from(connectionRequests).where(requestsBetween(x, y)).orderBy(desc(connectionRequests.createdAt)),
  ]);
  return { connected: !!connected, requests };
}

/** Marks pending requests of the pair that ran out as expired, so a new one can open (one open request per pair). */
async function expireStale(x: string, y: string, tx: Tx, now: Date) {
  await tx
    .update(connectionRequests)
    .set({ status: "expired" })
    .where(and(requestsBetween(x, y), eq(connectionRequests.status, "pending"), lt(connectionRequests.createdAt, openSince(now))));
}

async function connect(tx: Tx, request: { id: string; fromUser: string; toUser: string; how: ConnectionHow }, now: Date) {
  await tx.update(connectionRequests).set({ status: "accepted", decidedAt: now }).where(eq(connectionRequests.id, request.id));
  await tx.insert(connections).values({ ...pairOf(request.fromUser, request.toUser), how: request.how, createdAt: now }).onConflictDoNothing();
  logEvent("info", "connection_accepted");
}

/**
 * Connect, with how the sender knows the person (handoff 12j). Connects at once when the other person already asked
 * (two requests at once, or one this person ignored). Asking while a request stands changes nothing. Refused when the
 * person takes no requests, while a recent ignore or expiry still holds, past the daily limit or with
 * CONNECTION_PENDING_MAX waiting.
 */
export async function requestConnection(fromId: string, toId: string, how: unknown, deps: Deps = {}): Promise<NetworkResult<{ state: ConnectionState }>> {
  const db = deps.db ?? getDb();
  const now = deps.now ?? new Date();
  const picked = connectionHow.safeParse(how);
  if (!picked.success) return fail("invalid");
  if (fromId === toId) return fail("self");
  return db.transaction(async (tx) => {
    await pairLock(fromId, toId, tx);
    const them = await reachable(toId, tx);
    if (!them || (await blockedBetween(fromId, toId, tx))) return fail("unavailable");
    const pair = await pairState(fromId, toId, tx);
    if (pair.connected) return { ok: true as const, state: "connected" as const };
    // Their request to this person, open or ignored by this person: Connect accepts it.
    const theirs = pair.requests.find((r) => r.fromUser === toId && (requestOpen(r, now) || (r.status === "ignored" && now < endsAt(r))));
    if (theirs) {
      await expireStale(fromId, toId, tx, now);
      await connect(tx, theirs, now);
      return { ok: true as const, state: "connected" as const };
    }
    if (pair.requests.some((r) => r.fromUser === fromId && senderSeesRequested(r, now))) return { ok: true as const, state: "requested" as const };
    if (them.requestsFrom === "nobody") return fail("closed");
    if (askAgainFrom(pair.requests, fromId, toId, now)) return fail("wait");
    const [waiting] = await tx
      .select({ n: count() })
      .from(connectionRequests)
      .where(and(eq(connectionRequests.fromUser, fromId), eq(connectionRequests.status, "pending"), gte(connectionRequests.createdAt, openSince(now))));
    if ((waiting?.n ?? 0) >= CONNECTION_PENDING_MAX) return fail("pending_max");
    if (!(await takeShared(LIMITS.networkRequestsPerUser, fromId, { db: tx, now: now.getTime() }))) return fail("limit");
    await expireStale(fromId, toId, tx, now);
    await tx.insert(connectionRequests).values({ fromUser: fromId, toUser: toId, how: picked.data, createdAt: now });
    logEvent("info", "connection_requested");
    return { ok: true as const, state: "requested" as const };
  });
}

/** Accept or Ignore a request the other person sent. Ignore is silent: the sender's copy reads Requested until it ends. */
export async function answerRequest(userId: string, fromId: string, answer: unknown, deps: Deps = {}): Promise<NetworkResult<{ state: ConnectionState }>> {
  const db = deps.db ?? getDb();
  const now = deps.now ?? new Date();
  const parsed = connectionAnswer.safeParse(answer);
  if (!parsed.success) return fail("invalid");
  return db.transaction(async (tx) => {
    await pairLock(userId, fromId, tx);
    const pair = await pairState(userId, fromId, tx);
    const request = pair.requests.find((r) => r.fromUser === fromId && requestOpen(r, now));
    if (!request) return fail("not_found");
    if (parsed.data === "ignore") {
      await tx.update(connectionRequests).set({ status: "ignored", decidedAt: now }).where(eq(connectionRequests.id, request.id));
      return { ok: true as const, state: "none" as const };
    }
    if (!(await reachable(fromId, tx)) || (await blockedBetween(userId, fromId, tx))) return fail("not_found");
    await connect(tx, request, now);
    return { ok: true as const, state: "connected" as const };
  });
}

/** Withdraw a request this person sent that is still open. */
export async function withdrawRequest(userId: string, toId: string, deps: Deps = {}): Promise<NetworkResult> {
  const db = deps.db ?? getDb();
  const now = deps.now ?? new Date();
  // An ignored request reads Requested to its sender, so Withdraw ends that one too; the sender still isn't told.
  const gone = await db
    .update(connectionRequests)
    .set({ status: "withdrawn", decidedAt: now })
    .where(and(eq(connectionRequests.fromUser, userId), eq(connectionRequests.toUser, toId), inArray(connectionRequests.status, ["pending", "ignored"])))
    .returning({ id: connectionRequests.id, status: connectionRequests.status });
  return gone.length ? { ok: true } : fail("not_found");
}

/** Remove a connection, from either side. The other person isn't told; either can connect again. */
export async function removeConnection(userId: string, otherId: string, db: Db = getDb()): Promise<NetworkResult> {
  const gone = await db.delete(connections).where(pairWhere(userId, otherId)).returning({ low: connections.userLow });
  if (gone.length) logEvent("info", "connection_removed");
  return gone.length ? { ok: true } : fail("not_found");
}

/** Any connection between two people goes, and any open request is withdrawn. Every block calls this, in its transaction. */
export async function dropBetween(tx: Tx | Db, x: string, y: string, now = new Date()): Promise<void> {
  await tx.delete(connections).where(pairWhere(x, y));
  await tx
    .update(connectionRequests)
    .set({ status: "withdrawn", decidedAt: now })
    .where(and(requestsBetween(x, y), eq(connectionRequests.status, "pending")));
}

/** Block from Network (a row, a request or a profile): silent, as in the Inbox; the connection or request goes with it. */
export async function blockPerson(userId: string, otherId: string, deps: Deps = {}): Promise<NetworkResult> {
  const db = deps.db ?? getDb();
  const now = deps.now ?? new Date();
  if (userId === otherId) return fail("self");
  await db.transaction(async (tx) => {
    await pairLock(userId, otherId, tx);
    await tx.insert(blocks).values({ blockerId: userId, blockedId: otherId, createdAt: now }).onConflictDoNothing();
    await dropBetween(tx, userId, otherId, now);
  });
  return { ok: true };
}

/** Whether two people are connected now. Profile visibility, gaps and the Inbox use it. */
export async function areConnected(x: string, y: string, db: Db | Tx = getDb()): Promise<boolean> {
  if (x === y) return false;
  const [row] = await db.select({ how: connections.how }).from(connections).where(pairWhere(x, y));
  return !!row;
}

/** How the viewer and another person stand, for the button on a profile or a result. */
export async function connectionWith(viewerId: string, otherId: string, deps: Deps = {}): Promise<ConnectionState> {
  if (viewerId === otherId) return "none";
  const pair = await pairState(viewerId, otherId, deps.db ?? getDb());
  return connectionState(pair.connected, pair.requests, viewerId, deps.now ?? new Date());
}

/** Everyone connected to each of these people, by person. */
async function connectionSets(userIds: string[], db: Db | Tx): Promise<Map<string, Set<string>>> {
  const out = new Map<string, Set<string>>(userIds.map((id) => [id, new Set()]));
  if (!userIds.length) return out;
  const rows = await db
    .select({ low: connections.userLow, high: connections.userHigh })
    .from(connections)
    .where(or(inArray(connections.userLow, userIds), inArray(connections.userHigh, userIds)));
  for (const r of rows) {
    out.get(r.low)?.add(r.high);
    out.get(r.high)?.add(r.low);
  }
  return out;
}

/** The people (of these ids) a viewer may be shown: active accounts with no block either way. */
async function shownIds(viewerId: string, ids: string[], db: Db | Tx): Promise<Set<string>> {
  if (!ids.length) return new Set();
  const rows = await db.select({ id: users.id }).from(users).where(and(inArray(users.id, ids), shownTo(viewerId)));
  return new Set(rows.map((r) => r.id));
}

/**
 * "Mutual connections" for "In common with you" on a profile: only people both are connected to, by name, never
 * anyone either can't see. Nobody can browse anyone else's connections.
 */
export async function mutualConnections(viewerId: string, otherId: string, db: Db = getDb()): Promise<{ id: string; name: string; username: string | null }[]> {
  if (viewerId === otherId) return [];
  const sets = await connectionSets([viewerId, otherId], db);
  const ids = mutualOf(sets.get(viewerId)!, sets.get(otherId)!);
  if (!ids.length) return [];
  const rows = await db
    .select({ id: users.id, name: users.name, username: users.username })
    .from(users)
    .where(and(inArray(users.id, ids), shownTo(viewerId), shownTo(otherId)))
    .orderBy(asc(users.name), asc(users.id));
  return rows.map((r) => ({ ...r, name: displayName(r.name) }));
}

/** Each person's met skills and target role, from their current analysis, as on their own Gaps page. */
async function analysesOf(userIds: string[], db: Db | Tx): Promise<Map<string, { roleSlug: string; met: string[] }>> {
  const out = new Map<string, { roleSlug: string; met: string[] }>();
  if (!userIds.length) return out;
  const rows = await db
    .selectDistinctOn([resumes.userId], { userId: resumes.userId, result: gapAnalyses.result })
    .from(gapAnalyses)
    .innerJoin(profiles, eq(profiles.id, gapAnalyses.profileId))
    .innerJoin(resumes, eq(resumes.id, profiles.resumeId))
    .where(and(inArray(resumes.userId, userIds), sql`${profiles.version} = (select max(p2.version) from profiles p2 where p2.resume_id = ${profiles.resumeId})`))
    .orderBy(resumes.userId, desc(gapAnalyses.createdAt));
  for (const r of rows) {
    const parsed = gapAnalysis.safeParse(r.result);
    if (r.userId && parsed.success) out.set(r.userId, { roleSlug: parsed.data.roleSlug, met: parsed.data.metSkillIds });
  }
  return out;
}

/** People with at least one current accepted proof: "Verified" (as Find people, T44). */
async function verifiedOf(userIds: string[], db: Db | Tx, now: Date): Promise<Set<string>> {
  if (!userIds.length) return new Set();
  const rows = await db
    .selectDistinct({ userId: gapProofs.userId })
    .from(gapProofs)
    .where(and(inArray(gapProofs.userId, userIds), eq(gapProofs.status, "accepted"), or(isNull(gapProofs.expiresOn), gte(gapProofs.expiresOn, indiaToday(now)))));
  return new Set(rows.map((r) => r.userId));
}

type Candidate = {
  id: string;
  name: string | null;
  username: string | null;
  city: string | null;
  showTargetRole: boolean | null;
  showSkills: boolean | null;
  state: ConnectionState;
  how: ConnectionHow | null;
  at: Date | null;
  endsAt: Date | null;
};

/** A person as listed, with their target role's slug for the filters; the slug never leaves this file. */
type Enriched = { person: NetworkPerson; roleSlug: string | null };

/** Rows of people as Network shows them to `userId`. A missing settings row means the defaults: target role off, skills on. */
async function asPeople(userId: string, people: Candidate[], db: Db | Tx, now: Date): Promise<Enriched[]> {
  const ids = people.map((p) => p.id);
  const [analyses, verified, sets] = await Promise.all([analysesOf([userId, ...ids], db), verifiedOf(ids, db, now), connectionSets([userId, ...ids], db)]);
  const mine = analyses.get(userId)?.met ?? [];
  const myConnections = sets.get(userId)!;
  const mutualIds = [...new Set(ids.flatMap((id) => mutualOf(myConnections, sets.get(id)!)))];
  const shown = await shownIds(userId, mutualIds, db);
  return people.map((p) => {
    const theirs = analyses.get(p.id);
    const person: NetworkPerson = {
      id: p.id,
      name: displayName(p.name),
      username: p.username,
      aim: (p.showTargetRole ?? DEFAULT_SETTINGS.showTargetRole) && theirs ? (roleTitles.get(theirs.roleSlug) ?? null) : null,
      city: p.city,
      verified: verified.has(p.id),
      common: skillsInCommon(mine, theirs?.met ?? [], p.showSkills ?? DEFAULT_SETTINGS.showSkills),
      mutual: mutualOf(myConnections, sets.get(p.id)!).filter((m) => shown.has(m)).length,
      state: p.state,
      how: p.how,
      at: p.at,
      endsAt: p.endsAt,
    };
    return { person, roleSlug: theirs?.roleSlug ?? null };
  });
}

const strip = (e: Enriched): NetworkPerson => e.person;

/** Active accounts (not deleted, not suspended) with no block either way with `userId`. Applies to `users`. */
function shownTo(userId: string): SQL {
  return and(
    isNull(users.deletionRequestedAt),
    isNull(users.suspendedAt),
    sql`not exists (select 1 from ${blocks} b where (b.blocker_id = ${users.id} and b.blocked_id = ${userId}) or (b.blocker_id = ${userId} and b.blocked_id = ${users.id}))`,
  )!;
}

const personColumns = {
  id: users.id,
  name: users.name,
  username: users.username,
  city: users.city,
  showTargetRole: userSettings.showTargetRole,
  showSkills: userSettings.showSkills,
};

/** The /network tabs: Connections (newest first), Requests waiting on this person, and Sent, each with its count. */
export async function networkLists(userId: string, deps: Deps = {}): Promise<{ connections: NetworkPerson[]; requests: NetworkPerson[]; sent: NetworkPerson[] }> {
  const db = deps.db ?? getDb();
  const now = deps.now ?? new Date();
  const other = sql<string>`case when ${connections.userLow} = ${userId} then ${connections.userHigh} else ${connections.userLow} end`;
  const [connected, incoming, outgoing] = await Promise.all([
    db
      .select({ ...personColumns, how: connections.how, at: connections.createdAt })
      .from(connections)
      .innerJoin(users, eq(users.id, other))
      .leftJoin(userSettings, eq(userSettings.userId, users.id))
      .where(and(or(eq(connections.userLow, userId), eq(connections.userHigh, userId)), shownTo(userId)))
      .orderBy(desc(connections.createdAt), asc(users.id)),
    db
      .select({ ...personColumns, how: connectionRequests.how, at: connectionRequests.createdAt, status: connectionRequests.status })
      .from(connectionRequests)
      .innerJoin(users, eq(users.id, connectionRequests.fromUser))
      .leftJoin(userSettings, eq(userSettings.userId, users.id))
      .where(and(eq(connectionRequests.toUser, userId), eq(connectionRequests.status, "pending"), shownTo(userId)))
      .orderBy(desc(connectionRequests.createdAt), asc(users.id)),
    db
      .select({ ...personColumns, how: connectionRequests.how, at: connectionRequests.createdAt, status: connectionRequests.status })
      .from(connectionRequests)
      .innerJoin(users, eq(users.id, connectionRequests.toUser))
      .leftJoin(userSettings, eq(userSettings.userId, users.id))
      .where(and(eq(connectionRequests.fromUser, userId), inArray(connectionRequests.status, ["pending", "ignored"]), shownTo(userId)))
      .orderBy(desc(connectionRequests.createdAt), asc(users.id)),
  ]);
  const people = await asPeople(
    userId,
    [
      ...connected.map((r) => ({ ...r, state: "connected" as const, endsAt: null })),
      ...incoming.filter((r) => requestOpen({ status: r.status, createdAt: r.at }, now)).map((r) => ({ ...r, state: "incoming" as const, endsAt: null })),
      ...outgoing.filter((r) => senderSeesRequested({ status: r.status, createdAt: r.at }, now)).map((r) => ({ ...r, state: "requested" as const, endsAt: endsAt({ createdAt: r.at }) })),
    ],
    db,
    now,
  );
  const of = (state: ConnectionState) => people.map(strip).filter((p) => p.state === state);
  return { connections: of("connected"), requests: of("incoming"), sent: of("requested") };
}

/** Requests waiting on this person, for the count on the Requests tab and next to Network in the nav and avatar menu. */
export async function requestsWaiting(userId: string, deps: Deps = {}): Promise<number> {
  const db = deps.db ?? getDb();
  const now = deps.now ?? new Date();
  const [row] = await db
    .select({ n: count() })
    .from(connectionRequests)
    .innerJoin(users, eq(users.id, connectionRequests.fromUser))
    .where(
      and(
        eq(connectionRequests.toUser, userId),
        eq(connectionRequests.status, "pending"),
        gte(connectionRequests.createdAt, openSince(now)),
        shownTo(userId),
      ),
    );
  return row?.n ?? 0;
}

/** The people a person may find by name (handoff 12j): their connections, people with a request open either way, and people who turned on "Let people find me". */
function findableBy(userId: string): SQL {
  return or(
    eq(userSettings.peopleCanFind, true),
    sql`exists (select 1 from ${connections} c where (c.user_low = ${userId} and c.user_high = ${users.id}) or (c.user_high = ${userId} and c.user_low = ${users.id}))`,
    sql`exists (select 1 from ${connectionRequests} r where r.status = 'pending' and ((r.from_user = ${userId} and r.to_user = ${users.id}) or (r.to_user = ${userId} and r.from_user = ${users.id})))`,
  )!;
}

/** The viewer's own role and city, for the "Aiming for my role" and "My city" filters and "On your line". */
async function viewerOf(userId: string, db: Db) {
  const [[me], analyses] = await Promise.all([db.select({ city: users.city }).from(users).where(eq(users.id, userId)), analysesOf([userId], db)]);
  return { city: me?.city ?? null, roleSlug: analyses.get(userId)?.roleSlug ?? null };
}

/**
 * Name search (handoff 12j): the start of a first name, last name or handle, over the people `findableBy` allows, never
 * the searcher or anyone with a block either way. Optional filters: aiming for my role, my city, verified. At most
 * NETWORK_SCAN_MAX are read (most recently saved settings first, as Find people does) and NETWORK_RESULTS_MAX shown.
 * Counts against the hourly search limit.
 */
export async function searchNetwork(userId: string, raw: unknown, deps: Deps = {}): Promise<NetworkResult<{ people: NetworkPerson[] }>> {
  const db = deps.db ?? getDb();
  const now = deps.now ?? new Date();
  const input = networkSearchInput.safeParse(raw);
  if (!input.success) return fail("invalid");
  const { q, sameRole, sameCity, verified } = input.data;
  if (!(await takeShared(LIMITS.networkSearchesPerUserHour, userId, { db, now: now.getTime() }))) return fail("limit");
  const me = await viewerOf(userId, db);
  if ((sameRole && !me.roleSlug) || (sameCity && !me.city)) return { ok: true, people: [] };
  const scanned = await db
    .select(personColumns)
    .from(users)
    .leftJoin(userSettings, eq(userSettings.userId, users.id))
    .where(and(findableBy(userId), sql`${users.name} is not null and btrim(${users.name}) <> ''`, sql`${users.id} <> ${userId}`, shownTo(userId), sameCity ? eq(users.city, me.city!) : undefined))
    .orderBy(desc(userSettings.updatedAt), asc(users.id))
    .limit(NETWORK_SCAN_MAX);
  if (scanned.length >= NETWORK_SCAN_MAX) logEvent("warn", "network_scan_capped", { scanned: scanned.length });
  const found = scanned.filter((p) => networkMatches(q, p));
  const states = await statesWith(userId, found.map((p) => p.id), db, now);
  const people = (await asPeople(userId, found.map((p) => ({ ...p, state: states.get(p.id) ?? "none", how: null, at: null, endsAt: null })), db, now))
    .filter((e) => (!sameRole || e.roleSlug === me.roleSlug) && (!verified || e.person.verified))
    .map(strip)
    .sort(byNetworkRank)
    .slice(0, NETWORK_RESULTS_MAX);
  return { ok: true, people };
}

/** How the person stands with each of these people. */
async function statesWith(userId: string, ids: string[], db: Db | Tx, now: Date): Promise<Map<string, ConnectionState>> {
  const out = new Map<string, ConnectionState>();
  if (!ids.length) return out;
  const [sets, requests] = await Promise.all([
    connectionSets([userId], db),
    db
      .select(requestColumns)
      .from(connectionRequests)
      .where(
        or(
          and(eq(connectionRequests.fromUser, userId), inArray(connectionRequests.toUser, ids)),
          and(eq(connectionRequests.toUser, userId), inArray(connectionRequests.fromUser, ids)),
        ),
      ),
  ]);
  const mine = sets.get(userId)!;
  for (const id of ids) {
    const rows: RequestRow[] = requests.filter((r) => r.fromUser === id || r.toUser === id);
    out.set(id, connectionState(mine.has(id), rows, userId, now));
  }
  return out;
}

/**
 * "On your line" (handoff 12j): up to ON_YOUR_LINE_MAX people aiming at the same role who turned on "Let people find
 * me" and aren't connected or asked either way, by most skills in common, never by anything paid.
 */
export async function onYourLine(userId: string, deps: Deps = {}): Promise<NetworkPerson[]> {
  const db = deps.db ?? getDb();
  const now = deps.now ?? new Date();
  const me = await viewerOf(userId, db);
  if (!me.roleSlug) return [];
  const scanned = await db
    .select(personColumns)
    .from(users)
    .innerJoin(userSettings, eq(userSettings.userId, users.id))
    .where(and(eq(userSettings.peopleCanFind, true), sql`${users.name} is not null and btrim(${users.name}) <> ''`, sql`${users.id} <> ${userId}`, shownTo(userId)))
    .orderBy(desc(userSettings.updatedAt), asc(users.id))
    .limit(NETWORK_SCAN_MAX);
  const states = await statesWith(userId, scanned.map((p) => p.id), db, now);
  const free = scanned.filter((p) => states.get(p.id) === "none");
  const people = await asPeople(userId, free.map((p) => ({ ...p, state: "none" as const, how: null, at: null, endsAt: null })), db, now);
  return people
    .filter((e) => e.roleSlug === me.roleSlug)
    .map(strip)
    .sort((a, b) => b.common - a.common || b.mutual - a.mutual || a.name.localeCompare(b.name, "en"))
    .slice(0, ON_YOUR_LINE_MAX);
}

/** The Network choices in Account settings > Privacy; a new user's defaults until they save some. */
export async function networkSettingsFor(userId: string, db: Pick<Db, "select"> = getDb()): Promise<NetworkSettings> {
  const [row] = await db
    .select({ peopleCanFind: userSettings.peopleCanFind, gapsVisibleTo: userSettings.gapsVisibleTo, requestsFrom: userSettings.requestsFrom })
    .from(userSettings)
    .where(eq(userSettings.userId, userId));
  return row ?? DEFAULT_NETWORK_SETTINGS;
}

/**
 * Saves the Network choices. A first save makes the settings row with a new user's other defaults (DEFAULT_SETTINGS,
 * "Your connections" among them), since the column's own default is still "Only you".
 */
export async function saveNetworkSettings(userId: string, raw: unknown, deps: Deps = {}): Promise<NetworkResult> {
  const db = deps.db ?? getDb();
  const now = deps.now ?? new Date();
  const input = networkSettings.safeParse(raw);
  if (!input.success) return fail("invalid");
  const { visibility, ...rest } = DEFAULT_SETTINGS;
  await db
    .insert(userSettings)
    .values({ userId, profileVisibility: visibility, ...rest, ...input.data, updatedAt: now })
    .onConflictDoUpdate({ target: userSettings.userId, set: { ...input.data, updatedAt: now } });
  return { ok: true };
}

/**
 * For "Download your data": the Network choices, your connections and the requests you sent and got, each with the
 * other person's name and handle, how you know them and the dates. Whether you ignored a request is yours; whether they
 * ignored yours isn't, so your sent requests read "pending" until they end.
 */
export async function exportNetwork(userId: string, db: Db = getDb(), now = new Date()) {
  const other = sql<string>`case when ${connections.userLow} = ${userId} then ${connections.userHigh} else ${connections.userLow} end`;
  const [settings, connected, sent, received] = await Promise.all([
    networkSettingsFor(userId, db),
    db
      .select({ name: users.name, username: users.username, how: connections.how, connectedAt: connections.createdAt })
      .from(connections)
      .innerJoin(users, eq(users.id, other))
      .where(or(eq(connections.userLow, userId), eq(connections.userHigh, userId)))
      .orderBy(asc(connections.createdAt)),
    db
      .select({ name: users.name, username: users.username, how: connectionRequests.how, status: connectionRequests.status, sentAt: connectionRequests.createdAt, decidedAt: connectionRequests.decidedAt })
      .from(connectionRequests)
      .innerJoin(users, eq(users.id, connectionRequests.toUser))
      .where(eq(connectionRequests.fromUser, userId))
      .orderBy(asc(connectionRequests.createdAt)),
    db
      .select({ name: users.name, username: users.username, how: connectionRequests.how, status: connectionRequests.status, receivedAt: connectionRequests.createdAt, decidedAt: connectionRequests.decidedAt })
      .from(connectionRequests)
      .innerJoin(users, eq(users.id, connectionRequests.fromUser))
      .where(eq(connectionRequests.toUser, userId))
      .orderBy(asc(connectionRequests.createdAt)),
  ]);
  const named = <T extends { name: string | null }>(r: T) => ({ ...r, name: displayName(r.name) });
  return {
    ...settings,
    connections: connected.map(named),
    requestsSent: sent.map((r) => {
      const hidden = r.status === "ignored";
      const status = hidden ? (now < endsAt({ createdAt: r.sentAt }) ? "pending" : "expired") : r.status;
      return named({ ...r, status, decidedAt: hidden ? null : r.decidedAt });
    }),
    requestsReceived: received.map(named),
  };
}
