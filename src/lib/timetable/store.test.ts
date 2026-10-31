import { eq, inArray, like } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { skills } from "@/content";
import * as schema from "@/db/schema";
import { EXPORT_VERSION, exportAccountData } from "@/lib/account/export";
import { eventRsvpExport } from "@/lib/schemas";
import { clearEndedEvents, clearOldEventsDigests, exportTimetable, prepEventsOn, setEventPrep, setEventRsvp, timetableForUser, timetablePersonFor, timetableTeaserFor } from "./store";

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

  beforeAll(async () => {
    // Goals point at the skills table; the content seed may not have run on this database.
    const used = skills.filter((s) => ["siem", "python", "aws"].includes(s.id));
    await db!
      .insert(schema.skills)
      .values(used.map(({ id, name, category }) => ({ id, name, category })))
      .onConflictDoNothing();
  });

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

  it("exports the person's own saves and I'm going, the three choices and the last digest week and their suggestions, as version 37", async () => {
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
    // Every digest week kept, newest first, not only the latest (T166g); never another person's.
    expect(t.digestWeeks).toEqual(["2026-10-26", "2026-10-19"]);
    expect(t.rsvps.map((r) => [r.title, r.state, r.goalSkillId])).toEqual([
      ["Hunting with a SIEM", "going", "siem"],
      ["GenAI evening", "saved", null],
    ]);
    for (const r of t.rsvps) expect(eventRsvpExport.safeParse(r).error).toBeUndefined();

    const data = await exportAccountData(me, d());
    expect(EXPORT_VERSION).toBe(37);
    expect(data!.exportVersion).toBe(37);
    expect(data!.timetable).toEqual(t);
    expect((await exportTimetable(other, d())).rsvps).toHaveLength(1);
  });

  it("refuses what the table checks refuse", async () => {
    await expect(event({ online: true, city: "Pune" })).rejects.toThrow();
    // An in-person event names its city (T166, migration 0056).
    await expect(event({ online: false, city: null })).rejects.toThrow();
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

  it("deletes events 90 days after they end, with their topics and everyone's saves, in the daily cleanup (T164)", async () => {
    const me = await person();
    const oldStart = new Date(NOW.getTime() - 92 * 86_400_000);
    const old = await event({ startsAt: oldStart, endsAt: new Date(NOW.getTime() - 91 * 86_400_000) });
    const recent = await event({ startsAt: oldStart, endsAt: new Date(NOW.getTime() - 89 * 86_400_000) });
    await db!.insert(schema.eventTopics).values([{ eventId: old, kind: "skill", topic: "siem" }, { eventId: recent, kind: "skill", topic: "siem" }]);
    await db!.insert(schema.eventRsvps).values([{ userId: me, eventId: old, state: "going" }, { userId: me, eventId: recent, state: "saved" }]);
    expect((await clearEndedEvents(d(), NOW)).endedEventsDeleted).toBeGreaterThanOrEqual(1);
    const left = await db!.select({ id: schema.events.id }).from(schema.events).where(inArray(schema.events.id, [old, recent]));
    expect(left).toEqual([{ id: recent }]);
    expect(await db!.select().from(schema.eventTopics).where(eq(schema.eventTopics.eventId, old))).toEqual([]);
    expect((await db!.select({ eventId: schema.eventRsvps.eventId }).from(schema.eventRsvps).where(eq(schema.eventRsvps.userId, me))).map((r) => r.eventId)).toEqual([recent]);
  });

  it("reads the person from the profile city, saved choices, open goals and interests", async () => {
    const me = await person();
    // No city, no settings, no goals: online only, the defaults, nothing to match.
    const empty = await timetablePersonFor(me, d());
    expect(empty.person).toEqual({ city: null, radiusKm: 25, online: true, goalSkillIds: [], interestKeys: [] });
    await db!.update(schema.users).set({ city: "Pune" }).where(eq(schema.users.id, me));
    await db!.insert(schema.userSettings).values({ userId: me, eventsRadiusKm: 100, eventsOnline: false });
    await db!.insert(schema.userGoals).values([
      { userId: me, skillId: "siem", position: 1 },
      { userId: me, skillId: "python", position: 0 },
      { userId: me, skillId: "aws", position: 2, status: "met" },
    ]);
    await db!.insert(schema.userInterests).values({ userId: me, name: "GenAI", nameKey: "genai" });
    const read = await timetablePersonFor(me, d());
    expect(read.person).toEqual({ city: "Pune", radiusKm: 100, online: false, goalSkillIds: ["python", "siem"], interestKeys: ["genai"] });
    expect(read.choices).toEqual({ radiusKm: 100, online: false });
    expect(read.why).toEqual({ goals: ["Python", "SIEM and log analysis"], interests: ["GenAI"] });
  });

  it("shows only live matches with the person's own marks, wide for the filter row, and the teaser under the saved choices", async () => {
    const me = await person();
    await db!.update(schema.users).set({ city: "Pune" }).where(eq(schema.users.id, me));
    await db!.insert(schema.userGoals).values({ userId: me, skillId: "siem", position: 0 });
    await db!.insert(schema.userInterests).values({ userId: me, name: "AI", nameKey: "ai" });
    const soon = new Date(Date.now() + 2 * 86_400_000);
    const at = (h: number) => ({ startsAt: new Date(soon.getTime() + h * 3600_000), endsAt: new Date(soon.getTime() + (h + 2) * 3600_000) });
    const goal = await event(at(0));
    const online = await event({ ...at(1), online: true, city: null, kind: "online", title: "GenAI evening" });
    const mumbai = await event({ ...at(2), city: "Mumbai" });
    const hidden = await event({ ...at(3), status: "hidden" });
    const other = await event({ ...at(4), title: "Excel tips" });
    await db!.insert(schema.eventTopics).values([
      { eventId: goal, kind: "skill", topic: "siem" },
      { eventId: online, kind: "interest", topic: "ai" },
      { eventId: mumbai, kind: "skill", topic: "siem" },
      { eventId: hidden, kind: "skill", topic: "siem" },
      { eventId: other, kind: "skill", topic: "excel" },
    ]);
    await db!.insert(schema.eventRsvps).values({ userId: me, eventId: goal, state: "saved" });
    const mine = new Set([goal, online, mumbai, hidden, other]);
    const { view, choices, why } = await timetableForUser(me, new Date(), d());
    const cards = view.groups.flatMap((g) => g.events).filter((c) => mine.has(c.id));
    expect(cards.map((c) => [c.id, c.rsvp])).toEqual([
      [goal, "saved"],
      [online, null],
    ]);
    // Mumbai is about 120 km from Pune: beyond even "Show outside 25 km".
    expect(view.outsideRadius).toBeGreaterThanOrEqual(1);
    expect(choices).toEqual({ radiusKm: 25, online: true });
    expect(why.interests).toEqual(["AI"]);
    const teaser = (await timetableTeaserFor(me, new Date(), d())).filter((t) => mine.has(t.id));
    expect(teaser.map((t) => t.id)).toEqual([goal, online]);
  });

  it("saves, marks going and takes a mark off, only on a live event", async () => {
    const me = await person();
    const live = await event();
    const cancelled = await event({ status: "cancelled" });
    const rows = async () => db!.select({ state: schema.eventRsvps.state, goal: schema.eventRsvps.goalSkillId }).from(schema.eventRsvps).where(eq(schema.eventRsvps.userId, me));
    expect(await setEventRsvp(me, { eventId: live, state: "saved" }, d())).toEqual({ ok: true });
    expect(await rows()).toEqual([{ state: "saved", goal: null }]);
    expect(await setEventRsvp(me, { eventId: live, state: "going" }, d())).toEqual({ ok: true });
    expect(await rows()).toEqual([{ state: "going", goal: null }]);
    // A goal named by a later prep task (PR 3) is cleared when the person goes back to Save.
    await db!.update(schema.eventRsvps).set({ goalSkillId: "siem" }).where(eq(schema.eventRsvps.userId, me));
    expect(await setEventRsvp(me, { eventId: live, state: "saved" }, d())).toEqual({ ok: true });
    expect(await rows()).toEqual([{ state: "saved", goal: null }]);
    expect(await setEventRsvp(me, { eventId: live, state: null }, d())).toEqual({ ok: true });
    expect(await rows()).toEqual([]);
    expect(await setEventRsvp(me, { eventId: cancelled, state: "saved" }, d())).toEqual({ ok: false, error: "not_found" });
    expect(await setEventRsvp(me, { eventId: "00000000-0000-4000-8000-000000000000", state: "going" }, d())).toEqual({ ok: false, error: "not_found" });
    expect(await setEventRsvp(me, { eventId: live, state: "maybe" }, d())).toEqual({ ok: false, error: "invalid" });
    expect(await rows()).toEqual([]);
  });

  it("makes I'm going a prep task for an open goal the event lists, and takes it off again", async () => {
    const me = await person();
    await db!.insert(schema.userGoals).values([
      { userId: me, skillId: "siem", position: 0 },
      { userId: me, skillId: "python", position: 1, status: "skipped" },
    ]);
    const live = await event();
    const cancelled = await event({ status: "cancelled" });
    await db!.insert(schema.eventTopics).values([
      { eventId: live, kind: "skill", topic: "siem" },
      { eventId: live, kind: "skill", topic: "python" },
      { eventId: live, kind: "skill", topic: "aws" },
      { eventId: cancelled, kind: "skill", topic: "siem" },
    ]);
    const goal = async () => (await db!.select({ state: schema.eventRsvps.state, goal: schema.eventRsvps.goalSkillId }).from(schema.eventRsvps).where(eq(schema.eventRsvps.userId, me)))[0] ?? null;
    // Not going yet: nothing to make a prep task of.
    expect(await setEventPrep(me, { eventId: live, goalSkillId: "siem" }, d())).toEqual({ ok: false, error: "invalid" });
    await setEventRsvp(me, { eventId: live, state: "saved" }, d());
    expect(await setEventPrep(me, { eventId: live, goalSkillId: "siem" }, d())).toEqual({ ok: false, error: "invalid" });
    expect(await setEventRsvp(me, { eventId: live, state: "going" }, d())).toEqual({ ok: true });
    // A skipped goal, a skill that is no goal of theirs, and a goal the event doesn't list are refused.
    expect(await setEventPrep(me, { eventId: live, goalSkillId: "python" }, d())).toEqual({ ok: false, error: "invalid" });
    expect(await setEventPrep(me, { eventId: live, goalSkillId: "aws" }, d())).toEqual({ ok: false, error: "invalid" });
    expect(await setEventPrep(me, { eventId: live, goalSkillId: "excel" }, d())).toEqual({ ok: false, error: "invalid" });
    expect(await goal()).toEqual({ state: "going", goal: null });
    expect(await setEventPrep(me, { eventId: live, goalSkillId: "siem" }, d())).toEqual({ ok: true });
    expect(await goal()).toEqual({ state: "going", goal: "siem" });
    // Marking going again keeps it; going back to Save clears it.
    expect(await setEventRsvp(me, { eventId: live, state: "going" }, d())).toEqual({ ok: true });
    expect(await goal()).toEqual({ state: "going", goal: "siem" });
    expect(await setEventPrep(me, { eventId: live, goalSkillId: null }, d())).toEqual({ ok: true });
    expect(await goal()).toEqual({ state: "going", goal: null });
    expect(await setEventPrep(me, { eventId: live, goalSkillId: "siem" }, d())).toEqual({ ok: true });
    await setEventRsvp(me, { eventId: live, state: "saved" }, d());
    expect(await goal()).toEqual({ state: "saved", goal: null });
    // Only a live event; a bad input is refused.
    await db!.insert(schema.eventRsvps).values({ userId: me, eventId: cancelled, state: "going" });
    expect(await setEventPrep(me, { eventId: cancelled, goalSkillId: "siem" }, d())).toEqual({ ok: false, error: "not_found" });
    expect(await setEventPrep(me, { eventId: live, goalSkillId: "Not A Skill" }, d())).toEqual({ ok: false, error: "invalid" });
    // Someone else's going row is never touched.
    const other = await person();
    await db!.insert(schema.userGoals).values({ userId: other, skillId: "siem", position: 0 });
    await db!.insert(schema.eventRsvps).values({ userId: other, eventId: live, state: "going" });
    expect(await setEventPrep(me, { eventId: live, goalSkillId: "siem" }, d())).toEqual({ ok: false, error: "invalid" });
    const [theirs] = await db!.select({ goal: schema.eventRsvps.goalSkillId }).from(schema.eventRsvps).where(eq(schema.eventRsvps.userId, other));
    expect(theirs.goal).toBeNull();
  });

  it("gives the ride the day's live prep events, and the timetable card its prep goal", async () => {
    const me = await person();
    await db!.update(schema.users).set({ city: "Pune" }).where(eq(schema.users.id, me));
    await db!.insert(schema.userGoals).values({ userId: me, skillId: "siem", position: 0 });
    // 6 pm IST two days from now, and the same day's late-night and next-morning events around it.
    const day = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
    const ist = (time: string) => new Date(Date.parse(`${day}T${time}:00+05:30`));
    const evening = await event({ startsAt: ist("18:00"), endsAt: ist("20:00") });
    const late = await event({ startsAt: ist("23:30"), endsAt: ist("23:59"), title: "Late SIEM night" });
    const next = await event({ startsAt: new Date(ist("00:30").getTime() + 86_400_000), endsAt: new Date(ist("02:00").getTime() + 86_400_000) });
    const cancelled = await event({ startsAt: ist("10:00"), endsAt: ist("11:00"), status: "cancelled" });
    const saved = await event({ startsAt: ist("12:00"), endsAt: ist("13:00") });
    const ids = [evening, late, next, cancelled, saved];
    await db!.insert(schema.eventTopics).values(ids.map((eventId) => ({ eventId, kind: "skill" as const, topic: "siem" })));
    await db!.insert(schema.eventRsvps).values([
      { userId: me, eventId: evening, state: "going", goalSkillId: "siem" },
      { userId: me, eventId: late, state: "going", goalSkillId: null },
      { userId: me, eventId: next, state: "going", goalSkillId: "siem" },
      { userId: me, eventId: cancelled, state: "going", goalSkillId: "siem" },
      { userId: me, eventId: saved, state: "saved" },
    ]);
    const prep = await prepEventsOn(me, day, d());
    expect(prep.map((p) => [p.eventId, p.goalSkillId, p.title])).toEqual([[evening, "siem", "Hunting with a SIEM"]]);
    expect(prep[0]).toMatchObject({ organiser: "Example Security Circle", sourceUrl: "https://events.example.org/pune/siem", startsAt: ist("18:00"), endsAt: ist("20:00") });
    expect(await prepEventsOn(await person(), day, d())).toEqual([]);

    const { view } = await timetableForUser(me, new Date(), d());
    const cards = new Map(view.groups.flatMap((g) => g.events).map((c) => [c.id, c]));
    expect(cards.get(evening)?.prepGoal).toBe("siem");
    expect(cards.get(late)?.prepGoal).toBeUndefined();
    expect(cards.get(saved)?.prepGoal).toBeUndefined();
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
