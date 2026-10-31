import "server-only";
import { and, asc, count, desc, eq, gte, inArray, isNotNull, isNull, lt, or, sql, type SQL } from "drizzle-orm";
import { getDb } from "@/db";
import { directChatLock, networkPairLock, type Tx } from "@/db/lock";
import {
  blocks,
  connectionRequests,
  connections,
  conversationMembers,
  conversations,
  gapAnalyses,
  gapProofs,
  pathSteps,
  paths,
  profiles,
  reports,
  resumes,
  userInterests,
  userSettings,
  users,
} from "@/db/schema";
import { roleProfiles, skills } from "@/content";
import { displayName } from "@/lib/account/name";
import { pickedAt, pickedOnly } from "@/lib/gaps/current";
import { goalsOf, indiaToday } from "@/lib/goals/store";
import { logEvent } from "@/lib/log";
import { isSampleResume, SAMPLE_MIME } from "@/lib/resume/sample-mime";
import { forgetBetween, forgetRequests, notify } from "@/lib/notifications/store";
import { DEFAULT_SETTINGS, gapAnalysis } from "@/lib/schemas";
import { NETWORK_LIST_MAX } from "@/lib/schemas/constants";
import {
  CONNECTION_PENDING_MAX,
  DEFAULT_NETWORK_SETTINGS,
  NETWORK_RESULTS_MAX,
  connectionAnswer,
  connectionHow,
  networkSearchInput,
  networkSettings,
  personReportInput,
  type ConnectionHow,
  type ConnectionState,
  type NetworkSettings,
} from "@/lib/schemas/network";
import { LIMITS, takeShared } from "@/lib/shared-limit";
import {
  askAgainFrom,
  byNetworkRank,
  connectionState,
  endsAt,
  interestsInCommon,
  lineOrder,
  mutualOf,
  networkMatches,
  networkQueryParts,
  openSince,
  pairOf,
  pathTogether,
  requestOpen,
  senderSeesRequested,
  skillsInCommon,
  type LineGap,
  type RequestRow,
} from "./rules";
import type { InterestsInCommon, PathTogether } from "./types";

/*
 * Network part 1 (FR-49, handoff 12j, docs/plans/network-plan.md): requests, connections, name search and the Network
 * privacy choices. Every function takes the signed-in person's id and acts only on their own pairs. Names, handles and
 * what was typed are never logged.
 */

type Db = ReturnType<typeof getDb>;
type Deps = { db?: Db; now?: Date };

export type NetworkError = "self" | "self_report" | "unavailable" | "closed" | "wait" | "limit" | "pending_max" | "not_found" | "gone" | "invalid";

/** What each refusal tells the person. "unavailable" is deliberately vague: a block is never revealed. */
export const NETWORK_ERROR_TEXT: Record<NetworkError, string> = {
  self: "You can't connect with yourself.",
  self_report: "You can't report yourself.",
  unavailable: "You can't connect with this person.",
  closed: "This person isn't taking connection requests.",
  wait: "You asked this person recently. You can ask again later.",
  limit: "You've reached the limit for this for now. Try again later.",
  pending_max: `You have ${CONNECTION_PENDING_MAX} requests waiting. Withdraw some, or wait for answers, to send more.`,
  not_found: "That request isn't there any more.",
  gone: "That person isn't there any more.",
  invalid: "Check the details and try again.",
};

export type NetworkResult<T = object> = ({ ok: true } & T) | { ok: false; error: NetworkError };
const fail = (error: NetworkError) => ({ ok: false as const, error });

/**
 * A person as Network lists them (handoff 12j): name, handle, target role only if they show it, verified, a count
 * of skills in common and of mutual connections. Never email, phone, city (only companies see it, FR-41/FR-55, T74),
 * employer history, gaps or pay.
 */
export type NetworkPerson = {
  id: string;
  name: string;
  /** For the /u/<handle> link; null when they have none. */
  username: string | null;
  aim: string | null;
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

const pairLock = networkPairLock;

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

/** The direct Inbox chat between two people, if there is one (one per pair). */
async function directChat(x: string, y: string, tx: Tx | Db) {
  const mine = tx.select({ id: conversationMembers.conversationId }).from(conversationMembers).where(eq(conversationMembers.userId, x));
  const [row] = await tx
    .select({ id: conversations.id, status: conversations.status })
    .from(conversations)
    .innerJoin(conversationMembers, eq(conversationMembers.conversationId, conversations.id))
    .where(and(eq(conversations.kind, "direct"), eq(conversationMembers.userId, y), inArray(conversations.id, mine)))
    .limit(1);
  return row ?? null;
}

async function connect(tx: Tx, request: { id: string; fromUser: string; toUser: string; how: ConnectionHow }, now: Date) {
  await tx.update(connectionRequests).set({ status: "accepted", decidedAt: now }).where(eq(connectionRequests.id, request.id));
  await tx.insert(connections).values({ ...pairOf(request.fromUser, request.toUser), how: request.how, createdAt: now }).onConflictDoNothing();
  // Connections chat freely (handoff 12j): a message request waiting between them opens. Under the Inbox's lock too,
  // so a first message sent at the same moment either lands before this (and opens) or sees the connection.
  await directChatLock(request.fromUser, request.toUser, tx);
  const chat = await directChat(request.fromUser, request.toUser, tx);
  if (chat?.status === "request") await tx.update(conversations).set({ status: "open" }).where(eq(conversations.id, chat.id));
  // The person who asked is told, in the bell (docs/plans/notifications-plan.md).
  await notify(tx, { kind: "connection_accepted", userId: request.fromUser, actorId: request.toUser, connectionRequestId: request.id }, now);
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
            // Ignored ones count too: they still read Requested to the sender, so the limit can't tell them apart.
      .where(and(eq(connectionRequests.fromUser, fromId), inArray(connectionRequests.status, ["pending", "ignored"]), gte(connectionRequests.createdAt, openSince(now))));
    if ((waiting?.n ?? 0) >= CONNECTION_PENDING_MAX) return fail("pending_max");
    if (!(await takeShared(LIMITS.networkRequestsPerUser, fromId, { db: tx, now: now.getTime() }))) return fail("limit");
    await expireStale(fromId, toId, tx, now);
    const [made] = await tx.insert(connectionRequests).values({ fromUser: fromId, toUser: toId, how: picked.data, createdAt: now }).returning({ id: connectionRequests.id });
    await notify(tx, { kind: "connection_request", userId: toId, actorId: fromId, connectionRequestId: made!.id }, now);
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
  // Whatever reads Requested to the sender (open, or ignored and not yet ended) can be withdrawn, so an ignore stays
  // silent; the request still holds them until it would have ended (askAgainFrom).
  // The request's notification goes with it, in the same transaction.
  const gone = await db.transaction(async (tx) => {
    const rows = await tx
      .update(connectionRequests)
      .set({ status: "withdrawn", decidedAt: now })
      .where(
        and(
          eq(connectionRequests.fromUser, userId),
          eq(connectionRequests.toUser, toId),
          inArray(connectionRequests.status, ["pending", "ignored"]),
          gte(connectionRequests.createdAt, openSince(now)),
        ),
      )
      .returning({ id: connectionRequests.id, status: connectionRequests.status });
    await forgetRequests(tx, rows.map((r) => r.id));
    return rows;
  });
  return gone.length ? { ok: true } : fail("not_found");
}

/**
 * Remove a connection, from either side. The other person isn't told; either can connect again. Free chat ends with
 * it (handoff 12j): their chat stays in the Inbox as a message request to the person who removed, so the other can't
 * write again until it is accepted.
 */
export async function removeConnection(userId: string, otherId: string, db: Db = getDb()): Promise<NetworkResult> {
  const gone = await db.transaction(async (tx) => {
    await pairLock(userId, otherId, tx);
    const rows = await tx.delete(connections).where(pairWhere(userId, otherId)).returning({ low: connections.userLow });
    if (!rows.length) return false;
    // Their notifications to each other go too (docs/plans/notifications-plan.md).
    await forgetBetween(tx, userId, otherId);
    // Under the Inbox's lock too, so a first message sent at the same moment can't open a chat after this looked.
    await directChatLock(userId, otherId, tx);
    const chat = await directChat(userId, otherId, tx);
    if (chat?.status === "open") {
      await tx.update(conversations).set({ status: "request", startedBy: otherId }).where(eq(conversations.id, chat.id));
      // The remover answers the request, so a chat they had hidden comes back for them to accept or delete.
      await tx.update(conversationMembers).set({ hiddenAt: null }).where(and(eq(conversationMembers.conversationId, chat.id), eq(conversationMembers.userId, userId)));
    }
    return true;
  });
  if (gone) logEvent("info", "connection_removed");
  return gone ? { ok: true } : fail("not_found");
}

/**
 * Any connection between two people goes, any open request is withdrawn, and their notifications to each other are
 * deleted. Every block calls this, in its transaction.
 */
export async function dropBetween(tx: Tx | Db, x: string, y: string, now = new Date()): Promise<void> {
  await tx.delete(connections).where(pairWhere(x, y));
  await forgetBetween(tx, x, y);
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
  const blocked = await db.transaction(async (tx) => {
    await pairLock(userId, otherId, tx);
    // An id that names nobody is refused here, not left to the foreign key (Testing Run 5, T84).
    const [other] = await tx.select({ id: users.id }).from(users).where(eq(users.id, otherId));
    if (!other) return false;
    await tx.insert(blocks).values({ blockerId: userId, blockedId: otherId, createdAt: now }).onConflictDoNothing();
    await dropBetween(tx, userId, otherId, now);
    return true;
  });
  return blocked ? { ok: true } : fail("gone");
}

/** A person this person blocked, for Settings > Privacy: name and when, never anything else. */
export type BlockedPerson = { id: string; name: string; since: Date };

/**
 * The people this person blocked (from Network or the Inbox), newest first, for "Blocked people" in Settings > Privacy.
 * Only blocks they made: never who blocked them. Deleted and suspended accounts are left out, as everywhere else.
 */
export async function blockedPeople(userId: string, db: Pick<Db, "select"> = getDb()): Promise<BlockedPerson[]> {
  const rows = await db
    .select({ id: users.id, name: users.name, since: blocks.createdAt })
    .from(blocks)
    .innerJoin(users, eq(users.id, blocks.blockedId))
    .where(and(eq(blocks.blockerId, userId), isNull(users.deletionRequestedAt), isNull(users.suspendedAt)))
    .orderBy(desc(blocks.createdAt), asc(users.id));
  return rows.map((r) => ({ id: r.id, name: displayName(r.name), since: r.since }));
}

/**
 * Unblock from Settings > Privacy: only a block this person made. Nothing comes back with it: a connection or request
 * the block ended stays ended, and chats it hid stay hidden until a new message arrives. The other person isn't told.
 */
export async function unblockPerson(userId: string, otherId: string, db: Db = getDb(), now: Date = new Date()): Promise<NetworkResult> {
  if (userId === otherId) return fail("self");
  // Each try counts toward the day's unblocks (launch-readiness pass), in the same transaction as the delete.
  const outcome = await db.transaction(async (tx): Promise<"limit" | "gone" | "none"> => {
    if (!(await takeShared(LIMITS.unblocksPerUserDay, userId, { db: tx, now: now.getTime() }))) return "limit";
    await pairLock(userId, otherId, tx);
    const rows = await tx
      .delete(blocks)
      .where(and(eq(blocks.blockerId, userId), eq(blocks.blockedId, otherId)))
      .returning({ at: blocks.createdAt });
    return rows.length ? "gone" : "none";
  });
  if (outcome === "limit") return fail("limit");
  if (outcome === "none") return fail("not_found");
  logEvent("info", "person_unblocked");
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

/**
 * Each person's met skills, gaps and target role, from their current analysis, as on their own Gaps page. A current
 * analysis of the sample resume ("Try a sample resume") is a made-up person's, so for anyone but `viewerId` it counts
 * as none: never an older resume instead, and never skills, gaps or a role shown to others. The viewer's own sample is
 * kept, marked `sample`, so their own skills still count for them while it aims at nothing (T112, as canViewProfile).
 */
type AnalysisOf = { id: string; roleSlug: string; met: string[]; gaps: LineGap[]; sample: boolean };
async function analysesOf(userIds: string[], viewerId: string, db: Db | Tx): Promise<Map<string, AnalysisOf>> {
  const out = new Map<string, AnalysisOf>();
  if (!userIds.length) return out;
  const rows = await db
    .selectDistinctOn([resumes.userId], { userId: resumes.userId, id: gapAnalyses.id, result: gapAnalyses.result, mimeType: resumes.mimeType })
    .from(gapAnalyses)
    .innerJoin(profiles, eq(profiles.id, gapAnalyses.profileId))
    .innerJoin(resumes, eq(resumes.id, profiles.resumeId))
    // As currentAnalysis: the analysis picked last, never one waiting for "Make this my destination".
    .where(and(inArray(resumes.userId, userIds), sql`${profiles.version} = (select max(p2.version) from profiles p2 where p2.resume_id = ${profiles.resumeId})`, pickedOnly))
    .orderBy(resumes.userId, desc(pickedAt), desc(gapAnalyses.createdAt));
  for (const r of rows) {
    if (r.userId !== viewerId && isSampleResume(r.mimeType)) continue;
    const parsed = gapAnalysis.safeParse(r.result);
    if (r.userId && parsed.success)
      out.set(r.userId, {
        id: r.id,
        roleSlug: parsed.data.roleSlug,
        met: parsed.data.metSkillIds,
        gaps: parsed.data.gaps.map((g) => ({ skillId: g.skillId, status: g.status })),
        sample: isSampleResume(r.mimeType),
      });
  }
  return out;
}

/** For each analysis, the skills whose step on its newest path is ticked done: the Map's learn pitstops that are done. */
async function learnedOf(analysisIds: string[], db: Db | Tx): Promise<Map<string, Set<string>>> {
  const out = new Map<string, Set<string>>();
  if (!analysisIds.length) return out;
  const newest = await db
    .selectDistinctOn([paths.gapAnalysisId], { id: paths.id, analysisId: paths.gapAnalysisId })
    .from(paths)
    .where(inArray(paths.gapAnalysisId, analysisIds))
    .orderBy(paths.gapAnalysisId, desc(paths.createdAt));
  if (!newest.length) return out;
  const analysisOf = new Map(newest.map((p) => [p.id, p.analysisId]));
  const done = await db
    .select({ pathId: pathSteps.pathId, skillId: pathSteps.skillId })
    .from(pathSteps)
    .where(and(inArray(pathSteps.pathId, [...analysisOf.keys()]), isNotNull(pathSteps.doneAt), eq(pathSteps.source, "app")));
  for (const s of done) {
    const id = analysisOf.get(s.pathId)!;
    out.set(id, (out.get(id) ?? new Set<string>()).add(s.skillId));
  }
  return out;
}

const skillNames = new Map(skills.map((x) => [x.id, x.name]));

/**
 * "In common with you" on a profile (handoff 12j): the skills both have, by name, when the owner shows skills, and the
 * target role when both aim at it and the owner shows theirs. The viewer's own current sample aims at nothing, so it
 * shares no role (T112). Nothing about the viewer is shown to the owner.
 */
export async function inCommonWith(
  viewerId: string,
  owner: { id: string; settings: { showSkills: boolean; showTargetRole: boolean } },
  db: Db = getDb(),
): Promise<{ skills: string[]; role: string | null }> {
  if (viewerId === owner.id) return { skills: [], role: null };
  const analyses = await analysesOf([viewerId, owner.id], viewerId, db);
  const mine = analyses.get(viewerId);
  const theirs = analyses.get(owner.id);
  if (!mine || !theirs) return { skills: [], role: null };
  const met = new Set(mine.met);
  const shared = owner.settings.showSkills ? [...new Set(theirs.met.filter((id) => met.has(id)))] : [];
  return {
    skills: shared.map((id) => skillNames.get(id) ?? id).sort((a, b) => a.localeCompare(b, "en")),
    role: owner.settings.showTargetRole && !mine.sample && mine.roleSlug === theirs.roleSlug ? (roleTitles.get(theirs.roleSlug) ?? null) : null,
  };
}

/**
 * "Gaps and path" on a profile (handoff 12j, gap list 27): the gaps both still have and each one's current goal, when
 * both aim at the same role. Only call it when the viewer may see the owner's gaps (seesGaps) and the owner shows their
 * target role; `sharedWith` says why they may. Reads goals without writing them. Null on your own profile.
 */
export async function pathTogetherWith(viewerId: string, ownerId: string, sharedWith: PathTogether["sharedWith"], db: Db = getDb()): Promise<PathTogether | null> {
  if (viewerId === ownerId) return null;
  const [analyses, mine, theirs] = await Promise.all([analysesOf([viewerId, ownerId], viewerId, db), goalsOf(viewerId, db), goalsOf(ownerId, db)]);
  const a = analyses.get(viewerId);
  const b = analyses.get(ownerId);
  // The viewer's own current sample aims at nothing, so it is on no line with anyone (T112).
  if (!a || !b || a.sample || a.roleSlug !== b.roleSlug) return null;
  const learned = await learnedOf([a.id, b.id], db);
  return pathTogether(lineOrder(a.gaps, mine, learned.get(a.id)), lineOrder(b.gaps, theirs, learned.get(b.id)), (id) => skillNames.get(id) ?? id, sharedWith);
}

/**
 * "Interests" in common on a profile (gap list 27, docs/plans/me-editing-plan.md): the owner's interests the viewer
 * also lists. Interests show on any profile the viewer can open, so only call it once the page has decided they may
 * open it. Null on your own profile or when either lists none.
 */
export async function interestsInCommonWith(viewerId: string, ownerId: string, db: Pick<Db, "select"> = getDb()): Promise<InterestsInCommon | null> {
  if (viewerId === ownerId) return null;
  const rows = await db
    .select({ userId: userInterests.userId, name: userInterests.name, key: userInterests.nameKey })
    .from(userInterests)
    .where(inArray(userInterests.userId, [viewerId, ownerId]))
    .orderBy(asc(userInterests.createdAt), asc(userInterests.nameKey));
  return interestsInCommon(
    rows.filter((r) => r.userId === viewerId),
    rows.filter((r) => r.userId === ownerId),
  );
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
  const [analyses, verified, sets] = await Promise.all([analysesOf([userId, ...ids], userId, db), verifiedOf(ids, db, now), connectionSets([userId, ...ids], db)]);
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
  showTargetRole: userSettings.showTargetRole,
  showSkills: userSettings.showSkills,
};

/** The /network tabs: Connections (newest first), Requests waiting on this person, and Sent, each with its count, NETWORK_LIST_MAX rows each at most. */
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
      .orderBy(desc(connections.createdAt), asc(users.id))
      .limit(NETWORK_LIST_MAX),
    db
      .select({ ...personColumns, how: connectionRequests.how, at: connectionRequests.createdAt, status: connectionRequests.status })
      .from(connectionRequests)
      .innerJoin(users, eq(users.id, connectionRequests.fromUser))
      .leftJoin(userSettings, eq(userSettings.userId, users.id))
      .where(and(eq(connectionRequests.toUser, userId), eq(connectionRequests.status, "pending"), shownTo(userId)))
      .orderBy(desc(connectionRequests.createdAt), asc(users.id))
      .limit(NETWORK_LIST_MAX),
    db
      .select({ ...personColumns, how: connectionRequests.how, at: connectionRequests.createdAt, status: connectionRequests.status })
      .from(connectionRequests)
      .innerJoin(users, eq(users.id, connectionRequests.toUser))
      .leftJoin(userSettings, eq(userSettings.userId, users.id))
      .where(and(eq(connectionRequests.fromUser, userId), inArray(connectionRequests.status, ["pending", "ignored"]), shownTo(userId)))
      .orderBy(desc(connectionRequests.createdAt), asc(users.id))
      .limit(NETWORK_LIST_MAX),
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

/** Whether `users` is connected to `userId` (by the connections key and connections_user_high). */
const connectedTo = (userId: string): SQL =>
  sql`exists (select 1 from ${connections} c where (c.user_low = ${userId} and c.user_high = ${users.id}) or (c.user_high = ${userId} and c.user_low = ${users.id}))`;

/** The people a person may find by name (handoff 12j): their connections and people who turned on "Let people find me". */
function findableBy(userId: string): SQL {
  return or(eq(userSettings.peopleCanFind, true), connectedTo(userId))!;
}

/**
 * The name as searchKey reads it, with a space in front: NFKD, accents dropped, lowercase, anything but a-z and 0-9 one
 * space. So " <word>" in it is the start of a word of the name, as networkMatches checks.
 */
const nameKey = sql`' ' || btrim(regexp_replace(lower(regexp_replace(normalize(${users.name}, NFKD), ${"[\u0300-\u036f]"}, '', 'g')), '[^a-z0-9]+', ' ', 'g'))`;

/** The typed search as SQL over `users` (T77): the start of the handle, or every word starting a word of the name. */
function matchesQuery(q: string): SQL | null {
  const { handle, words } = networkQueryParts(q);
  const byHandle = handle ? sql`starts_with(lower(${users.username}), ${handle})` : undefined;
  const byName = words.length ? and(...words.map((w) => sql`position(${` ${w}`} in ${nameKey}) > 0`)) : undefined;
  return or(byHandle, byName) ?? null;
}

/** At least one current accepted proof, in SQL over `users`: the same rule as verifiedOf. */
const provedSql = (now: Date): SQL =>
  sql`exists (select 1 from ${gapProofs} gp where gp.user_id = ${users.id} and gp.status = 'accepted' and (gp.expires_on is null or gp.expires_on >= ${indiaToday(now)}))`;

/**
 * Shows their target role and it is `roleSlug`, in SQL over `users` (joined to user_settings): the role of their newest
 * analysis on each resume's newest profile, as analysesOf reads it. The page is checked again after it is read. A
 * newest analysis of the sample resume aims at nothing.
 */
const aimsAtSql = (roleSlug: string): SQL =>
  sql`coalesce(${userSettings.showTargetRole}, ${DEFAULT_SETTINGS.showTargetRole}) and (select case when r.mime_type = ${SAMPLE_MIME} then null else ga.result->>'roleSlug' end from ${gapAnalyses} ga join ${profiles} pr on pr.id = ga.profile_id join ${resumes} r on r.id = pr.resume_id where r.user_id = ${users.id} and pr.version = (select max(p2.version) from ${profiles} p2 where p2.resume_id = pr.resume_id) order by ga.created_at desc limit 1) = ${roleSlug}`;

/** The viewer's own target role, for the "Aiming for my role" filter. A current sample resume aims at nothing (T112). */
async function viewerOf(userId: string, db: Db) {
  const mine = (await analysesOf([userId], userId, db)).get(userId);
  return { roleSlug: mine && !mine.sample ? mine.roleSlug : null };
}

/**
 * The person's own target role slug, or null: the role of their newest analysis, as "Aiming for my role" reads it (a
 * current sample resume aims at nothing). Junction's My route uses the same rule (docs/plans/junction-plan.md).
 */
export async function targetRoleSlugOf(userId: string, db: Db | Tx = getDb()): Promise<string | null> {
  const mine = (await analysesOf([userId], userId, db)).get(userId);
  return mine && !mine.sample ? mine.roleSlug : null;
}

/** A role slug's title, or null for one no longer in the catalog. */
export const roleTitleOf = (slug: string | null): string | null => (slug ? (roleTitles.get(slug) ?? null) : null);

/** The person's own target role (its title), to label Find people's filter; a filter they can't use isn't offered. */
export async function networkFiltersFor(userId: string, db: Db = getDb()): Promise<{ role: string | null }> {
  const me = await viewerOf(userId, db);
  return { role: me.roleSlug ? (roleTitles.get(me.roleSlug) ?? null) : null };
}

/**
 * Name search (handoff 12j): the start of a first name, last name or handle, over the people `findableBy` allows, never
 * the searcher or anyone with a block either way. Optional filters: aiming for my role (only people who show their
 * target role, so the filter never reveals a hidden one) and verified. There is no city filter for members (T93): with a
 * name it would tell the searcher whether that person lives in their city, and only companies see a member's city. The
 * match and the filters run in SQL, which returns one page of NETWORK_RESULTS_MAX (connections first, then by name),
 * and only that page is worked out and put in Network's order (T77). Counts against the hourly search limit.
 */
export async function searchNetwork(userId: string, raw: unknown, deps: Deps = {}): Promise<NetworkResult<{ people: NetworkPerson[] }>> {
  const db = deps.db ?? getDb();
  const now = deps.now ?? new Date();
  const input = networkSearchInput.safeParse(raw);
  if (!input.success) return fail("invalid");
  const { q, sameRole, verified } = input.data;
  if (!(await takeShared(LIMITS.networkSearchesPerUserHour, userId, { db, now: now.getTime() }))) return fail("limit");
  const me = await viewerOf(userId, db);
  if (sameRole && !me.roleSlug) return { ok: true, people: [] };
  const match = matchesQuery(q);
  if (!match) return { ok: true, people: [] };
  const page = await db
    .select(personColumns)
    .from(users)
    .leftJoin(userSettings, eq(userSettings.userId, users.id))
    .where(
      and(
        findableBy(userId),
        sql`${users.name} is not null and btrim(${users.name}) <> ''`,
        sql`${users.id} <> ${userId}`,
        shownTo(userId),
        match,
        sameRole ? aimsAtSql(me.roleSlug!) : undefined,
        verified ? provedSql(now) : undefined,
      ),
    )
    .orderBy(desc(connectedTo(userId)), asc(sql`lower(${users.name})`), asc(users.id))
    // A few spare rows, so the checks below and the ranking still fill a page of the best.
    .limit(NETWORK_RESULTS_MAX * 2);
  const found = page.filter((p) => networkMatches(q, p));
  const states = await statesWith(userId, found.map((p) => p.id), db, now);
  const people = (await asPeople(userId, found.map((p) => ({ ...p, state: states.get(p.id) ?? "none", how: null, at: null, endsAt: null })), db, now))
    .filter((e) => (!sameRole || (e.person.aim !== null && e.roleSlug === me.roleSlug)) && (!verified || e.person.verified))
    .map(strip)
    .sort(byNetworkRank)
    .slice(0, NETWORK_RESULTS_MAX);
  return { ok: true, people };
}

/**
 * Report from Network (a row or a profile, handoff 12j) into the same review queue and deadlines as Inbox reports
 * (FR-45). The person reported isn't told, nor who reported. One open report per reporter and person: asking again is
 * the same report. Counts against the daily report limit. Logged by reason only.
 */
export async function reportPerson(userId: string, raw: unknown, deps: Deps = {}): Promise<NetworkResult> {
  const db = deps.db ?? getDb();
  const now = deps.now ?? new Date();
  const input = personReportInput.safeParse(raw);
  if (!input.success) return fail("invalid");
  const r = input.data;
  if (r.personId === userId) return fail("self_report");
  const out = await db.transaction(async (tx): Promise<NetworkResult> => {
    // One reporter and person at a time, so two quick reports can't both find no open one and insert twice.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`network-report:${userId}|${r.personId}`}))`);
    const [target] = await tx.select({ id: users.id }).from(users).where(eq(users.id, r.personId));
    if (!target) return fail("invalid");
    const [already] = await tx
      .select({ id: reports.id })
      .from(reports)
      .where(and(eq(reports.reporterId, userId), eq(reports.target, "person"), eq(reports.targetId, r.personId), eq(reports.status, "open")))
      .limit(1);
    if (already) return { ok: true };
    if (!(await takeShared(LIMITS.inboxReportsPerUser, userId, { db: tx, now: now.getTime() }))) return fail("limit");
    await tx.insert(reports).values({ reporterId: userId, target: "person", targetId: r.personId, reason: r.reason, note: r.note || null, createdAt: now });
    return { ok: true };
  });
  if (out.ok) logEvent("info", "network_report", { reason: r.reason, status: "open" });
  return out;
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
    .values({ userId, profileVisibility: visibility, ...rest, ...input.data, showGaps: input.data.gapsVisibleTo === "profile", updatedAt: now })
    .onConflictDoUpdate({ target: userSettings.userId, set: { ...input.data, showGaps: input.data.gapsVisibleTo === "profile", updatedAt: now } });
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
      const ended = now >= endsAt({ createdAt: r.sentAt });
      const status = hidden || r.status === "pending" ? (ended ? "expired" : "pending") : r.status;
      return named({ ...r, status, decidedAt: hidden ? null : r.decidedAt });
    }),
    requestsReceived: received.map(named),
  };
}

/** The person's own handle, for "Copy your profile link" on an empty Connections tab. */
export async function ownUsername(userId: string, db: Pick<Db, "select"> = getDb()): Promise<string | null> {
  const [row] = await db.select({ username: users.username }).from(users).where(eq(users.id, userId));
  return row?.username ?? null;
}
