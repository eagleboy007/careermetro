import "server-only";
import { and, asc, desc, eq, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { blocks, conversationMembers, conversations, messages, reports, users } from "@/db/schema";
import { displayName } from "@/lib/account/name";
import { logEvent } from "@/lib/log";
import { messageBody, reportInput, type ReportInput } from "@/lib/schemas/inbox";
import { LIMITS, takeShared } from "@/lib/shared-limit";
import type { InboxMessage, InboxThread } from "./types";

/*
 * The Inbox's rules (dev/inbox-plan.md, approved by Milin 2026-10-11). Every function takes the signed-in person's id
 * and checks membership itself, so a caller can't read or write a chat it isn't in. Message text is never logged.
 */

type Db = ReturnType<typeof getDb>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export type InboxError = "not_found" | "unavailable" | "waiting" | "accept_first" | "read_only" | "closed" | "limit" | "self" | "invalid";

/** What each refusal tells the person. "unavailable" is deliberately vague: a block is never revealed. */
export const INBOX_ERROR_TEXT: Record<InboxError, string> = {
  not_found: "That chat isn't available.",
  unavailable: "You can't message this person.",
  waiting: "They haven't accepted your request yet. You can send more once they do.",
  accept_first: "Accept the request to reply.",
  read_only: "You can read this chat but not send in it.",
  closed: "This chat is closed.",
  limit: "You've sent a lot of new requests today. Try again tomorrow.",
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

const pairLock = (a: string, b: string, tx: Tx) => tx.execute(sql`select pg_advisory_xact_lock(hashtext(${["inbox", ...[a, b].sort()].join("|")}))`);

/**
 * Starts a direct chat. With someone who isn't a connection (everyone, until Network exists) it is a request: this one
 * message, then nothing more until they accept. A chat that already exists gets the message instead, under its rules.
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
  // Counted before the write, outside the transaction: the limit is shared by every server and lives in the database.
  if (!(await takeShared(LIMITS.inboxRequestsPerUser, fromId, { db, now: now.getTime() }))) return fail("limit");
  return db.transaction(async (tx) => {
    await pairLock(fromId, toId, tx);
    // Two first messages at once: the second becomes a message in the first one's chat.
    const raced = await directBetween(fromId, toId, tx);
    if (raced) return { ok: false as const, error: raced.startedBy === fromId && raced.status === "request" ? ("waiting" as const) : ("not_found" as const) };
    const [conversation] = await tx.insert(conversations).values({ kind: "direct", status: "request", startedBy: fromId, createdAt: now, lastMessageAt: now }).returning({ id: conversations.id });
    await tx.insert(conversationMembers).values([
      { conversationId: conversation.id, userId: fromId, lastReadAt: now },
      { conversationId: conversation.id, userId: toId },
    ]);
    await tx.insert(messages).values({ conversationId: conversation.id, senderId: fromId, body: text.data, createdAt: now });
    return { ok: true as const, conversationId: conversation.id };
  });
}

/** The person's own membership of a chat, with the chat, locked for the rest of the transaction. */
async function membership(userId: string, conversationId: string, tx: Tx) {
  const [row] = await tx
    .select({ role: conversationMembers.role, hiddenAt: conversationMembers.hiddenAt, status: conversations.status, kind: conversations.kind, startedBy: conversations.startedBy })
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
    if (me.role === "interviewer_read_only") return fail("read_only");
    if (me.status === "closed") return fail("closed");
    if (me.status === "request") return fail(me.startedBy === userId ? "waiting" : "accept_first");
    const others = await othersIn(userId, conversationId, tx);
    // A direct chat whose other person left, or who is blocked either way, takes no more messages.
    if (me.kind === "direct") {
      const other = others[0]?.id;
      if (!other || !(await reachable(other, tx)) || (await blockedBetween(userId, other, tx))) return fail("unavailable");
    }
    const [message] = await tx.insert(messages).values({ conversationId, senderId: userId, body: text.data, createdAt: now }).returning({ id: messages.id });
    await tx.update(conversations).set({ lastMessageAt: now }).where(eq(conversations.id, conversationId));
    // Writing in a chat reads it, and brings back one the person had deleted.
    await tx
      .update(conversationMembers)
      .set({ lastReadAt: now, hiddenAt: null })
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
    if (!me || me.status !== "request" || me.startedBy === userId || me.hiddenAt) return fail("not_found");
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
    if (!me || me.status !== "request" || me.startedBy === userId) return fail("not_found");
    await tx
      .update(conversationMembers)
      .set({ hiddenAt: now })
      .where(and(eq(conversationMembers.conversationId, conversationId), eq(conversationMembers.userId, userId)));
    return { ok: true as const };
  });
}

/**
 * Blocks the other person in a direct chat. Silent: they are not told, and they can no longer reach the person. The
 * chat leaves the person's Inbox. Application chats are with a company, so they are reported, not blocked.
 */
export async function blockInChat(userId: string, conversationId: string, deps: { db?: Db; now?: Date } = {}): Promise<InboxResult> {
  const db = deps.db ?? getDb();
  const now = deps.now ?? new Date();
  return db.transaction(async (tx) => {
    const me = await membership(userId, conversationId, tx);
    if (!me || me.kind !== "direct") return fail("not_found");
    const [other] = await othersIn(userId, conversationId, tx);
    if (other) await tx.insert(blocks).values({ blockerId: userId, blockedId: other.id, createdAt: now }).onConflictDoNothing();
    await tx
      .update(conversationMembers)
      .set({ hiddenAt: now })
      .where(and(eq(conversationMembers.conversationId, conversationId), eq(conversationMembers.userId, userId)));
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
  const result = await db.transaction(async (tx) => {
    const me = await membership(userId, r.conversationId, tx);
    if (!me) return fail("not_found");
    const [other] = await othersIn(userId, r.conversationId, tx);
    let targetId = r.conversationId;
    if (r.target === "message") {
      const [message] = await tx
        .select({ senderId: messages.senderId })
        .from(messages)
        .where(and(eq(messages.id, r.messageId!), eq(messages.conversationId, r.conversationId)));
      if (!message || !message.senderId || message.senderId === userId) return fail("not_found");
      targetId = r.messageId!;
    } else if (r.target === "person") {
      if (!other) return fail("not_found");
      targetId = other.id;
    }
    const [row] = await tx
      .insert(reports)
      .values({ reporterId: userId, target: r.target, targetId, reason: r.reason, note: r.note || null, createdAt: now })
      .returning({ id: reports.id });
    if (r.block && me.kind === "direct") {
      if (other) await tx.insert(blocks).values({ blockerId: userId, blockedId: other.id, createdAt: now }).onConflictDoNothing();
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
    where m.user_id = ${userId} and m.hidden_at is null
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
  const [others, rows] = await Promise.all([
    db
      .select({ conversationId: conversationMembers.conversationId, name: users.name, deleted: users.deletionRequestedAt })
      .from(conversationMembers)
      .innerJoin(users, eq(users.id, conversationMembers.userId))
      .where(and(inArray(conversationMembers.conversationId, ids), ne(conversationMembers.userId, userId))),
    db
      .select({ id: messages.id, conversationId: messages.conversationId, senderId: messages.senderId, kind: messages.kind, body: messages.body, createdAt: messages.createdAt })
      .from(messages)
      .where(
        and(
          inArray(messages.conversationId, ids),
          sql`${messages.id} in (select id from (select id, row_number() over (partition by conversation_id order by created_at desc) as rn
               from ${messages} where conversation_id in ${ids}) recent where rn <= ${MESSAGES_PER_CHAT})`,
        ),
      )
      .orderBy(asc(messages.createdAt)),
  ]);

  return chats.map((c): InboxThread => {
    const other = others.find((o) => o.conversationId === c.id);
    const left = !other || !!other.deleted;
    const requestToMe = c.status === "request" && c.startedBy !== userId;
    const mine = rows.filter((m) => m.conversationId === c.id);
    const list: InboxMessage[] = mine.map((m) =>
      m.kind === "system"
        ? { id: m.id, by: "system", text: m.body === "accepted" ? "Request accepted. You can now message each other." : "" }
        : { id: m.id, by: m.senderId === userId ? "me" : "them", text: m.body, at: formatAt(m.createdAt, now) },
    );
    if (left) list.push({ by: "system", text: "This person has left CareerMetro." });
    const unread =
      requestToMe ||
      mine.some((m) => m.kind !== "system" && m.senderId !== userId && m.createdAt > (c.lastReadAt ?? new Date(0)));
    return {
      id: c.id,
      kind: c.kind === "application" ? "application" : requestToMe ? "request" : "person",
      name: left ? "Former member" : displayName(other.name),
      unread,
      messages: list.filter((m) => m.text),
      state: left ? "left" : c.status === "closed" ? "closed" : c.status === "request" && !requestToMe ? "waiting" : undefined,
    };
  });
}

/** For "Download your data": the person's chats (their own messages only), blocks they made and reports they filed. */
export async function exportInbox(userId: string, db: Db = getDb()) {
  const chats = await db
    .select({ id: conversations.id, kind: conversations.kind, status: conversations.status, startedBy: conversations.startedBy, createdAt: conversations.createdAt, hiddenAt: conversationMembers.hiddenAt })
    .from(conversationMembers)
    .innerJoin(conversations, eq(conversations.id, conversationMembers.conversationId))
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

/** Run inside the account purge, after the user row is gone: removes chats nobody is left in. */
export async function removeEmptyChats(tx: Tx | Db): Promise<void> {
  await tx.execute(sql`delete from ${conversations} c where not exists (select 1 from ${conversationMembers} m where m.conversation_id = c.id)`);
}
