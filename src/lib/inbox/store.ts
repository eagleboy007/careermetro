import "server-only";
import { and, asc, desc, eq, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { directChatLock, networkPairLock } from "@/db/lock";
import { applications, blocks, candidateSlots, conversationMembers, conversations, jobs, messages, organizations, reports, userSettings, users } from "@/db/schema";
import { displayName } from "@/lib/account/name";
import { blockCompanyIn, companyBlocked } from "@/lib/corporate/company-blocks";
import { askDaysOf } from "@/lib/corporate/interview-reads";
import { chatClosed } from "@/lib/corporate/rules";
import { askAnswered, dayParts, slotLabel, slotOpen, slotStart } from "@/lib/corporate/slots";
import { SLOT_TIMES } from "@/lib/schemas/constants";
import { jobSearchOn } from "@/lib/job-search/store";
import { logEvent } from "@/lib/log";
import { areConnected, dropBetween } from "@/lib/network/store";
import { messageBody, reportInput, type ReportInput } from "@/lib/schemas/inbox";
import { LIMITS, takeShared } from "@/lib/shared-limit";
import { isHidden, shownBody } from "./hidden";
import type { InboxMessage, InboxThread } from "./types";

/*
 * The Inbox's rules (dev/inbox-plan.md, approved by Milin 2026-10-11). Every function takes the signed-in person's id
 * and checks membership itself, so a caller can't read or write a chat it isn't in. Message text is never logged.
 *
 * Application chats (corporate build step 5) are the candidate's here: the person who applied is their one `member`.
 * The company's side reads and writes them only through Corporate Messages (src/lib/corporate/chats-store.ts), which
 * checks the live company role every time; its `company_team` member rows only hold unread counts, so the personal
 * Inbox neither lists nor writes those chats for a recruiter.
 */

type Db = ReturnType<typeof getDb>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export type InboxError = "not_found" | "unavailable" | "waiting" | "accept_first" | "read_only" | "closed" | "paused" | "limit" | "self" | "invalid";

/** What each refusal tells the person. "unavailable" is deliberately vague: a block is never revealed. */
export const INBOX_ERROR_TEXT: Record<InboxError, string> = {
  not_found: "That chat isn't available.",
  unavailable: "You can't message this person.",
  waiting: "They haven't accepted your request yet. You can send more once they do.",
  accept_first: "Accept the request to reply.",
  read_only: "You can read this chat but not send in it.",
  closed: "This chat is closed.",
  paused: "This company's messages are paused while we review it.",
  limit: "You've reached today's limit for this. Try again tomorrow.",
  self: "You can't message yourself.",
  invalid: "Write a message of up to 2,000 characters.",
};

export type InboxResult<T = object> = ({ ok: true } & T) | { ok: false; error: InboxError };

/** Messages loaded per chat. Older ones come with paging later; a part-1 chat rarely reaches this. */
export const MESSAGES_PER_CHAT = 200;

const fail = (error: InboxError) => ({ ok: false as const, error });

/** True when either person has blocked the other. */
async function blockedBetween(a: string, b: string, db: Db | Tx): Promise<boolean> {
  const rows = await db
    .select({ x: blocks.blockerId })
    .from(blocks)
    .where(or(and(eq(blocks.blockerId, a), eq(blocks.blockedId, b)), and(eq(blocks.blockerId, b), eq(blocks.blockedId, a))))
    .limit(1);
  return rows.length > 0;
}

/** Whether the account can be reached: it exists and is not deleted (even within its 30 days). */
async function reachable(userId: string, db: Db | Tx): Promise<boolean> {
  const [row] = await db.select({ deleted: users.deletionRequestedAt }).from(users).where(eq(users.id, userId));
  return !!row && !row.deleted;
}

/** A new chat also needs the person not suspended (FR-46), as Network shows them to nobody while suspended. */
async function startable(userId: string, db: Db | Tx): Promise<boolean> {
  const [row] = await db.select({ deleted: users.deletionRequestedAt, suspended: users.suspendedAt }).from(users).where(eq(users.id, userId));
  return !!row && !row.deleted && !row.suspended;
}

/**
 * "Allow message requests from people who aren't connections" (FR-55, gap list item 33): on with no settings row. Off,
 * a first message from someone who isn't a connection is refused as "unavailable", the same words as a block, so a
 * blocked person can't tell the two apart.
 */
async function takesRequests(userId: string, db: Db | Tx): Promise<boolean> {
  const [row] = await db.select({ on: userSettings.messageRequests }).from(userSettings).where(eq(userSettings.userId, userId));
  return row?.on ?? true;
}

/** The direct chat between two people, if there is one. */
async function directBetween(a: string, b: string, db: Db | Tx) {
  const mine = db.select({ id: conversationMembers.conversationId }).from(conversationMembers).where(eq(conversationMembers.userId, a));
  const [row] = await db
    .select({ id: conversations.id, status: conversations.status, startedBy: conversations.startedBy })
    .from(conversations)
    .innerJoin(conversationMembers, eq(conversationMembers.conversationId, conversations.id))
    .where(and(eq(conversations.kind, "direct"), eq(conversationMembers.userId, b), inArray(conversations.id, mine)))
    .limit(1);
  return row ?? null;
}

const pairLock = directChatLock;

/**
 * Starts a direct chat. With someone who isn't a connection it is a request: this one message, then nothing more until
 * they accept, and only while they allow message requests (FR-55). Between connections it is open at once. A chat that
 * already exists gets the message instead, under its rules (a request already sent stays, whatever the switch says).
 */
export async function startDirect(fromId: string, toId: string, body: string, deps: { db?: Db; now?: Date } = {}): Promise<InboxResult<{ conversationId: string }>> {
  const db = deps.db ?? getDb();
  const now = deps.now ?? new Date();
  const text = messageBody.safeParse(body);
  if (!text.success) return fail("invalid");
  if (fromId === toId) return fail("self");
  if (!(await reachable(toId, db)) || (await blockedBetween(fromId, toId, db))) return fail("unavailable");
  const existing = await directBetween(fromId, toId, db);
  if (existing) {
    const sent = await sendMessage(fromId, existing.id, body, deps);
    return sent.ok ? { ok: true, conversationId: existing.id } : sent;
  }
  // Connections chat freely (handoff 12j): their first message opens the chat, with no request and no request limit.
  // Whether they are connected, and so whether message requests off (FR-55) refuses, is read only under the lock below,
  // so someone who connected a moment ago is never refused by a stale first look (T102). Both come before the limit.
  return db.transaction(async (tx) => {
    await pairLock(fromId, toId, tx);
    // Checked again under the lock: a block, a suspension or a deleted account may have come in since the first look.
    if (!(await startable(toId, tx)) || (await blockedBetween(fromId, toId, tx))) return fail("unavailable");
    // Two first messages at once: the second one is refused, and told to accept the other's request or wait for theirs.
    const raced = await directBetween(fromId, toId, tx);
    if (raced) return fail(raced.status !== "request" ? "not_found" : raced.startedBy === fromId ? "waiting" : "accept_first");
    // Read again under the lock, which Network's connect and remove also take: a connection removed or made since the
    // first look decides the chat's kind, and so which limit it is charged to (Testing Run 5, T98).
    const status = (await areConnected(fromId, toId, tx)) ? "open" : "request";
    // Checked again under the lock: the switch may have gone off since the first look.
    if (status === "request" && !(await takesRequests(toId, tx))) return fail("unavailable");
    // A request counts toward the day's requests; between connections the first message opens the chat, so it counts
    // toward the day's direct messages instead. Taken in the transaction, so a refusal above uses neither up.
    const limit = status === "request" ? LIMITS.inboxRequestsPerUser : LIMITS.directMessagesPerUserDay;
    if (!(await takeShared(limit, fromId, { db: tx, now: now.getTime() }))) return fail("limit");
    const [conversation] = await tx.insert(conversations).values({ kind: "direct", status, startedBy: fromId, createdAt: now, lastMessageAt: now }).returning({ id: conversations.id });
    await tx.insert(conversationMembers).values([
      { conversationId: conversation.id, userId: fromId, lastReadAt: now },
      { conversationId: conversation.id, userId: toId },
    ]);
    await tx.insert(messages).values({ conversationId: conversation.id, senderId: fromId, body: text.data, createdAt: now });
    return { ok: true as const, conversationId: conversation.id };
  });
}

/**
 * The chat for an application (corporate build step 5): one per application, owned by the company, with the person who
 * applied as its one member and a first line saying the company can write here. Run inside the transaction that
 * makes the application, or later for an application that has none yet (then without the first line). Returns its id.
 */
export async function openApplicationChat(
  tx: Tx,
  app: { applicationId: string; orgId: string; userId: string },
  now: Date,
  firstLine = true,
): Promise<string> {
  const [made] = await tx
    .insert(conversations)
    .values({ kind: "application", status: "open", startedBy: app.userId, applicationId: app.applicationId, orgId: app.orgId, createdAt: now, lastMessageAt: now })
    .onConflictDoNothing({ target: conversations.applicationId })
    .returning({ id: conversations.id });
  if (!made) {
    const [existing] = await tx.select({ id: conversations.id }).from(conversations).where(eq(conversations.applicationId, app.applicationId));
    return existing!.id;
  }
  await tx.insert(conversationMembers).values({ conversationId: made.id, userId: app.userId, lastReadAt: now });
  if (firstLine) await tx.insert(messages).values({ conversationId: made.id, senderId: null, kind: "system", body: "applied", createdAt: now });
  return made.id;
}

/** An application chat's application and company, for its rules: open or closed, the company verified or not. */
async function applicationOf(conversationId: string, db: Db | Tx) {
  const [row] = await db
    .select({ closedAt: applications.closedAt, withdrawnAt: applications.withdrawnAt, orgStatus: organizations.reviewStatus })
    .from(conversations)
    .innerJoin(applications, eq(applications.id, conversations.applicationId))
    .innerJoin(organizations, eq(organizations.id, applications.orgId))
    .where(eq(conversations.id, conversationId));
  return row ?? null;
}

/** Closes an application chat for good and takes it off the candidate's Inbox: Block on a company chat. */
async function closeApplicationChat(userId: string, conversationId: string, tx: Tx, now: Date) {
  await tx.update(conversations).set({ status: "closed" }).where(eq(conversations.id, conversationId));
  await tx
    .update(conversationMembers)
    .set({ hiddenAt: now })
    .where(and(eq(conversationMembers.conversationId, conversationId), eq(conversationMembers.userId, userId)));
}

/** The person's own membership of a chat, with the chat, locked for the rest of the transaction. */
async function membership(userId: string, conversationId: string, tx: Tx) {
  const [row] = await tx
    .select({
      role: conversationMembers.role,
      hiddenAt: conversationMembers.hiddenAt,
      status: conversations.status,
      kind: conversations.kind,
      startedBy: conversations.startedBy,
      orgId: conversations.orgId,
    })
    .from(conversationMembers)
    .innerJoin(conversations, eq(conversations.id, conversationMembers.conversationId))
    .where(and(eq(conversationMembers.conversationId, conversationId), eq(conversationMembers.userId, userId)))
    .for("update", { of: conversations });
  return row ?? null;
}

/** The other people in a chat. */
const othersIn = (userId: string, conversationId: string, db: Db | Tx) =>
  db
    .select({ id: conversationMembers.userId })
    .from(conversationMembers)
    .where(and(eq(conversationMembers.conversationId, conversationId), ne(conversationMembers.userId, userId)));

/** Sends a message in a chat the person is in, under the chat's rules. */
export async function sendMessage(userId: string, conversationId: string, body: string, deps: { db?: Db; now?: Date } = {}): Promise<InboxResult<{ messageId: string }>> {
  const db = deps.db ?? getDb();
  const now = deps.now ?? new Date();
  const text = messageBody.safeParse(body);
  if (!text.success) return fail("invalid");
  return db.transaction(async (tx) => {
    const me = await membership(userId, conversationId, tx);
    if (!me) return fail("not_found");
    // The company writes in an application or found chat only from Corporate Messages, under its live role.
    if ((me.kind === "application" || me.kind === "found") && me.role !== "member") return fail("not_found");
    if (me.role === "interviewer_read_only") return fail("read_only");
    if (me.status === "closed") return fail("closed");
    if (me.status === "request") return fail(me.startedBy === userId ? "waiting" : "accept_first");
    if (me.kind === "application") {
      const app = await applicationOf(conversationId, tx);
      if (!app || chatClosed(app, me.status, now)) return fail("closed");
      if (app.orgStatus !== "verified") return fail("paused");
      if (!(await takeShared(LIMITS.applicationMessagesPerUserDay, userId, { db: tx, now: now.getTime() }))) return fail("limit");
    }
    // A found chat (pending item 19), accepted: open while the company is verified and the person hasn't blocked it.
    if (me.kind === "found") {
      if (!me.orgId || (await companyBlocked(userId, me.orgId, tx))) return fail("closed");
      const [org] = await tx.select({ status: organizations.reviewStatus }).from(organizations).where(eq(organizations.id, me.orgId));
      if (org?.status !== "verified") return fail("paused");
      if (!(await takeShared(LIMITS.applicationMessagesPerUserDay, userId, { db: tx, now: now.getTime() }))) return fail("limit");
    }
    const others = await othersIn(userId, conversationId, tx);
    // A direct chat whose other person left, or who is blocked either way, takes no more messages.
    if (me.kind === "direct") {
      const other = others[0]?.id;
      if (!other || !(await reachable(other, tx)) || (await blockedBetween(userId, other, tx))) return fail("unavailable");
      if (!(await takeShared(LIMITS.directMessagesPerUserDay, userId, { db: tx, now: now.getTime() }))) return fail("limit");
    }
    const [message] = await tx.insert(messages).values({ conversationId, senderId: userId, body: text.data, createdAt: now }).returning({ id: messages.id });
    await tx.update(conversations).set({ lastMessageAt: now }).where(eq(conversations.id, conversationId));
    // Writing in a chat reads it. A new message brings the chat back for everyone who had hidden it (after an unblock,
    // say); a deleted request never gets here, since requests take no second message.
    await tx.update(conversationMembers).set({ hiddenAt: null }).where(eq(conversationMembers.conversationId, conversationId));
    await tx
      .update(conversationMembers)
      .set({ lastReadAt: now })
      .where(and(eq(conversationMembers.conversationId, conversationId), eq(conversationMembers.userId, userId)));
    return { ok: true as const, messageId: message.id };
  });
}

/** Accepts a message request sent to the person. Both can then write freely. */
export async function acceptRequest(userId: string, conversationId: string, deps: { db?: Db; now?: Date } = {}): Promise<InboxResult> {
  const db = deps.db ?? getDb();
  const now = deps.now ?? new Date();
  return db.transaction(async (tx) => {
    const me = await membership(userId, conversationId, tx);
    // Only the person the request was sent to answers it: never a company-side row (a colleague of the sender who
    // opened the chat in Corporate Messages, or a former member), whatever the chat's kind.
    if (!me || me.role !== "member" || me.startedBy === userId || me.hiddenAt) return fail("not_found");
    // Accepted already (another tab, a double tap): fine.
    if (me.status === "open") return { ok: true as const };
    if (me.status !== "request") return fail("not_found");
    await tx.update(conversations).set({ status: "open", lastMessageAt: now }).where(eq(conversations.id, conversationId));
    await tx.insert(messages).values({ conversationId, senderId: null, kind: "system", body: "accepted", createdAt: now });
    await tx
      .update(conversationMembers)
      .set({ lastReadAt: now })
      .where(and(eq(conversationMembers.conversationId, conversationId), eq(conversationMembers.userId, userId)));
    return { ok: true as const };
  });
}

/** Deletes a message request sent to the person. The sender is not told: for them it simply stays unanswered. */
export async function deleteRequest(userId: string, conversationId: string, deps: { db?: Db; now?: Date } = {}): Promise<InboxResult> {
  const db = deps.db ?? getDb();
  const now = deps.now ?? new Date();
  return db.transaction(async (tx) => {
    const me = await membership(userId, conversationId, tx);
    // The person's own row only, as in acceptRequest: a company-side row never answers a request.
    if (!me || me.role !== "member" || me.status !== "request" || me.startedBy === userId) return fail("not_found");
    await tx
      .update(conversationMembers)
      .set({ hiddenAt: now })
      .where(and(eq(conversationMembers.conversationId, conversationId), eq(conversationMembers.userId, userId)));
    return { ok: true as const };
  });
}

/**
 * Before a block in a direct chat locks the chat row: Network's pair lock, then the chat's, in the same order as
 * Network's connect and remove (which update this row under those locks), so the two can't deadlock, and an accept at
 * the same moment can't leave the connection in place (Testing Run 5, T83, T97). The kind and the other person are read
 * unlocked here; the caller checks them again under the row lock. Returns the other person locked for, if any.
 */
async function lockDirectPair(userId: string, conversationId: string, tx: Tx): Promise<string | null> {
  const [peek] = await tx
    .select({ kind: conversations.kind })
    .from(conversationMembers)
    .innerJoin(conversations, eq(conversations.id, conversationMembers.conversationId))
    .where(and(eq(conversationMembers.conversationId, conversationId), eq(conversationMembers.userId, userId)));
  const [peekOther] = peek?.kind === "direct" ? await othersIn(userId, conversationId, tx) : [];
  if (!peekOther) return null;
  await networkPairLock(userId, peekOther.id, tx);
  await directChatLock(userId, peekOther.id, tx);
  return peekOther.id;
}

/**
 * Blocks the other side of a chat. In a direct chat: silent, they are not told, and they can no longer reach the
 * person. In an application chat (the candidate blocking the company): the chat closes for good, so nobody at the
 * company can write in it, and the application itself goes on. Either way the chat leaves the person's Inbox.
 */
export async function blockInChat(userId: string, conversationId: string, deps: { db?: Db; now?: Date } = {}): Promise<InboxResult> {
  const db = deps.db ?? getDb();
  const now = deps.now ?? new Date();
  return db.transaction(async (tx) => {
    const peekOther = await lockDirectPair(userId, conversationId, tx);
    const me = await membership(userId, conversationId, tx);
    if (me?.kind === "application" && me.role === "member") {
      await closeApplicationChat(userId, conversationId, tx, now);
      return { ok: true as const };
    }
    // A company that found the person (pending item 19): the whole company is blocked, and the chat closes for good.
    if (me?.kind === "found" && me.role === "member" && me.orgId) {
      await blockCompanyIn(tx, userId, me.orgId, now);
      return { ok: true as const };
    }
    if (!me || me.kind !== "direct") return fail("not_found");
    const [other] = await othersIn(userId, conversationId, tx);
    // Never block someone the locks weren't taken for (a member who joined after the peek, which a direct chat can't have).
    if (other && other.id !== peekOther) return fail("not_found");
    if (other) {
      await tx.insert(blocks).values({ blockerId: userId, blockedId: other.id, createdAt: now }).onConflictDoNothing();
      // A block ends any Network connection or request between the two at once (FR-49).
      await dropBetween(tx, userId, other.id, now);
    }
    await tx
      .update(conversationMembers)
      .set({ hiddenAt: now })
      .where(and(eq(conversationMembers.conversationId, conversationId), eq(conversationMembers.userId, userId)));
    return { ok: true as const };
  });
}

/**
 * End chat (FR-52): the person ends an accepted found chat themselves, with no report and no block. Only this chat
 * closes for good, for both sides, the way a block closes it, and it stays in the person's Inbox as closed. The company
 * is not blocked: it can still message about the person's applications, but this chat takes no more messages and, being
 * closed, no new request from that company can start (sendFoundRequest refuses a closed chat). A request is answered
 * with Delete instead. The chat row is locked through the membership read, as blockInChat locks it for a found chat.
 */
export async function endFoundChat(userId: string, conversationId: string, deps: { db?: Db; now?: Date } = {}): Promise<InboxResult> {
  const db = deps.db ?? getDb();
  return db.transaction(async (tx) => {
    const me = await membership(userId, conversationId, tx);
    // The person's own row of a found chat only: never a company-side row, a direct or an application chat.
    if (!me || me.kind !== "found" || me.role !== "member" || me.hiddenAt) return fail("not_found");
    // Ended already (another tab, a double tap, or a block): fine.
    if (me.status === "closed") return { ok: true as const };
    if (me.status !== "open") return fail("not_found");
    await tx.update(conversations).set({ status: "closed" }).where(eq(conversations.id, conversationId));
    return { ok: true as const };
  });
}

/** Lifts a block. Chats the block hid stay hidden until a new message arrives in them. */
export async function unblock(blockerId: string, blockedId: string, db: Db = getDb()): Promise<void> {
  await db.delete(blocks).where(and(eq(blocks.blockerId, blockerId), eq(blocks.blockedId, blockedId)));
}

/**
 * Reports a message, the other person or the whole chat, for the grievance queue (deadlines in reportDeadlines). Only
 * a member can report, and only a message in that chat written by someone else. Logged by reason and target only.
 */
export async function report(userId: string, input: ReportInput, deps: { db?: Db; now?: Date } = {}): Promise<InboxResult<{ reportId: string }>> {
  const db = deps.db ?? getDb();
  const now = deps.now ?? new Date();
  const parsed = reportInput.safeParse(input);
  if (!parsed.success) return fail("not_found");
  const r = parsed.data;
  // Each report starts legal deadlines, so one person can't flood the queue.
  if (!(await takeShared(LIMITS.inboxReportsPerUser, userId, { db, now: now.getTime() }))) return fail("limit");
  const result = await db.transaction(async (tx) => {
    // With block on, a direct chat takes the pair locks before the row lock, as blockInChat does (T97).
    const peekOther = r.block ? await lockDirectPair(userId, r.conversationId, tx) : null;
    const me = await membership(userId, r.conversationId, tx);
    if (!me) return fail("not_found");
    // An application or found chat is reported by the candidate, about the company: the chat or one of its messages.
    const application = me.kind === "application" || me.kind === "found";
    if (application && (me.role !== "member" || r.target === "person")) return fail("not_found");
    const [other] = await othersIn(userId, r.conversationId, tx);
    // Never block someone the locks weren't taken for, as in blockInChat; refused before the report is written.
    if (r.block && me.kind === "direct" && other && other.id !== peekOther) return fail("not_found");
    let targetId = r.conversationId;
    if (r.target === "message") {
      const [message] = await tx
        .select({ senderId: messages.senderId, kind: messages.kind })
        .from(messages)
        .where(and(eq(messages.id, r.messageId!), eq(messages.conversationId, r.conversationId)));
      // A company message whose writer's account has gone stays the company's, so it can still be reported.
      const fromSomeoneElse = message && message.kind !== "system" && message.senderId !== userId && (message.senderId !== null || application);
      if (!fromSomeoneElse) return fail("not_found");
      targetId = r.messageId!;
    } else if (r.target === "person") {
      if (!other) return fail("not_found");
      targetId = other.id;
    }
    const [row] = await tx
      .insert(reports)
      .values({ reporterId: userId, target: r.target, targetId, reason: r.reason, note: r.note || null, createdAt: now })
      .returning({ id: reports.id });
    if (r.block && me.kind === "application") await closeApplicationChat(userId, r.conversationId, tx, now);
    if (r.block && me.kind === "found" && me.orgId) await blockCompanyIn(tx, userId, me.orgId, now);
    if (r.block && me.kind === "direct") {
      if (other) {
        await tx.insert(blocks).values({ blockerId: userId, blockedId: other.id, createdAt: now }).onConflictDoNothing();
        await dropBetween(tx, userId, other.id, now);
      }
      await tx
        .update(conversationMembers)
        .set({ hiddenAt: now })
        .where(and(eq(conversationMembers.conversationId, r.conversationId), eq(conversationMembers.userId, userId)));
    }
    return { ok: true as const, reportId: row.id };
  });
  if (result.ok) logEvent("info", "inbox_report", { target: r.target, reason: r.reason, status: "open" });
  return result;
}

/** Marks a chat read up to now. */
export async function markRead(userId: string, conversationId: string, deps: { db?: Db; now?: Date } = {}): Promise<void> {
  const db = deps.db ?? getDb();
  await db
    .update(conversationMembers)
    .set({ lastReadAt: deps.now ?? new Date() })
    .where(and(eq(conversationMembers.conversationId, conversationId), eq(conversationMembers.userId, userId)));
}

/**
 * The person's chats that show in the Inbox: not deleted by them, and not with someone they blocked. A message request
 * sent to them counts as a chat to show but is not yet a "person" chat.
 */
async function visibleChats(userId: string, db: Db) {
  return db
    .select({
      id: conversations.id,
      kind: conversations.kind,
      status: conversations.status,
      startedBy: conversations.startedBy,
      lastMessageAt: conversations.lastMessageAt,
      lastReadAt: conversationMembers.lastReadAt,
    })
    .from(conversationMembers)
    .innerJoin(conversations, eq(conversations.id, conversationMembers.conversationId))
    .where(
      and(
        eq(conversationMembers.userId, userId),
        // A recruiter's company-side rows belong to Corporate Messages, never their personal Inbox.
        eq(conversationMembers.role, "member"),
        isNull(conversationMembers.hiddenAt),
        sql`not exists (select 1 from ${conversationMembers} o join ${blocks} b on b.blocked_id = o.user_id
              where o.conversation_id = ${conversations.id} and o.user_id <> ${userId} and b.blocker_id = ${userId})`,
      ),
    )
    .orderBy(desc(conversations.lastMessageAt));
}

/**
 * How many chats have something new for the person: a request waiting for them, or a message from someone else since
 * they last read the chat. The badge on the top bar.
 */
export async function unreadChats(userId: string, db: Db = getDb()): Promise<number> {
  const [row] = await db.execute<{ n: number }>(sql`
    select count(*)::int as n
    from ${conversationMembers} m join ${conversations} c on c.id = m.conversation_id
    where m.user_id = ${userId} and m.role = 'member' and m.hidden_at is null
      and not exists (select 1 from ${conversationMembers} o join ${blocks} b on b.blocked_id = o.user_id
                      where o.conversation_id = c.id and o.user_id <> ${userId} and b.blocker_id = ${userId})
      and ((c.status = 'request' and c.started_by is distinct from ${userId})
           or exists (select 1 from ${messages} x where x.conversation_id = c.id and x.sender_id is distinct from ${userId}
                      and x.kind <> 'system' and x.created_at > coalesce(m.last_read_at, '-infinity'::timestamptz)))`);
  return row?.n ?? 0;
}

const IST = "Asia/Kolkata";
const WEEK = 7 * 86_400_000;

/** "Thu 11:02" within the last week, "7 Oct" before that, in India time. */
export function formatAt(at: Date, now: Date): string {
  if (now.getTime() - at.getTime() < WEEK) {
    const day = at.toLocaleDateString("en-IN", { weekday: "short", timeZone: IST });
    const time = at.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: IST });
    return `${day} ${time}`;
  }
  return at.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: IST });
}

/** The person's Inbox: their chats, newest first, each with up to MESSAGES_PER_CHAT recent messages. */
export async function listThreads(userId: string, deps: { db?: Db; now?: Date } = {}): Promise<InboxThread[]> {
  const db = deps.db ?? getDb();
  const now = deps.now ?? new Date();
  const chats = await visibleChats(userId, db);
  if (!chats.length) return [];
  const ids = chats.map((c) => c.id);
  const appIds = chats.filter((c) => c.kind === "application").map((c) => c.id);
  const foundIds = chats.filter((c) => c.kind === "found").map((c) => c.id);
  const [others, rows, apps, founds] = await Promise.all([
    db
      .select({ conversationId: conversationMembers.conversationId, name: users.name, deleted: users.deletionRequestedAt })
      .from(conversationMembers)
      .innerJoin(users, eq(users.id, conversationMembers.userId))
      .where(and(inArray(conversationMembers.conversationId, ids), ne(conversationMembers.userId, userId))),
    db
      .select({
        id: messages.id,
        conversationId: messages.conversationId,
        senderId: messages.senderId,
        senderName: users.name,
        senderDeleted: users.deletionRequestedAt,
        kind: messages.kind,
        // A hidden message's text never leaves the database (FR-46): the notice comes back in its place.
        body: shownBody(),
        hidden: isHidden(),
        payload: messages.payload,
        createdAt: messages.createdAt,
      })
      .from(messages)
      .leftJoin(users, eq(users.id, messages.senderId))
      .where(
        and(
          inArray(messages.conversationId, ids),
          sql`${messages.id} in (select id from (select id, row_number() over (partition by conversation_id order by created_at desc) as rn
               from ${messages} where conversation_id in ${ids}) recent where rn <= ${MESSAGES_PER_CHAT})`,
        ),
      )
      .orderBy(asc(messages.createdAt)),
    // Application chats: the company, its state now, the job, and whether the application still takes messages.
    appIds.length
      ? db
          .select({
            conversationId: conversations.id,
            company: organizations.name,
            orgStatus: organizations.reviewStatus,
            job: jobs.title,
            closedAt: applications.closedAt,
            withdrawnAt: applications.withdrawnAt,
          })
          .from(conversations)
          .innerJoin(applications, eq(applications.id, conversations.applicationId))
          .innerJoin(jobs, eq(jobs.id, applications.jobId))
          .innerJoin(organizations, eq(organizations.id, applications.orgId))
          .where(inArray(conversations.id, appIds))
      : Promise.resolve([]),
    // Found chats (pending item 19): the company, its state now and the job it searched from.
    foundIds.length
      ? db
          .select({ conversationId: conversations.id, company: organizations.name, orgStatus: organizations.reviewStatus, job: jobs.title })
          .from(conversations)
          .innerJoin(organizations, eq(organizations.id, conversations.orgId))
          .leftJoin(jobs, eq(jobs.id, conversations.jobId))
          .where(inArray(conversations.id, foundIds))
      : Promise.resolve([]),
  ]);
  // Accepted found chats go on while job search is off, with a line saying so (FR-52); read only when there are any.
  const searchOff = foundIds.length ? !(await jobSearchOn(userId, db)) : false;
  // "Ask for times" cards (corporate build step 6): the times already offered in answer to each.
  const askIds = rows.filter((m) => m.kind === "ask_times").map((m) => m.id);
  const offered = askIds.length
    ? await db
        .select({ askMessageId: candidateSlots.askMessageId, startsAt: candidateSlots.startsAt })
        .from(candidateSlots)
        .where(inArray(candidateSlots.askMessageId, askIds))
        .orderBy(asc(candidateSlots.startsAt))
    : [];

  return chats.flatMap((c): InboxThread[] => {
    const mine = rows.filter((m) => m.conversationId === c.id);
    const unread = mine.some((m) => m.kind !== "system" && m.senderId !== userId && m.createdAt > (c.lastReadAt ?? new Date(0)));

    if (c.kind === "application") {
      const app = apps.find((a) => a.conversationId === c.id);
      if (!app) return [];
      const verified = app.orgStatus === "verified";
      const closed = chatClosed(app, c.status, now);
      const list: InboxMessage[] = mine.map((m) => {
        if (m.kind === "system") return { id: m.id, by: "system", text: m.body === "applied" ? `You applied on CareerMetro. ${app.company} can message you here about this application.` : "" };
        if (m.senderId === userId) return { id: m.id, by: "me", text: m.body, at: formatAt(m.createdAt, now) };
        // A message stays the company's when its writer's account goes: it is then from the company team.
        const who = m.senderId && !m.senderDeleted ? displayName(m.senderName) : COMPANY_TEAM;
        // A hidden card is the notice only: no times to pick, no question to answer.
        if (m.hidden) return { id: m.id, by: "them", who, text: m.body, at: formatAt(m.createdAt, now) };
        if (m.kind === "ask_times") {
          const days = askDaysOf(m.payload);
          const given = offered.filter((o) => o.askMessageId === m.id).map((o) => slotLabel(o.startsAt));
          const keys = days.flatMap((d) => SLOT_TIMES.map((t) => `${d}T${t}`));
          const unavailable = keys.filter((k) => !slotOpen(slotStart(k) ?? new Date(0), now));
          // Answered, its offered times since deleted by the daily clean-up (corporate build step 7).
          const passed = !given.length && askAnswered(m.payload);
          const open = !given.length && !passed && !closed && verified && !app.closedAt && unavailable.length < keys.length;
          const ask = {
            messageId: m.id,
            days: days.map((day) => ({ day, label: dayParts(day) })),
            times: [...SLOT_TIMES],
            unavailable,
            offered: given.length ? given : null,
            open,
            ...(passed ? { passed } : {}),
          };
          return { id: m.id, by: "them", who, type: "times" as const, text: m.body, at: formatAt(m.createdAt, now), ask };
        }
        return { id: m.id, by: "them", who, ...(m.kind === "ask_question" ? { type: "question" as const } : {}), text: m.body, at: formatAt(m.createdAt, now) };
      });
      return [
        {
          id: c.id,
          kind: "application",
          name: app.company,
          job: app.job,
          verified,
          unread,
          messages: list.filter((m) => m.text),
          state: closed ? "closed" : verified ? undefined : "paused",
        },
      ];
    }

    if (c.kind === "found") {
      const f = founds.find((x) => x.conversationId === c.id);
      if (!f) return [];
      const verified = f.orgStatus === "verified";
      const requestToMe = c.status === "request";
      const list: InboxMessage[] = mine.map((m) => {
        if (m.kind === "system") return { id: m.id, by: "system", text: m.body === "accepted" ? `You accepted. ${f.company} can message you here.` : "" };
        if (m.senderId === userId) return { id: m.id, by: "me", text: m.body, at: formatAt(m.createdAt, now) };
        const who = m.senderId && !m.senderDeleted ? displayName(m.senderName) : COMPANY_TEAM;
        return { id: m.id, by: "them", who, text: m.body, at: formatAt(m.createdAt, now) };
      });
      return [
        {
          id: c.id,
          kind: requestToMe ? "request" : "application",
          found: true,
          name: f.company,
          job: f.job ?? "A job that has closed",
          verified,
          unread: requestToMe || unread,
          messages: list.filter((m) => m.text),
          state: c.status === "closed" ? "closed" : !requestToMe && !verified ? "paused" : undefined,
          ...(searchOff && c.status === "open" ? { jobSearchOff: true } : {}),
        },
      ];
    }

    const other = others.find((o) => o.conversationId === c.id);
    const left = !other || !!other.deleted;
    const requestToMe = c.status === "request" && c.startedBy !== userId;
    const list: InboxMessage[] = mine.map((m) =>
      m.kind === "system"
        ? { id: m.id, by: "system", text: m.body === "accepted" ? "Request accepted. You can now message each other." : "" }
        : { id: m.id, by: m.senderId === userId ? "me" : "them", text: m.body, at: formatAt(m.createdAt, now) },
    );
    if (left) list.push({ by: "system", text: "This person has left CareerMetro." });
    return [
      {
        id: c.id,
        kind: requestToMe ? "request" : "person",
        name: left ? "Former member" : displayName(other.name),
        unread: requestToMe || unread,
        messages: list.filter((m) => m.text),
        state: left ? "left" : c.status === "closed" ? "closed" : c.status === "request" && !requestToMe ? "waiting" : undefined,
      },
    ];
  });
}

/** Who wrote a company message whose writer's account has gone (the plan keeps such messages as the company's). */
export const COMPANY_TEAM = "The company team";

/** For "Download your data": the person's chats (their own messages only), blocks they made and reports they filed. */
export async function exportInbox(userId: string, db: Db = getDb()) {
  const chats = await db
    .select({
      id: conversations.id,
      kind: conversations.kind,
      status: conversations.status,
      startedBy: conversations.startedBy,
      createdAt: conversations.createdAt,
      hiddenAt: conversationMembers.hiddenAt,
      role: conversationMembers.role,
      // Application chats name the company and the job; never the candidate, for someone on the company's side.
      company: organizations.name,
      job: jobs.title,
    })
    .from(conversationMembers)
    .innerJoin(conversations, eq(conversations.id, conversationMembers.conversationId))
    .leftJoin(applications, eq(applications.id, conversations.applicationId))
    .leftJoin(jobs, sql`${jobs.id} = coalesce(${applications.jobId}, ${conversations.jobId})`)
    .leftJoin(organizations, eq(organizations.id, conversations.orgId))
    .where(eq(conversationMembers.userId, userId))
    .orderBy(asc(conversations.createdAt));
  const ids = chats.map((c) => c.id);
  const [own, blockRows, reportRows] = await Promise.all([
    ids.length
      ? db
          .select({ conversationId: messages.conversationId, body: messages.body, createdAt: messages.createdAt })
          .from(messages)
          .where(and(inArray(messages.conversationId, ids), eq(messages.senderId, userId)))
          .orderBy(asc(messages.createdAt))
      : Promise.resolve([]),
    db.select({ createdAt: blocks.createdAt }).from(blocks).where(eq(blocks.blockerId, userId)).orderBy(asc(blocks.createdAt)),
    db
      .select({ target: reports.target, reason: reports.reason, note: reports.note, status: reports.status, createdAt: reports.createdAt, resolvedAt: reports.resolvedAt })
      .from(reports)
      .where(eq(reports.reporterId, userId))
      .orderBy(asc(reports.createdAt)),
  ]);
  return {
    // Other people's messages are theirs, so only the person's own are included.
    chats: chats.map((c) => ({
      kind: c.kind,
      // Application chats: "candidate" when you applied, "company" when you wrote for the company.
      side: c.kind === "application" || c.kind === "found" ? (c.role === "member" ? "candidate" : "company") : null,
      company: c.company,
      job: c.job,
      status: c.status,
      startedByYou: c.startedBy === userId,
      createdAt: c.createdAt,
      deletedByYouAt: c.hiddenAt,
      yourMessages: own.filter((m) => m.conversationId === c.id).map(({ body, createdAt }) => ({ body, createdAt })),
    })),
    blocksMade: blockRows,
    reportsMade: reportRows,
  };
}

/**
 * Run inside the account purge, before the user row goes: messages the person wrote for a company in its application
 * chats stay, from "the company team" (sender emptied), so nothing is lost when someone leaves. Their messages
 * anywhere else, their own applications' chats included, go with the account as before.
 */
export async function keepCompanyMessages(tx: Tx | Db, userId: string): Promise<void> {
  await tx.execute(sql`update ${messages} m set sender_id = null
    from ${conversations} c join ${applications} a on a.id = c.application_id
    where m.conversation_id = c.id and m.sender_id = ${userId} and a.user_id <> ${userId}`);
}

/**
 * Run inside the account purge, after the user row is gone: removes chats nobody is left in, and message requests whose
 * sender left (their one message went with them, so nothing is left to accept).
 */
export async function removeEmptyChats(tx: Tx | Db): Promise<void> {
  await tx.execute(sql`delete from ${conversations} c where not exists (select 1 from ${conversationMembers} m where m.conversation_id = c.id)`);
  await tx.execute(sql`delete from ${conversations} c where c.kind = 'direct' and c.status = 'request' and c.started_by is null`);
}
