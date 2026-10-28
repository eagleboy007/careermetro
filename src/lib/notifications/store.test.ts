import { and, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "@/db/schema";
import { EXPORT_VERSION, exportAccountData } from "@/lib/account/export";
import { answerRequest, blockPerson, removeConnection, requestConnection, withdrawRequest } from "@/lib/network/store";
import { NOTIFICATION_READS_PER_DAY } from "@/lib/schemas/constants";
import { notificationExport } from "@/lib/schemas/notifications";
import { LIMITS } from "@/lib/shared-limit";
import { clearOldNotifications, newCount, notificationsFor, notify, openNotifications } from "./store";

vi.mock("server-only", () => ({}));

it("keeps the plan's daily limit on opening the panel", () => {
  expect(LIMITS.notificationReadsPerUserDay.max).toBe(NOTIFICATION_READS_PER_DAY);
  expect(NOTIFICATION_READS_PER_DAY).toBe(300);
});

// Notifications (docs/plans/notifications-plan.md) against a real Postgres with migrations applied. The network kinds
// and the read rules are here; the application and interview kinds are in src/lib/corporate/interviews-store.test.ts.
// Every person here is made up.
const url = process.env.TEST_DATABASE_URL;
const sqlClient = url ? postgres(url, { max: 4, onnotice: () => {} }) : null;
const db = sqlClient ? drizzle(sqlClient, { schema }) : null;
const DAY = 86_400_000;

describe.skipIf(!db)("notifications (database)", () => {
  const run = `ntf${Date.now()}`;
  // A word no one else's name has, so the logs can be checked for it.
  const tag = `Zn${run.slice(-6)}`;
  const userIds: string[] = [];
  let n = 0;
  // The real clock: rate-limit windows are deleted by it in other test files.
  const now = new Date();
  const deps = (days = 0) => ({ db: db!, now: new Date(now.getTime() + days * DAY) });
  const lines: string[] = [];

  beforeEach(() => {
    for (const level of ["log", "warn", "error"] as const) vi.spyOn(console, level).mockImplementation((line: unknown) => void lines.push(String(line)));
  });
  afterEach(() => vi.restoreAllMocks());
  afterAll(async () => {
    if (userIds.length) await db!.delete(schema.users).where(inArray(schema.users.id, userIds));
    await sqlClient!.end();
    // Logs carry the kind and counts only: never a name.
    expect(lines.join("\n")).not.toContain(tag);
  });

  async function person(first: string, opts: { username?: boolean } = {}) {
    const i = n++;
    const [u] = await db!
      .insert(schema.users)
      .values({ email: `${run}-${i}@example.com`, authSubject: `${run}-${i}`, name: `${first} ${tag}`, username: opts.username ? `${run}-${i}` : null })
      .returning({ id: schema.users.id, username: schema.users.username });
    userIds.push(u.id);
    return u.id;
  }
  const rowsOf = (userId: string) => db!.select().from(schema.notifications).where(eq(schema.notifications.userId, userId));
  const requestBetween = async (from: string, to: string) =>
    (await db!.select({ id: schema.connectionRequests.id }).from(schema.connectionRequests).where(and(eq(schema.connectionRequests.fromUser, from), eq(schema.connectionRequests.toUser, to))))[0]!.id;

  it("writes one row for a connection request, inside its transaction, and none for the person's own action", async () => {
    const a = await person("Asha");
    const b = await person("Ravi");
    const c = await person("Meera");
    expect(await requestConnection(b, a, "same_line", deps())).toMatchObject({ ok: true, state: "requested" });
    const list = await notificationsFor(a, deps());
    expect(list).toEqual([{ id: expect.any(String), kind: "connection_request", text: `Ravi ${tag} asked to connect.`, href: "/network?tab=requests", when: "Just now", isNew: true }]);
    expect(await newCount(a, deps())).toBe(1);
    // The sender gets nothing for their own request, and nobody reads another person's rows.
    expect(await notificationsFor(b, deps())).toEqual([]);
    expect(await newCount(b, deps())).toBe(0);

    // An event that rolls back leaves no notification.
    const request = await requestBetween(b, a);
    await expect(
      db!.transaction(async (tx) => {
        await notify(tx, { kind: "connection_request", userId: c, actorId: b, connectionRequestId: request }, now);
        throw new Error("rolled back");
      }),
    ).rejects.toThrow("rolled back");
    expect(await rowsOf(c)).toEqual([]);
    // Never for oneself; a shape that doesn't fit its kind writes nothing.
    await notify(db!, { kind: "connection_request", userId: b, actorId: b, connectionRequestId: request }, now);
    await notify(db!, { kind: "connection_request", userId: c, actorId: b, applicationId: request } as never, now);
    expect([...(await rowsOf(b)), ...(await rowsOf(c))]).toEqual([]);
  });

  it("writes nothing to an account that is being deleted or is suspended", async () => {
    const a = await person("Kiran");
    const b = await person("Farhan");
    expect(await requestConnection(b, a, "event", deps())).toMatchObject({ ok: true });
    const request = await requestBetween(b, a);
    await db!.delete(schema.notifications).where(eq(schema.notifications.userId, a));
    for (const set of [{ deletionRequestedAt: now }, { suspendedAt: now }]) {
      await db!.update(schema.users).set(set).where(eq(schema.users.id, a));
      await notify(db!, { kind: "connection_request", userId: a, actorId: b, connectionRequestId: request }, now);
      expect(await rowsOf(a)).toEqual([]);
      await db!.update(schema.users).set({ deletionRequestedAt: null, suspendedAt: null }).where(eq(schema.users.id, a));
    }
  });

  it("marks what it shows read on opening, tells the sender when their request is accepted, and a withdrawn request takes its row", async () => {
    const a = await person("Ananya", { username: true });
    const b = await person("Vikram");
    const c = await person("Sana");
    await requestConnection(b, a, "worked_together", deps());
    const opened = await openNotifications(a, {}, deps());
    expect(opened.ok && opened.items.map((x) => x.isNew)).toEqual([true]);
    expect(await newCount(a, deps())).toBe(0);
    const again = await openNotifications(a, {}, deps());
    expect(again.ok && again.items.map((x) => x.isNew)).toEqual([false]);
    expect(await openNotifications(a, { userId: b }, deps())).toEqual({ ok: false, error: "invalid" });

    expect(await answerRequest(a, b, "accept", deps())).toMatchObject({ ok: true, state: "connected" });
    const [handle] = await db!.select({ username: schema.users.username }).from(schema.users).where(eq(schema.users.id, a));
    expect(await notificationsFor(b, deps())).toEqual([
      expect.objectContaining({ kind: "connection_accepted", text: `Ananya ${tag} accepted your request. You can message them now.`, href: `/u/${handle!.username}`, isNew: true }),
    ]);
    // Accepting tells no one else, and the acceptor gets nothing for it.
    expect((await notificationsFor(a, deps())).map((x) => x.kind)).toEqual(["connection_request"]);

    await requestConnection(c, a, "other", deps());
    expect(await newCount(a, deps())).toBe(1);
    expect(await withdrawRequest(c, a, deps())).toEqual({ ok: true });
    expect(await newCount(a, deps())).toBe(0);
    expect((await rowsOf(a)).filter((r) => r.actorId === c)).toEqual([]);
  });

  it("marks read only the rows the panel was given, never one it hid", async () => {
    const a = await person("Neha");
    const b = await person("Suresh");
    const d = await person("Zoya");
    // Suresh asks a little earlier, so the newest-first order never rests on a tie.
    await requestConnection(b, a, "same_line", deps(-0.001));
    await requestConnection(d, a, "event", deps());
    // While Zoya is suspended her request is hidden, so opening the panel leaves it unread.
    await db!.update(schema.users).set({ suspendedAt: now }).where(eq(schema.users.id, d));
    const opened = await openNotifications(a, {}, deps());
    expect(opened.ok && opened.items.map((x) => x.text)).toEqual([`Suresh ${tag} asked to connect.`]);
    await db!.update(schema.users).set({ suspendedAt: null }).where(eq(schema.users.id, d));
    expect(await newCount(a, deps())).toBe(1);
    expect((await notificationsFor(a, deps())).map((x) => [x.text, x.isNew])).toEqual([
      [`Zoya ${tag} asked to connect.`, true],
      [`Suresh ${tag} asked to connect.`, false],
    ]);
  });

  it("collapses a second write before reading into one unread row", async () => {
    const a = await person("Rohit");
    const b = await person("Divya");
    await requestConnection(b, a, "same_line", deps());
    const request = await requestBetween(b, a);
    await notify(db!, { kind: "connection_request", userId: a, actorId: b, connectionRequestId: request }, new Date(now.getTime() + 60_000));
    const rows = await rowsOf(a);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.createdAt.getTime()).toBe(now.getTime() + 60_000);
  });

  it("deletes the rows between two people on a block or a removed connection, and hides suspended, deleting and blocked actors", async () => {
    const a = await person("Pooja");
    const b = await person("Arjun");
    const d = await person("Nikhil");
    const e = await person("Lata");
    await requestConnection(b, a, "same_line", deps());
    await answerRequest(a, b, "accept", deps());
    expect(await newCount(b, deps())).toBe(1);
    expect(await removeConnection(a, b, db!)).toEqual({ ok: true });
    expect([...(await rowsOf(a)), ...(await rowsOf(b))]).toEqual([]);

    await requestConnection(d, a, "event", deps());
    expect(await newCount(a, deps())).toBe(1);
    for (const set of [{ suspendedAt: now }, { deletionRequestedAt: now }]) {
      await db!.update(schema.users).set(set).where(eq(schema.users.id, d));
      expect(await notificationsFor(a, deps())).toEqual([]);
      expect(await newCount(a, deps())).toBe(0);
      await db!.update(schema.users).set({ suspendedAt: null, deletionRequestedAt: null }).where(eq(schema.users.id, d));
    }
    expect(await newCount(a, deps())).toBe(1);
    expect(await blockPerson(a, d, deps())).toEqual({ ok: true });
    expect(await rowsOf(a)).toEqual([]);

    // A block made without dropping the rows (as an old block would be) still hides them, either way round.
    await requestConnection(e, a, "event", deps());
    await db!.insert(schema.blocks).values({ blockerId: e, blockedId: a });
    expect(await notificationsFor(a, deps())).toEqual([]);
    expect(await newCount(a, deps())).toBe(0);
  });

  it("stops marking read past the day's limit, and the rows still show", async () => {
    const a = await person("Gita");
    const b = await person("Tara");
    const limit = LIMITS.notificationReadsPerUserDay.max;
    LIMITS.notificationReadsPerUserDay.max = 1;
    try {
      await requestConnection(b, a, "same_line", deps());
      await openNotifications(a, {}, deps());
      await db!.update(schema.notifications).set({ readAt: null }).where(eq(schema.notifications.userId, a));
      const second = await openNotifications(a, {}, deps());
      expect(second.ok && second.items.map((x) => x.isNew)).toEqual([true]);
      expect(await newCount(a, deps())).toBe(1);
    } finally {
      LIMITS.notificationReadsPerUserDay.max = limit;
    }
  });

  it("shows nothing older than 60 days, and the cleanup deletes read rows after 60 days and any row after 90", async () => {
    const a = await person("Hema");
    const b = await person("Ishan");
    await requestConnection(b, a, "same_line", deps());
    const request = await requestBetween(b, a);
    const old = (days: number) => new Date(now.getTime() - days * DAY);
    const [readLong] = await db!.insert(schema.notifications).values({ userId: a, kind: "connection_accepted", actorId: b, connectionRequestId: request, createdAt: old(70), readAt: old(61) }).returning();
    const [readLately] = await db!.insert(schema.notifications).values({ userId: a, kind: "connection_accepted", actorId: b, connectionRequestId: request, createdAt: old(70), readAt: old(59) }).returning();
    const [unreadOld] = await db!.insert(schema.notifications).values({ userId: a, kind: "connection_accepted", actorId: b, connectionRequestId: request, createdAt: old(91) }).returning();
    // Past 60 days nothing shows, though the row is kept until the cleanup.
    expect((await notificationsFor(a, deps())).map((x) => x.kind)).toEqual(["connection_request"]);
    expect(await clearOldNotifications(db!, now)).toBeGreaterThanOrEqual(2);
    const left = (await rowsOf(a)).map((r) => r.id);
    expect(left).toContain(readLately!.id);
    expect(left).not.toContain(readLong!.id);
    expect(left).not.toContain(unreadOld!.id);
    expect(left).toHaveLength(2);
  });

  it("exports kind and dates with no other person's name (version 32), and the account's deletion takes its rows", async () => {
    const a = await person("Uma");
    const b = await person("Yusuf");
    await requestConnection(b, a, "same_line", deps());
    const data = await exportAccountData(a, db! as never);
    expect(EXPORT_VERSION).toBe(33);
    expect(data!.exportVersion).toBe(33);
    expect(data!.notifications.map((x) => notificationExport.parse(x))).toEqual([{ kind: "connection_request", created_at: now.toISOString(), read_at: null }]);
    expect(JSON.stringify(data!.notifications)).not.toContain(tag);

    await db!.delete(schema.users).where(eq(schema.users.id, a));
    expect(await rowsOf(a)).toEqual([]);
  });
});
