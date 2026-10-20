import { eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, describe, expect, it, vi } from "vitest";
import * as schema from "@/db/schema";
import { reportDeadlines } from "@/lib/schemas/inbox";
import { LIMITS, takeShared } from "@/lib/shared-limit";
import { exportAccountData } from "@/lib/account/export";
import { purgeDeletedAccounts } from "@/lib/account/delete";
import { acceptRequest, blockInChat, deleteRequest, formatAt, INBOX_ERROR_TEXT, listThreads, markRead, report, sendMessage, startDirect, unblock, unreadChats } from "./store";

// Runs against a real Postgres with migrations applied, like the other store tests.
const url = process.env.TEST_DATABASE_URL;
const sqlClient = url ? postgres(url, { max: 4, onnotice: () => {} }) : null;
const db = sqlClient ? drizzle(sqlClient, { schema }) : null;

describe.skipIf(!db)("inbox store (database)", () => {
  const run = `inbox-${Date.now()}`;
  const userIds: string[] = [];
  let n = 0;
  const deps = () => ({ db: db! });

  async function person(name = "Asha Rao") {
    const [u] = await db!.insert(schema.users).values({ email: `${run}-${n}@example.com`, authSubject: `${run}-${n++}`, name }).returning({ id: schema.users.id });
    userIds.push(u.id);
    return u.id;
  }

  async function openChat() {
    const a = await person("Asha Rao");
    const b = await person("Vikram Singh");
    const started = await startDirect(a, b, "Hi Vikram, could I ask about your SIEM switch?", deps());
    if (!started.ok) throw new Error(started.error);
    expect((await acceptRequest(b, started.conversationId, deps())).ok).toBe(true);
    return { a, b, id: started.conversationId };
  }

  afterAll(async () => {
    if (userIds.length) await db!.delete(schema.users).where(inArray(schema.users.id, userIds));
    await sqlClient!.end();
  });

  it("lets a request carry one message until it is accepted", async () => {
    const a = await person("Asha Rao");
    const b = await person("Vikram Singh");
    const started = await startDirect(a, b, "  Hello  ", deps());
    expect(started.ok).toBe(true);
    const id = started.ok ? started.conversationId : "";
    // The sender can't add more, through either door; the receiver must accept before replying.
    expect(await sendMessage(a, id, "Another", deps())).toEqual({ ok: false, error: "waiting" });
    expect(await startDirect(a, b, "Again", deps())).toEqual({ ok: false, error: "waiting" });
    expect(await sendMessage(b, id, "Reply", deps())).toEqual({ ok: false, error: "accept_first" });
    // The sender can't accept their own request.
    expect((await acceptRequest(a, id, deps())).ok).toBe(false);

    const [theirs] = await listThreads(b, deps());
    expect(theirs).toMatchObject({ id, kind: "request", name: "Asha Rao", unread: true });
    const [mine] = await listThreads(a, deps());
    expect(mine).toMatchObject({ id, kind: "person", name: "Vikram Singh", state: "waiting", unread: false });

    expect((await acceptRequest(b, id, deps())).ok).toBe(true);
    expect((await sendMessage(b, id, "Sure, ask away", deps())).ok).toBe(true);
    expect((await sendMessage(a, id, "Thanks!", deps())).ok).toBe(true);
    const [after] = await listThreads(a, deps());
    expect(after.kind).toBe("person");
    expect(after.state).toBeUndefined();
    expect(after.messages.map((m) => [m.by, m.text])).toEqual([
      ["me", "Hello"],
      ["system", "Request accepted. You can now message each other."],
      ["them", "Sure, ask away"],
      ["me", "Thanks!"],
    ]);
  });

  it("keeps chats to their members", async () => {
    const { id } = await openChat();
    const stranger = await person("Nisha Patel");
    expect(await sendMessage(stranger, id, "Let me in", deps())).toEqual({ ok: false, error: "not_found" });
    expect(await listThreads(stranger, deps())).toEqual([]);
    expect(await acceptRequest(stranger, id, deps())).toEqual({ ok: false, error: "not_found" });
    expect(await report(stranger, { conversationId: id, target: "chat", reason: "other" }, deps())).toEqual({ ok: false, error: "not_found" });
    expect(await startDirect(stranger, stranger, "Me", deps())).toEqual({ ok: false, error: "self" });
    expect(await sendMessage(stranger, id, "   ", deps())).toEqual({ ok: false, error: "invalid" });
  });

  it("lets an interviewer read but not send", async () => {
    const { id } = await openChat();
    const interviewer = await person("Rohan Desai");
    await db!.insert(schema.conversationMembers).values({ conversationId: id, userId: interviewer, role: "interviewer_read_only" });
    expect(await sendMessage(interviewer, id, "Hello", deps())).toEqual({ ok: false, error: "read_only" });
  });

  it("blocks silently: the blocked person can't reach the blocker, and the chat leaves the blocker's Inbox", async () => {
    const { a, b, id } = await openChat();
    expect((await blockInChat(a, id, deps())).ok).toBe(true);
    expect(await sendMessage(b, id, "Hello?", deps())).toEqual({ ok: false, error: "unavailable" });
    expect(await startDirect(b, a, "New chat", deps())).toEqual({ ok: false, error: "unavailable" });
    expect(await listThreads(a, deps())).toEqual([]);
    // The blocked side still sees the chat as it was; nothing tells them.
    expect((await listThreads(b, deps()))[0]).toMatchObject({ id, kind: "person", state: undefined });
    await unblock(a, b, db!);
    expect((await sendMessage(b, id, "Hello again", deps())).ok).toBe(true);
    // A new message after the unblock brings the chat back for the person who had blocked.
    expect((await listThreads(a, deps()))[0]).toMatchObject({ id, unread: true });
  });

  it("deletes a request without telling the sender", async () => {
    const a = await person();
    const b = await person();
    const started = await startDirect(a, b, "Hi", deps());
    const id = started.ok ? started.conversationId : "";
    expect((await deleteRequest(a, id, deps())).ok).toBe(false);
    expect((await deleteRequest(b, id, deps())).ok).toBe(true);
    expect(await listThreads(b, deps())).toEqual([]);
    expect(await unreadChats(b, db!)).toBe(0);
    expect((await listThreads(a, deps()))[0]).toMatchObject({ id, state: "waiting" });
    expect((await acceptRequest(b, id, deps())).ok).toBe(false);
  });

  it("accepts once, and a second accept is fine", async () => {
    const { b, id } = await openChat();
    expect(await acceptRequest(b, id, deps())).toEqual({ ok: true });
    expect((await db!.select().from(schema.messages).where(eq(schema.messages.conversationId, id))).filter((m) => m.kind === "system")).toHaveLength(1);
  });

  it("drops a pending request when its sender's account is removed for good", async () => {
    const a = await person();
    const b = await person();
    const started = await startDirect(a, b, "Hi", deps());
    expect(await unreadChats(b, db!)).toBe(1);
    await db!.update(schema.users).set({ deletionRequestedAt: new Date(Date.now() - 31 * 86_400_000) }).where(eq(schema.users.id, a));
    await purgeDeletedAccounts(db!);
    expect(await unreadChats(b, db!)).toBe(0);
    expect(await listThreads(b, deps())).toEqual([]);
    expect(await db!.select().from(schema.conversations).where(eq(schema.conversations.id, started.ok ? started.conversationId : ""))).toEqual([]);
  });

  it("counts unread chats and clears them on reading", async () => {
    const { a, b, id } = await openChat();
    expect(await unreadChats(a, db!)).toBe(0);
    await sendMessage(b, id, "One", deps());
    await sendMessage(b, id, "Two", deps());
    expect(await unreadChats(a, db!)).toBe(1);
    expect((await listThreads(a, deps()))[0].unread).toBe(true);
    await markRead(a, id, { db: db!, now: new Date(Date.now() + 1000) });
    expect(await unreadChats(a, db!)).toBe(0);
    expect(await unreadChats(b, db!)).toBe(0);
  });

  it("limits new requests per person per day", async () => {
    const a = await person();
    const now = new Date();
    await db!
      .insert(schema.rateLimits)
      .values({ bucket: LIMITS.inboxRequestsPerUser.bucket, keyHash: "placeholder", windowStart: now })
      .onConflictDoNothing();
    for (let i = 0; i < LIMITS.inboxRequestsPerUser.max; i++) expect((await startDirect(a, await person(), "Hi", { db: db!, now })).ok).toBe(true);
    expect(await startDirect(a, await person(), "Hi", { db: db!, now })).toEqual({ ok: false, error: "limit" });
  });

  it("limits messages in open direct chats per sender per day (Testing Run 5, T85)", async () => {
    const { a, b, id } = await openChat();
    const now = new Date();
    expect((await sendMessage(a, id, "First", { db: db!, now })).ok).toBe(true);
    // The rest of the day's messages used up elsewhere, all at once.
    const left = LIMITS.directMessagesPerUserDay.max - 1;
    await Promise.all(Array.from({ length: left }, () => takeShared(LIMITS.directMessagesPerUserDay, a, { db: db!, now: now.getTime() })));
    expect(await sendMessage(a, id, "One more", { db: db!, now })).toEqual({ ok: false, error: "limit" });
    expect(await startDirect(a, b, "Through the other door", { db: db!, now })).toEqual({ ok: false, error: "limit" });
    // The limit is the sender's own: the other person still replies.
    expect((await sendMessage(b, id, "Reply", { db: db!, now })).ok).toBe(true);
  });

  describe("message requests switch (FR-55, gap list item 33)", () => {
    const setRequests = (userId: string, on: boolean) =>
      db!.insert(schema.userSettings).values({ userId, messageRequests: on }).onConflictDoUpdate({ target: schema.userSettings.userId, set: { messageRequests: on } });
    const connect = (x: string, y: string) => db!.insert(schema.connections).values({ userLow: x < y ? x : y, userHigh: x < y ? y : x, how: "other" });

    it("refuses a non-connection's first message with the block's words, without using a request", async () => {
      const a = await person("Asha Rao");
      const b = await person("Vikram Singh");
      await setRequests(b, false);
      const now = new Date();
      // 19 of the day's 20 requests to others, then refused tries to Vikram: the 20th still goes, so none was counted.
      for (let i = 0; i < LIMITS.inboxRequestsPerUser.max - 1; i++) expect((await startDirect(a, await person(), "Hi", { db: db!, now })).ok).toBe(true);
      for (let i = 0; i < 3; i++) expect(await startDirect(a, b, "Hi Vikram", { db: db!, now })).toEqual({ ok: false, error: "unavailable" });
      expect(INBOX_ERROR_TEXT.unavailable).toBe("You can't message this person.");
      expect((await startDirect(a, await person(), "Hi", { db: db!, now })).ok).toBe(true);
      expect(await listThreads(b, deps())).toEqual([]);
    });

    it("lets a connection still open a chat", async () => {
      const a = await person("Asha Rao");
      const b = await person("Vikram Singh");
      await setRequests(b, false);
      await connect(a, b);
      const started = await startDirect(a, b, "Hi Vikram", deps());
      expect(started.ok).toBe(true);
      const [theirs] = await listThreads(b, deps());
      expect(theirs).toMatchObject({ kind: "person" });
    });

    it("keeps a request already sent readable and acceptable after the switch goes off", async () => {
      const a = await person("Asha Rao");
      const b = await person("Vikram Singh");
      const started = await startDirect(a, b, "Hi Vikram", deps());
      if (!started.ok) throw new Error(started.error);
      await setRequests(b, false);
      const [theirs] = await listThreads(b, deps());
      expect(theirs).toMatchObject({ id: started.conversationId, kind: "request" });
      // The sender's second try is the chat's own rule, not the switch.
      expect(await startDirect(a, b, "Again", deps())).toEqual({ ok: false, error: "waiting" });
      expect((await acceptRequest(b, started.conversationId, deps())).ok).toBe(true);
      expect((await sendMessage(a, started.conversationId, "Thanks", deps())).ok).toBe(true);
    });

    it("refuses when the switch goes off between the first look and the lock", async () => {
      const a = await person("Asha Rao");
      const b = await person("Vikram Singh");
      type Run = Parameters<NonNullable<typeof db>["transaction"]>[0];
      // The switch is still on at the first look; it goes off just before the transaction takes the pair lock.
      const racing = new Proxy(db!, {
        get(target, key) {
          if (key === "transaction")
            return async (run: Run) => {
              await setRequests(b, false);
              return target.transaction(run);
            };
          const value = Reflect.get(target, key);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
      expect(await startDirect(a, b, "Hi Vikram", { db: racing })).toEqual({ ok: false, error: "unavailable" });
      expect(await listThreads(b, deps())).toEqual([]);
    });
  });

  it("files reports by target, logs no text, and can block too", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const { a, b, id } = await openChat();
    const sent = await sendMessage(b, id, "Send me your OTP", deps());
    const messageId = sent.ok ? sent.messageId : "";
    // Not someone else's message, or not in this chat: refused.
    const own = await sendMessage(a, id, "No", deps());
    expect((await report(a, { conversationId: id, target: "message", messageId: own.ok ? own.messageId : "", reason: "money_or_otp" }, deps())).ok).toBe(false);
    const filed = await report(a, { conversationId: id, target: "message", messageId, reason: "money_or_otp", note: "Asked for OTP", block: true }, deps());
    expect(filed.ok).toBe(true);
    const [row] = await db!.select().from(schema.reports).where(eq(schema.reports.id, filed.ok ? filed.reportId : ""));
    expect(row).toMatchObject({ reporterId: a, target: "message", targetId: messageId, reason: "money_or_otp", status: "open" });
    expect(reportDeadlines(row.reason, row.createdAt).resolveBy.getTime() - row.createdAt.getTime()).toBe(72 * 3_600_000);
    expect(await sendMessage(b, id, "Hello?", deps())).toEqual({ ok: false, error: "unavailable" });
    const person2 = await report(b, { conversationId: id, target: "person", reason: "harassment" }, deps());
    expect(person2.ok).toBe(true);
    const lines = log.mock.calls.map((c) => String(c[0])).filter((l) => l.includes("inbox_report"));
    expect(lines).toHaveLength(2);
    for (const line of lines) {
      expect(line).not.toMatch(/OTP|Asked for|Vikram|Asha/);
      expect(Object.keys(JSON.parse(line)).sort()).toEqual(["at", "event", "level", "reason", "status", "target"].sort());
    }
    log.mockRestore();
  });

  it("limits reports per person per day", async () => {
    const { a, id } = await openChat();
    const now = new Date();
    for (let i = 0; i < LIMITS.inboxReportsPerUser.max; i++) expect((await report(a, { conversationId: id, target: "chat", reason: "other" }, { db: db!, now })).ok).toBe(true);
    expect(await report(a, { conversationId: id, target: "chat", reason: "other" }, { db: db!, now })).toEqual({ ok: false, error: "limit" });
  });

  it("downloads only the person's own messages, and purging removes theirs", async () => {
    const { a, b, id } = await openChat();
    await sendMessage(b, id, "From Vikram", deps());
    await sendMessage(a, id, "From Asha", deps());
    await report(a, { conversationId: id, target: "chat", reason: "other" }, deps());
    const data = await exportAccountData(a, db!);
    const text = JSON.stringify(data!.inbox);
    expect(text).toContain("From Asha");
    expect(text).not.toContain("From Vikram");
    expect(text).not.toContain("@example.com");
    expect(data!.inbox.reportsMade).toHaveLength(1);

    // Asha's account goes for good: her messages go, Vikram sees that she left, and her report stays without her.
    await db!.update(schema.users).set({ deletionRequestedAt: new Date(Date.now() - 31 * 86_400_000) }).where(eq(schema.users.id, a));
    await purgeDeletedAccounts(db!);
    const [left] = await listThreads(b, deps());
    expect(left).toMatchObject({ id, name: "Former member", state: "left" });
    expect(left.messages.map((m) => m.text)).not.toContain("From Asha");
    expect(left.messages.at(-1)?.text).toBe("This person has left CareerMetro.");
    expect(await sendMessage(b, id, "Hello?", deps())).toEqual({ ok: false, error: "unavailable" });
    expect((await db!.select().from(schema.reports).where(eq(schema.reports.targetId, id)))[0].reporterId).toBeNull();

    // When the last member goes too, the chat goes.
    await db!.update(schema.users).set({ deletionRequestedAt: new Date(Date.now() - 31 * 86_400_000) }).where(eq(schema.users.id, b));
    await purgeDeletedAccounts(db!);
    expect(await db!.select().from(schema.conversations).where(eq(schema.conversations.id, id))).toEqual([]);
  });

  it("shows message times in India time", () => {
    const now = new Date("2026-10-11T12:00:00Z");
    expect(formatAt(new Date("2026-10-09T05:32:00Z"), now)).toBe("Fri 11:02");
    expect(formatAt(new Date("2026-10-01T05:32:00Z"), now)).toBe("1 Oct");
  });
});
