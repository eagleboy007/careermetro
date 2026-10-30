import { eq, inArray, like } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, describe, expect, it, vi } from "vitest";
import * as schema from "@/db/schema";
import { EXPORT_VERSION, exportAccountData } from "@/lib/account/export";
import { eventRsvpExport } from "@/lib/schemas";
import { clearOldEventsDigests, exportTimetable } from "./store";

vi.mock("server-only", () => ({}));

const url = process.env.TEST_DATABASE_URL;
const sqlClient = url ? postgres(url, { max: 4, onnotice: () => {} }) : null;
const db = sqlClient ? drizzle(sqlClient, { schema }) : null;
type Db = NonNullable<Parameters<typeof exportTimetable>[1]>;

// Synthetic people and events only.
describe.skipIf(!db)("Timetable rows (database)", () => {
  const run = `timetable${Date.now()}`;
  const userIds: string[] = [];
  const d = () => db as unknown as Db;
  let n = 0;
  const NOW = new Date("2026-10-30T06:30:00Z");

  afterAll(async () => {
    if (userIds.length) await db!.delete(schema.users).where(inArray(schema.users.id, userIds));
    await db!.delete(schema.events).where(like(schema.events.sourceKey, `${run}%`));
    await sqlClient!.end();
  });

  async function person() {
    const [u] = await db!.insert(schema.users).values({ email: `${run}-${n++}@example.test`, firstName: "Asha" }).returning({ id: schema.users.id });
    userIds.push(u.id);
    return u.id;
  }

  async function event(over: Partial<typeof schema.events.$inferInsert> = {}) {
    const startsAt = new Date(NOW.getTime() + 3 * 86_400_000);
    const [e] = await db!
      .insert(schema.events)
      .values({
        source: "feed",
        sourceKey: `${run}-${n++}`,
        sourceUrl: "https://events.example.org/pune/siem",
        title: "Hunting with a SIEM",
        organiser: "Example Security Circle",
        kind: "meetup",
        startsAt,
        endsAt: new Date(startsAt.getTime() + 2 * 3600_000),
        city: "Pune",
        cost: "Free",
        status: "live",
        ...over,
      })
      .returning({ id: schema.events.id });
    return e.id;
  }

  it("exports the person's own saves and I'm going, the three choices and the last digest week, as version 36", async () => {
    const me = await person();
    const other = await person();
    const a = await event();
    const b = await event({ title: "GenAI evening", online: true, city: null, kind: "online" });
    await db!.insert(schema.eventTopics).values([{ eventId: a, kind: "skill", topic: "siem" }, { eventId: b, kind: "interest", topic: "ai" }]);
    await db!.insert(schema.eventRsvps).values([
      { userId: me, eventId: a, state: "going", goalSkillId: "siem", createdAt: new Date(NOW.getTime() - 2000) },
      { userId: me, eventId: b, state: "saved", createdAt: new Date(NOW.getTime() - 1000) },
      { userId: other, eventId: a, state: "saved" },
    ]);

    // No settings row: the defaults.
    expect((await exportTimetable(me, d())).settings).toEqual({ radiusKm: 25, online: true, digest: false });
    await db!.insert(schema.userSettings).values({ userId: me, eventsRadiusKm: 100, eventsOnline: false, eventsDigest: true });
    await db!.insert(schema.eventsDigests).values([{ userId: me, week: "2026-10-19" }, { userId: me, week: "2026-10-26" }, { userId: other, week: "2026-11-02" }]);

    const t = await exportTimetable(me, d());
    expect(t.settings).toEqual({ radiusKm: 100, online: false, digest: true });
    expect(t.lastDigestWeek).toBe("2026-10-26");
    expect(t.rsvps.map((r) => [r.title, r.state, r.goalSkillId])).toEqual([
      ["Hunting with a SIEM", "going", "siem"],
      ["GenAI evening", "saved", null],
    ]);
    for (const r of t.rsvps) expect(eventRsvpExport.safeParse(r).error).toBeUndefined();

    const data = await exportAccountData(me, d());
    expect(EXPORT_VERSION).toBe(36);
    expect(data!.exportVersion).toBe(36);
    expect(data!.timetable).toEqual(t);
    expect((await exportTimetable(other, d())).rsvps).toHaveLength(1);
  });

  it("refuses what the table checks refuse", async () => {
    await expect(event({ online: true, city: "Pune" })).rejects.toThrow();
    await expect(event({ sourceUrl: "http://events.example.org/x" })).rejects.toThrow();
    await expect(event({ endsAt: new Date(NOW.getTime()) })).rejects.toThrow();
    const me = await person();
    const e = await event();
    await expect(db!.insert(schema.eventRsvps).values({ userId: me, eventId: e, state: "saved", goalSkillId: "siem" })).rejects.toThrow();
    await expect(db!.insert(schema.userSettings).values({ userId: me, eventsRadiusKm: 50 })).rejects.toThrow();
  });

  it("re-reads an event by its source key rather than adding it twice", async () => {
    const key = `${run}-same`;
    await event({ sourceKey: key });
    await expect(event({ sourceKey: key })).rejects.toThrow();
  });

  it("deletes digest rows over 90 days old in the daily cleanup", async () => {
    const me = await person();
    await db!.insert(schema.eventsDigests).values([
      { userId: me, week: "2026-07-20", sentAt: new Date(NOW.getTime() - 91 * 86_400_000) },
      { userId: me, week: "2026-10-26", sentAt: new Date(NOW.getTime() - 4 * 86_400_000) },
    ]);
    expect((await clearOldEventsDigests(d(), NOW)).eventsDigestRowsCleared).toBeGreaterThanOrEqual(1);
    const left = await db!.select({ week: schema.eventsDigests.week }).from(schema.eventsDigests).where(eq(schema.eventsDigests.userId, me));
    expect(left).toEqual([{ week: "2026-10-26" }]);
  });

  it("goes with the account, and an event takes its topics and saves with it", async () => {
    const me = await person();
    const e = await event();
    await db!.insert(schema.eventTopics).values({ eventId: e, kind: "skill", topic: "siem" });
    await db!.insert(schema.eventRsvps).values({ userId: me, eventId: e, state: "saved" });
    await db!.insert(schema.eventsDigests).values({ userId: me, week: "2026-10-26" });
    await db!.delete(schema.users).where(eq(schema.users.id, me));
    expect(await db!.select().from(schema.eventRsvps).where(eq(schema.eventRsvps.userId, me))).toEqual([]);
    expect(await db!.select().from(schema.eventsDigests).where(eq(schema.eventsDigests.userId, me))).toEqual([]);

    const someone = await person();
    await db!.insert(schema.eventRsvps).values({ userId: someone, eventId: e, state: "going" });
    await db!.delete(schema.events).where(eq(schema.events.id, e));
    expect(await db!.select().from(schema.eventTopics).where(eq(schema.eventTopics.eventId, e))).toEqual([]);
    expect(await db!.select().from(schema.eventRsvps).where(eq(schema.eventRsvps.eventId, e))).toEqual([]);
  });
});
