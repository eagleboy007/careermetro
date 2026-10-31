import { eq, inArray, like } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, describe, expect, it, vi } from "vitest";
import * as schema from "@/db/schema";
import { EXPORT_VERSION, exportAccountData } from "@/lib/account/export";
import { eventSuggestionExport, eventSuggestionQueue } from "@/lib/schemas";
import { EVENT_SUGGESTIONS_PENDING_MAX, EVENT_SUGGESTIONS_PER_DAY } from "@/lib/schemas/constants";
import { LIMITS } from "@/lib/shared-limit";
import { exampleSuggestionQueue } from "./fixtures";
import { clearEndedEventSuggestions } from "./store";
import { EVENT_SUGGESTION_MESSAGES, eventSuggestionQueueFor, exportEventSuggestions, pendingSuggestionCount, suggestEvent } from "./suggest-store";

vi.mock("server-only", () => ({}));

it("keeps the limits the plan sets, and says suggestions wait for review", () => {
  expect(LIMITS.eventSuggestionsPerUserDay.max).toBe(EVENT_SUGGESTIONS_PER_DAY);
  expect(LIMITS.eventSuggestionsPerUserDay.bucket).toBe("event-suggestion");
  expect(EVENT_SUGGESTION_MESSAGES.too_many_pending).toMatch(/^You have 20 suggestions waiting for review\./);
  expect(EVENT_SUGGESTION_MESSAGES.duplicate).toMatch(/waiting for review/);
});

it("has a /design example queue the schema takes", () => {
  expect(eventSuggestionQueue.safeParse(exampleSuggestionQueue).error).toBeUndefined();
});

it("refuses a bad form before it reaches the database or the daily count", async () => {
  // No db: a refusal here never opens a transaction, so the tries aren't counted.
  const now = new Date("2026-10-30T06:30:00Z");
  const form = { url: "https://events.example.org/x", title: "SIEM night", organiser: "Example Circle", kind: "meetup", startsAt: "2026-11-07T18:00", endsAt: "2026-11-07T20:00", online: false, city: "Pune", venue: "", cost: "" };
  const deps = { now, db: undefined as never };
  expect(await suggestEvent("u", { ...form, url: "http://events.example.org/x" }, deps)).toEqual({ ok: false, error: "bad_link" });
  expect(await suggestEvent("u", { ...form, url: "https://tinyurl.com/x" }, deps)).toEqual({ ok: false, error: "bad_link" });
  expect(await suggestEvent("u", { ...form, city: null }, deps)).toEqual({ ok: false, error: "invalid" });
  expect(await suggestEvent("u", { ...form, startsAt: "2026-10-30T11:00", endsAt: "2026-10-30T12:00" }, deps)).toEqual({ ok: false, error: "past" });
  expect(await suggestEvent("u", { ...form, startsAt: "2027-11-07T18:00", endsAt: "2027-11-07T20:00" }, deps)).toEqual({ ok: false, error: "too_far" });
});

// Suggest an event (Timetable PR 6) against a real Postgres with migrations applied. Synthetic people and events only.
const url = process.env.TEST_DATABASE_URL;
const sqlClient = url ? postgres(url, { max: 4, onnotice: () => {} }) : null;
const db = sqlClient ? drizzle(sqlClient, { schema }) : null;
type Db = NonNullable<Parameters<typeof exportEventSuggestions>[1]>;

describe.skipIf(!db)("event suggestions (database)", () => {
  const run = `evsuggest${Date.now()}`;
  const userIds: string[] = [];
  const d = () => db as unknown as Db;
  let n = 0;
  const NOW = new Date("2026-10-30T06:30:00Z");
  const link = (k: string | number) => `https://events.example.org/${run}/${k}`;
  const form = (over: Record<string, unknown> = {}) => ({
    url: link(n++),
    title: "Hunting with a SIEM",
    organiser: "Example Security Circle",
    kind: "meetup",
    startsAt: "2026-11-07T18:00",
    endsAt: "2026-11-07T20:00",
    online: false,
    city: "Pune",
    venue: "Baner, Pune",
    cost: "Free",
    ...over,
  });

  afterAll(async () => {
    if (userIds.length) await db!.delete(schema.users).where(inArray(schema.users.id, userIds));
    await sqlClient!.end();
  });

  async function person() {
    const [u] = await db!.insert(schema.users).values({ email: `${run}-${n++}@example.test`, firstName: "Asha" }).returning({ id: schema.users.id });
    userIds.push(u.id);
    return u.id;
  }

  const rowsOf = (userId: string) => db!.select().from(schema.eventSuggestions).where(eq(schema.eventSuggestions.userId, userId));

  it("keeps a suggestion as pending, with the link cleaned, and never as an event anyone can see", async () => {
    const me = await person();
    const sent = form({ url: `${link("clean")}?utm_source=whatsapp#top` });
    expect(await suggestEvent(me, sent, { db: d(), now: NOW })).toEqual({ ok: true });
    const [row] = await rowsOf(me);
    expect(row).toMatchObject({ sourceUrl: link("clean"), host: "events.example.org", status: "pending", city: "Pune", venue: "Baner, Pune" });
    expect(row.startsAt.toISOString()).toBe("2026-11-07T12:30:00.000Z");
    // The feed, the screen, the teaser and the digest read only `events`: a suggestion is never there.
    expect(await db!.select({ id: schema.events.id }).from(schema.events).where(like(schema.events.sourceUrl, `${link("")}%`))).toEqual([]);
    expect(await pendingSuggestionCount(me, NOW, d())).toBe(1);
  });

  it("keeps the same event from the same person once", async () => {
    const me = await person();
    const sent = form();
    expect(await suggestEvent(me, sent, { db: d(), now: NOW })).toEqual({ ok: true });
    expect(await suggestEvent(me, sent, { db: d(), now: NOW })).toEqual({ ok: false, error: "duplicate" });
    // Another date of the same series is another event.
    expect(await suggestEvent(me, { ...sent, startsAt: "2026-11-14T18:00", endsAt: "2026-11-14T20:00" }, { db: d(), now: NOW })).toEqual({ ok: true });
    expect(await rowsOf(me)).toHaveLength(2);
  });

  it("counts every try against the day's five", async () => {
    const me = await person();
    for (let i = 0; i < EVENT_SUGGESTIONS_PER_DAY; i++) expect((await suggestEvent(me, form(), { db: d(), now: NOW })).ok).toBe(true);
    expect(await suggestEvent(me, form(), { db: d(), now: NOW })).toEqual({ ok: false, error: "limit" });
    // The next day has its own five.
    expect((await suggestEvent(me, form(), { db: d(), now: new Date(NOW.getTime() + 86_400_000) })).ok).toBe(true);
  });

  it("holds at most twenty waiting for events not yet over", async () => {
    const me = await person();
    const startsAt = new Date("2026-11-20T12:30:00Z");
    const base = { userId: me, host: "events.example.org", title: "SIEM night", organiser: "Example Circle", kind: "meetup" as const, city: "Pune", startsAt, endsAt: startsAt };
    await db!.insert(schema.eventSuggestions).values(Array.from({ length: EVENT_SUGGESTIONS_PENDING_MAX }, (_, i) => ({ ...base, sourceUrl: link(`cap-${i}`) })));
    expect(await suggestEvent(me, form(), { db: d(), now: NOW })).toEqual({ ok: false, error: "too_many_pending" });
    // Once one of those events is over, it no longer holds a place.
    const past = new Date(NOW.getTime() - 86_400_000);
    await db!.update(schema.eventSuggestions).set({ startsAt: past, endsAt: past }).where(eq(schema.eventSuggestions.sourceUrl, link("cap-0")));
    expect(await suggestEvent(me, form(), { db: d(), now: NOW })).toEqual({ ok: true });
  });

  it("allows no status but pending, and the events table's checks", async () => {
    const me = await person();
    const startsAt = new Date("2026-11-20T12:30:00Z");
    const base = { userId: me, sourceUrl: link("checks"), host: "events.example.org", title: "SIEM night", organiser: "Example Circle", kind: "meetup" as const, city: "Pune", startsAt, endsAt: startsAt };
    await expect(db!.insert(schema.eventSuggestions).values({ ...base, status: "live" as never })).rejects.toThrow();
    await expect(db!.insert(schema.eventSuggestions).values({ ...base, sourceUrl: "http://events.example.org/x" })).rejects.toThrow();
    await expect(db!.insert(schema.eventSuggestions).values({ ...base, online: true })).rejects.toThrow();
    await expect(db!.insert(schema.eventSuggestions).values({ ...base, city: null })).rejects.toThrow();
    await expect(db!.insert(schema.eventSuggestions).values({ ...base, endsAt: new Date(startsAt.getTime() - 1) })).rejects.toThrow();
  });

  it("is in Download your data (from version 37), the person's own only, and goes with the account", async () => {
    const me = await person();
    const other = await person();
    expect(await suggestEvent(me, form({ title: "Mine" }), { db: d(), now: NOW })).toEqual({ ok: true });
    expect(await suggestEvent(other, form({ title: "Theirs" }), { db: d(), now: NOW })).toEqual({ ok: true });
    const mine = await exportEventSuggestions(me, d());
    expect(mine.map((s) => [s.title, s.status])).toEqual([["Mine", "pending"]]);
    for (const s of mine) expect(eventSuggestionExport.safeParse(s).error).toBeUndefined();
    const data = await exportAccountData(me, d());
    expect(EXPORT_VERSION).toBe(39);
    expect(data!.exportVersion).toBe(39);
    expect(data!.timetable.suggestions).toEqual(mine);
    await db!.delete(schema.users).where(eq(schema.users.id, me));
    expect(await rowsOf(me)).toEqual([]);
    expect(await rowsOf(other)).toHaveLength(1);
  });

  it("lists pending suggestions for admins oldest first, without who sent them", async () => {
    const me = await person();
    expect(await suggestEvent(me, form({ title: `Queue ${run}` }), { db: d(), now: new Date(NOW.getTime() - 10 * 86_400_000) })).toEqual({ ok: true });
    const queue = await eventSuggestionQueueFor(d());
    expect(eventSuggestionQueue.safeParse(queue).error).toBeUndefined();
    expect(queue.total).toBeGreaterThanOrEqual(1);
    // The schema is strict, so no row carries a person; ours is among the oldest.
    expect(queue.rows.some((r) => r.title === `Queue ${run}`)).toBe(true);
    for (const r of queue.rows) expect(Object.keys(r)).not.toContain("userId");
  });

  it("deletes suggestions 90 days after their event ends in the daily cleanup", async () => {
    const me = await person();
    const base = { userId: me, host: "events.example.org", title: "SIEM night", organiser: "Example Circle", kind: "meetup" as const, city: "Pune" };
    const old = new Date(NOW.getTime() - 91 * 86_400_000);
    const recent = new Date(NOW.getTime() - 89 * 86_400_000);
    await db!.insert(schema.eventSuggestions).values([
      { ...base, sourceUrl: link("old"), startsAt: old, endsAt: old },
      { ...base, sourceUrl: link("recent"), startsAt: recent, endsAt: recent },
    ]);
    expect((await clearEndedEventSuggestions(d(), NOW)).endedSuggestionsDeleted).toBeGreaterThanOrEqual(1);
    expect((await rowsOf(me)).map((r) => r.sourceUrl)).toEqual([link("recent")]);
  });
});
