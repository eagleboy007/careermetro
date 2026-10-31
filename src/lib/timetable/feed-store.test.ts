import { eq, inArray, like } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import type { FeedEventRow } from "@/lib/schemas";
import { noDrops, type FeedRead } from "./feed";
import { writeFeedRun } from "./feed-store";

const url = process.env.TEST_DATABASE_URL;
const sqlClient = url ? postgres(url, { max: 4, onnotice: () => {} }) : null;
const db = sqlClient ? drizzle(sqlClient, { schema }) : null;
type Db = NonNullable<Parameters<typeof writeFeedRun>[2]>;

// Synthetic events only, under a feed id no real feed uses.
describe.skipIf(!db)("the event feed's writes (database)", () => {
  const feedId = `test-feed-${Date.now()}`;
  const d = () => db as unknown as Db;
  const T0 = new Date("2026-10-31T00:30:00Z");
  const later = (days: number, h = 0) => new Date(T0.getTime() + days * 86_400_000 + h * 3600_000);

  afterAll(async () => {
    await db!.delete(schema.events).where(like(schema.events.sourceKey, `${feedId}:%`));
    await sqlClient!.end();
  });

  const row = (key: string, over: Partial<FeedEventRow> = {}): FeedEventRow => ({
    sourceKey: `${feedId}:${key}`,
    sourceUrl: `https://events.example.org/${key}`,
    title: `Python evening ${key}`,
    organiser: "Example Circle",
    kind: "meetup",
    startsAt: later(5),
    endsAt: later(5, 2),
    online: false,
    city: "Pune",
    venue: null,
    cost: "",
    topics: [{ kind: "skill", topic: "python" }],
    ...over,
  });
  const read = (rows: FeedEventRow[], over: Partial<FeedRead> = {}): FeedRead => ({ feedId, ok: true, complete: true, error: null, rows, dropped: noDrops(), listed: rows.length, ...over });
  const byKey = async (key: string) => {
    const [e] = await db!.select().from(schema.events).where(eq(schema.events.sourceKey, `${feedId}:${key}`));
    const topics = e ? await db!.select().from(schema.eventTopics).where(eq(schema.eventTopics.eventId, e.id)) : [];
    return { e, topics: topics.map((t) => `${t.kind}:${t.topic}`).sort() };
  };

  it("inserts new events live, updates seen ones, and replaces their topics", async () => {
    const first = await writeFeedRun([read([row("a"), row("b")])], { startedAt: T0, now: T0 }, d());
    expect(first).toEqual({ upserted: 2, cancelled: 0, topics: 2 });
    expect((await byKey("a")).e).toMatchObject({ source: "feed", status: "live", city: "Pune", checkedAt: T0 });

    const t1 = later(1);
    const second = await writeFeedRun(
      [read([row("a", { title: "Python and Linux evening", topics: [{ kind: "skill", topic: "linux" }, { kind: "interest", topic: "open-source" }] }), row("b")])],
      { startedAt: t1, now: t1 },
      d(),
    );
    expect(second.upserted).toBe(2);
    const a = await byKey("a");
    expect(a.e).toMatchObject({ title: "Python and Linux evening", checkedAt: t1 });
    expect(a.topics).toEqual(["interest:open-source", "skill:linux"]);
  });

  it("cancels events still ahead that a complete feed no longer lists, and keeps hidden ones hidden", async () => {
    const [b] = await db!.select({ id: schema.events.id }).from(schema.events).where(eq(schema.events.sourceKey, `${feedId}:b`));
    await db!.update(schema.events).set({ status: "hidden" }).where(eq(schema.events.id, b.id));
    const t2 = later(2);
    const run = await writeFeedRun([read([row("b"), row("c")])], { startedAt: t2, now: t2 }, d());
    expect(run.cancelled).toBe(1);
    expect((await byKey("a")).e.status).toBe("cancelled");
    expect((await byKey("b")).e.status).toBe("hidden");
    expect((await byKey("c")).e.status).toBe("live");

    // Listed again: live again.
    const t3 = later(3);
    await writeFeedRun([read([row("a"), row("b"), row("c")])], { startedAt: t3, now: t3 }, d());
    expect((await byKey("a")).e.status).toBe("live");
  });

  it("cancels nothing for a feed that failed, was cut short or kept nothing, nor an event that has started", async () => {
    const t4 = later(4);
    for (const r of [read([], { ok: false, complete: false, error: "503" }), read([row("c")], { complete: false, error: "500" }), read([])]) {
      expect((await writeFeedRun([r], { startedAt: t4, now: t4 }, d())).cancelled).toBe(0);
    }
    const ids = await db!.select({ status: schema.events.status }).from(schema.events).where(inArray(schema.events.sourceKey, [`${feedId}:a`, `${feedId}:b`]));
    expect(ids.map((x) => x.status).sort()).toEqual(["hidden", "live"]);
    // "a" starts at day 5; by day 6 it has started, so a run that no longer lists it leaves it alone.
    const t6 = later(6);
    expect((await writeFeedRun([read([row("c", { startsAt: later(9), endsAt: later(9, 2) })])], { startedAt: t6, now: t6 }, d())).cancelled).toBe(0);
    expect((await byKey("a")).e.status).toBe("live");
  });
});
