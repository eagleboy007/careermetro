import "server-only";
import { and, asc, count, desc, eq, gte, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { getDb } from "@/db";
import type { Tx } from "@/db/lock";
import { blocks, connections, gapAnalyses, profiles, resumes, userSettings, users } from "@/db/schema";
import { roleProfiles } from "@/content";
import { displayName } from "@/lib/account/name";
import { logEvent } from "@/lib/log";
import { gapAnalysis } from "@/lib/schemas";
import { CONNECTION_PENDING_MAX, NETWORK_RESULTS_MAX, connectionAnswer, networkQuery, type ConnectionState } from "@/lib/schemas/network";
import { NETWORK_SCAN_MAX } from "@/lib/schemas/constants";
import { LIMITS, takeShared } from "@/lib/shared-limit";
import { byNetworkRank, connectionState, lapsedBefore, networkMatches, pairOf, skillsInCommon, type ConnectionRow } from "./rules";

/*
 * Network part 1 (FR-49, docs/plans/network-plan.md): requests, connections and search by name. Every function takes the
 * signed-in person's id and acts only on rows of their own pairs. Names, usernames and what was typed are never logged.
 */

type Db = ReturnType<typeof getDb>;
type Deps = { db?: Db; now?: Date };

export type NetworkError = "self" | "unavailable" | "limit" | "pending_max" | "not_found" | "invalid";

/** What each refusal tells the person. "unavailable" is deliberately vague: a block is never revealed. */
export const NETWORK_ERROR_TEXT: Record<NetworkError, string> = {
  self: "You can't connect with yourself.",
  unavailable: "You can't connect with this person.",
  limit: "You've reached the limit for this for now. Try again later.",
  pending_max: `You have ${CONNECTION_PENDING_MAX} requests waiting. Withdraw some, or wait for answers, to send more.`,
  not_found: "That request isn't there any more.",
  invalid: "Type at least 2 letters of the name or username.",
};

export type NetworkResult<T = object> = ({ ok: true } & T) | { ok: false; error: NetworkError };
const fail = (error: NetworkError) => ({ ok: false as const, error });

/** A person as Network lists them: name, target role if they show it, and a count of skills in common (handoff 12). */
export type NetworkPerson = {
  id: string;
  name: string;
  /** For the /u/<username> link; null when they have none. */
  username: string | null;
  /** Their target role, only when they show it on their profile. */
  aim: string | null;
  common: number;
  state: ConnectionState;
  /** When the request was sent or the connection made. */
  at: Date;
};

const roleTitles = new Map(roleProfiles.map((r) => [r.slug, r.title]));

/** The row of a pair, as `pairOf` stores it. */
const pairWhere = (x: string, y: string) => {
  const { userA, userB } = pairOf(x, y);
  return and(eq(connections.userA, userA), eq(connections.userB, userB));
};

const pairLock = (x: string, y: string, tx: Tx) => tx.execute(sql`select pg_advisory_xact_lock(hashtext(${["network", ...[x, y].sort()].join("|")}))`);

/** True when either person has blocked the other. */
async function blockedBetween(x: string, y: string, db: Db | Tx): Promise<boolean> {
  const rows = await db
    .select({ x: blocks.blockerId })
    .from(blocks)
    .where(or(and(eq(blocks.blockerId, x), eq(blocks.blockedId, y)), and(eq(blocks.blockerId, y), eq(blocks.blockedId, x))))
    .limit(1);
  return rows.length > 0;
}

/** Whether the account can be reached: it exists, isn't deleted (even within its 30 days) and isn't suspended (FR-46). */
async function reachable(userId: string, db: Db | Tx): Promise<boolean> {
  const [row] = await db.select({ deleted: users.deletionRequestedAt, suspended: users.suspendedAt }).from(users).where(eq(users.id, userId));
  return !!row && !row.deleted && !row.suspended;
}

async function rowOf(x: string, y: string, db: Db | Tx): Promise<ConnectionRow | null> {
  const [row] = await db
    .select({ status: connections.status, requestedBy: connections.requestedBy, ignoredAt: connections.ignoredAt, createdAt: connections.createdAt })
    .from(connections)
    .where(pairWhere(x, y));
  return row ?? null;
}

/**
 * Connect: sends a request, or connects at once when the other person already asked (two requests at once, or a
 * request this person ignored earlier). Asking again while a request stands changes nothing. Counts against the
 * daily request limit and the cap on requests waiting, only when a new request is made.
 */
export async function requestConnection(fromId: string, toId: string, deps: Deps = {}): Promise<NetworkResult<{ state: ConnectionState }>> {
  const db = deps.db ?? getDb();
  const now = deps.now ?? new Date();
  if (fromId === toId) return fail("self");
  return db.transaction(async (tx) => {
    await pairLock(fromId, toId, tx);
    if (!(await reachable(toId, tx)) || (await blockedBetween(fromId, toId, tx))) return fail("unavailable");
    const row = await rowOf(fromId, toId, tx);
    const state = connectionState(row, fromId, now);
    if (state === "connected" || state === "requested") return { ok: true as const, state };
    if (row && row.status === "pending" && row.requestedBy === toId && row.createdAt >= lapsedBefore(now)) {
      await tx.update(connections).set({ status: "accepted", acceptedAt: now, ignoredAt: null }).where(pairWhere(fromId, toId));
      logEvent("info", "connection_accepted");
      return { ok: true as const, state: "connected" as const };
    }
    const [waiting] = await tx
      .select({ n: count() })
      .from(connections)
      .where(and(eq(connections.requestedBy, fromId), eq(connections.status, "pending"), gte(connections.createdAt, lapsedBefore(now))));
    if ((waiting?.n ?? 0) >= CONNECTION_PENDING_MAX) return fail("pending_max");
    if (!(await takeShared(LIMITS.networkRequestsPerUser, fromId, { db: tx, now: now.getTime() }))) return fail("limit");
    // No row, or a request that lapsed: this one starts fresh, whoever sent the old one.
    const fresh = { status: "pending" as const, requestedBy: fromId, ignoredAt: null, createdAt: now, acceptedAt: null };
    await tx
      .insert(connections)
      .values({ ...pairOf(fromId, toId), ...fresh })
      .onConflictDoUpdate({ target: [connections.userA, connections.userB], set: fresh });
    logEvent("info", "connection_requested");
    return { ok: true as const, state: "requested" as const };
  });
}

/** Accept or Ignore a request the other person sent. Ignore hides it from Requests; the sender still reads Requested. */
export async function answerRequest(userId: string, fromId: string, answer: unknown, deps: Deps = {}): Promise<NetworkResult<{ state: ConnectionState }>> {
  const db = deps.db ?? getDb();
  const now = deps.now ?? new Date();
  const parsed = connectionAnswer.safeParse(answer);
  if (!parsed.success) return fail("invalid");
  return db.transaction(async (tx) => {
    await pairLock(userId, fromId, tx);
    const row = await rowOf(userId, fromId, tx);
    if (!row || row.status !== "pending" || row.requestedBy !== fromId || row.createdAt < lapsedBefore(now)) return fail("not_found");
    if (parsed.data === "ignore") {
      await tx.update(connections).set({ ignoredAt: now }).where(pairWhere(userId, fromId));
      return { ok: true as const, state: "none" as const };
    }
    if (!(await reachable(fromId, tx)) || (await blockedBetween(userId, fromId, tx))) return fail("not_found");
    await tx.update(connections).set({ status: "accepted", acceptedAt: now, ignoredAt: null }).where(pairWhere(userId, fromId));
    logEvent("info", "connection_accepted");
    return { ok: true as const, state: "connected" as const };
  });
}

/** Withdraw a request this person sent and nobody accepted. */
export async function withdrawRequest(userId: string, toId: string, db: Db = getDb()): Promise<NetworkResult> {
  const gone = await db
    .delete(connections)
    .where(and(pairWhere(userId, toId), eq(connections.status, "pending"), eq(connections.requestedBy, userId)))
    .returning({ a: connections.userA });
  return gone.length ? { ok: true } : fail("not_found");
}

/** Remove a connection, from either side. The other person isn't told. */
export async function removeConnection(userId: string, otherId: string, db: Db = getDb()): Promise<NetworkResult> {
  const gone = await db
    .delete(connections)
    .where(and(pairWhere(userId, otherId), eq(connections.status, "accepted")))
    .returning({ a: connections.userA });
  if (gone.length) logEvent("info", "connection_removed");
  return gone.length ? { ok: true } : fail("not_found");
}

/** Any connection or request between two people goes. Every block calls this, in the transaction that blocks. */
export async function dropBetween(tx: Tx | Db, x: string, y: string): Promise<void> {
  await tx.delete(connections).where(pairWhere(x, y));
}

/** Block from Network (a request or a profile): silent, as in the Inbox, and the connection or request goes with it. */
export async function blockPerson(userId: string, otherId: string, deps: Deps = {}): Promise<NetworkResult> {
  const db = deps.db ?? getDb();
  const now = deps.now ?? new Date();
  if (userId === otherId) return fail("self");
  await db.transaction(async (tx) => {
    await pairLock(userId, otherId, tx);
    await tx.insert(blocks).values({ blockerId: userId, blockedId: otherId, createdAt: now }).onConflictDoNothing();
    await dropBetween(tx, userId, otherId);
  });
  return { ok: true };
}

/** Whether two people are connected now (a block or a removal ends it at once). Profile visibility and the Inbox use it. */
export async function areConnected(x: string, y: string, db: Db | Tx = getDb()): Promise<boolean> {
  if (x === y) return false;
  const [row] = await db
    .select({ status: connections.status })
    .from(connections)
    .where(and(pairWhere(x, y), eq(connections.status, "accepted")));
  return !!row;
}

/** How the viewer and another person stand, for Connect, Requested, Connected or Accept on a profile or a result. */
export async function connectionWith(viewerId: string, otherId: string, deps: Deps = {}): Promise<ConnectionState> {
  if (viewerId === otherId) return "none";
  return connectionState(await rowOf(viewerId, otherId, deps.db ?? getDb()), viewerId, deps.now ?? new Date());
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

type Candidate = { id: string; name: string | null; username: string | null; showTargetRole: boolean | null; showSkills: boolean | null; at: Date; state: ConnectionState };

/** Rows of people as Network shows them to `userId`. Settings missing means the defaults: target role off, skills on. */
async function asPeople(userId: string, people: Candidate[], db: Db | Tx): Promise<NetworkPerson[]> {
  const analyses = await analysesOf([userId, ...people.map((p) => p.id)], db);
  const mine = analyses.get(userId)?.met ?? [];
  return people.map((p) => {
    const theirs = analyses.get(p.id);
    return {
      id: p.id,
      name: displayName(p.name),
      username: p.username,
      aim: p.showTargetRole && theirs ? (roleTitles.get(theirs.roleSlug) ?? null) : null,
      common: skillsInCommon(mine, theirs?.met ?? [], p.showSkills ?? true),
      state: p.state,
      at: p.at,
    };
  });
}

/** The other person in each of this person's pairs, if they can still be reached and no block stands either way. */
const otherOf = (userId: string) => sql<string>`case when ${connections.userA} = ${userId} then ${connections.userB} else ${connections.userA} end`;
const shownOther = (userId: string) =>
  and(
    isNull(users.deletionRequestedAt),
    isNull(users.suspendedAt),
    sql`not exists (select 1 from ${blocks} b where (b.blocker_id = ${users.id} and b.blocked_id = ${userId}) or (b.blocker_id = ${userId} and b.blocked_id = ${users.id}))`,
  );

/** The /network lists: connections (newest first), requests waiting on this person, and requests they sent. */
export async function networkLists(userId: string, deps: Deps = {}): Promise<{ connections: NetworkPerson[]; requests: NetworkPerson[]; sent: NetworkPerson[] }> {
  const db = deps.db ?? getDb();
  const now = deps.now ?? new Date();
  const rows = await db
    .select({
      id: users.id,
      name: users.name,
      username: users.username,
      showTargetRole: userSettings.showTargetRole,
      showSkills: userSettings.showSkills,
      status: connections.status,
      requestedBy: connections.requestedBy,
      ignoredAt: connections.ignoredAt,
      createdAt: connections.createdAt,
      acceptedAt: connections.acceptedAt,
    })
    .from(connections)
    .innerJoin(users, eq(users.id, otherOf(userId)))
    .leftJoin(userSettings, eq(userSettings.userId, users.id))
    .where(and(or(eq(connections.userA, userId), eq(connections.userB, userId)), shownOther(userId)))
    .orderBy(desc(sql`coalesce(${connections.acceptedAt}, ${connections.createdAt})`), asc(users.id));
  const people = await asPeople(
    userId,
    rows.flatMap((r) => {
      const state = connectionState(r, userId, now);
      return state === "none" ? [] : [{ ...r, state, at: r.acceptedAt ?? r.createdAt }];
    }),
    db,
  );
  return {
    connections: people.filter((p) => p.state === "connected"),
    requests: people.filter((p) => p.state === "incoming"),
    sent: people.filter((p) => p.state === "requested"),
  };
}

/** Requests waiting on this person, for the count on Network in the avatar menu. */
export async function requestsWaiting(userId: string, deps: Deps = {}): Promise<number> {
  const db = deps.db ?? getDb();
  const now = deps.now ?? new Date();
  const [row] = await db
    .select({ n: count() })
    .from(connections)
    .innerJoin(users, eq(users.id, connections.requestedBy))
    .where(
      and(
        or(eq(connections.userA, userId), eq(connections.userB, userId)),
        ne(connections.requestedBy, userId),
        eq(connections.status, "pending"),
        isNull(connections.ignoredAt),
        gte(connections.createdAt, lapsedBefore(now)),
        shownOther(userId),
      ),
    );
  return row?.n ?? 0;
}

/**
 * Network search by name or username (plan section 3). Finds only people who turned on "Let people find me by name",
 * have a name, aren't deleted or suspended, and have no block either way with the searcher; never the searcher. At
 * most NETWORK_SCAN_MAX are read, most recently saved settings first (as Find people does), and NETWORK_RESULTS_MAX
 * shown: connections first, then most skills in common, then name. Counts against the hourly search limit.
 */
export async function searchNetwork(userId: string, raw: unknown, deps: Deps = {}): Promise<NetworkResult<{ people: NetworkPerson[] }>> {
  const db = deps.db ?? getDb();
  const now = deps.now ?? new Date();
  const query = networkQuery.safeParse(raw);
  if (!query.success) return fail("invalid");
  if (!(await takeShared(LIMITS.networkSearchesPerUserHour, userId, { db, now: now.getTime() }))) return fail("limit");
  const scanned = await db
    .select({ id: users.id, name: users.name, username: users.username, showTargetRole: userSettings.showTargetRole, showSkills: userSettings.showSkills })
    .from(userSettings)
    .innerJoin(users, eq(users.id, userSettings.userId))
    .where(and(eq(userSettings.peopleCanFind, true), sql`${users.name} is not null and btrim(${users.name}) <> ''`, ne(users.id, userId), shownOther(userId)))
    .orderBy(desc(userSettings.updatedAt), asc(users.id))
    .limit(NETWORK_SCAN_MAX);
  if (scanned.length >= NETWORK_SCAN_MAX) logEvent("warn", "network_scan_capped", { scanned: scanned.length });
  const found = scanned.filter((p) => networkMatches(query.data, p));
  const pairs = found.length
    ? await db
        .select({ userA: connections.userA, userB: connections.userB, status: connections.status, requestedBy: connections.requestedBy, ignoredAt: connections.ignoredAt, createdAt: connections.createdAt })
        .from(connections)
        .where(
          or(
            and(eq(connections.userA, userId), inArray(connections.userB, found.map((p) => p.id))),
            and(eq(connections.userB, userId), inArray(connections.userA, found.map((p) => p.id))),
          ),
        )
    : [];
  const rowFor = new Map(pairs.map((r) => [r.userA === userId ? r.userB : r.userA, r]));
  const people = await asPeople(
    userId,
    found.map((p) => ({ ...p, state: connectionState(rowFor.get(p.id), userId, now), at: now })),
    db,
  );
  return { ok: true, people: people.sort(byNetworkRank).slice(0, NETWORK_RESULTS_MAX) };
}

/** "Let people find me by name", as saved (off when the person never chose). */
export async function peopleCanFindFor(userId: string, db: Db = getDb()): Promise<boolean> {
  const [row] = await db.select({ on: userSettings.peopleCanFind }).from(userSettings).where(eq(userSettings.userId, userId));
  return row?.on ?? false;
}

/** Turns "Let people find me by name" on or off. Off takes the person out of Network search at once. */
export async function setPeopleCanFind(userId: string, on: boolean, deps: Deps = {}): Promise<void> {
  const db = deps.db ?? getDb();
  const now = deps.now ?? new Date();
  await db
    .insert(userSettings)
    .values({ userId, peopleCanFind: on, updatedAt: now })
    .onConflictDoUpdate({ target: userSettings.userId, set: { peopleCanFind: on, updatedAt: now } });
}

/**
 * For "Download your data": the switch, your connections and the requests you sent and got, each with the other
 * person's name and username and the dates. Whether you ignored a request is yours; whether they ignored yours isn't.
 */
export async function exportNetwork(userId: string, db: Db = getDb()) {
  const [on, rows] = await Promise.all([
    peopleCanFindFor(userId, db),
    db
      .select({
        name: users.name,
        username: users.username,
        status: connections.status,
        requestedBy: connections.requestedBy,
        ignoredAt: connections.ignoredAt,
        createdAt: connections.createdAt,
        acceptedAt: connections.acceptedAt,
      })
      .from(connections)
      .innerJoin(users, eq(users.id, otherOf(userId)))
      .where(or(eq(connections.userA, userId), eq(connections.userB, userId)))
      .orderBy(asc(connections.createdAt)),
  ]);
  const person = (r: (typeof rows)[number]) => ({ name: displayName(r.name), username: r.username });
  return {
    peopleCanFind: on,
    connections: rows.filter((r) => r.status === "accepted").map((r) => ({ ...person(r), requestedAt: r.createdAt, connectedAt: r.acceptedAt })),
    requestsSent: rows.filter((r) => r.status === "pending" && r.requestedBy === userId).map((r) => ({ ...person(r), sentAt: r.createdAt })),
    requestsReceived: rows.filter((r) => r.status === "pending" && r.requestedBy !== userId).map((r) => ({ ...person(r), receivedAt: r.createdAt, ignoredAt: r.ignoredAt })),
  };
}
