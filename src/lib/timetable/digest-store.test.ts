import { eq, inArray, like } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { skills } from "@/content";
import * as schema from "@/db/schema";
import { appEmailsSent } from "@/lib/email/budget";
import { indiaDay, mondayOf } from "@/lib/ride/days";
import { APP_EMAIL_DIGEST_SHARE } from "@/lib/schemas/constants";
import { exportTimetable } from "./store";
import { digestFor, digestKey, eventsDigestOn, runEventsDigests, setEventsDigest, turnOffEventsDigest, type DigestSend } from "./digest-store";

vi.mock("server-only", () => ({}));

const url = process.env.TEST_DATABASE_URL;
const sqlClient = url ? postgres(url, { max: 4, onnotice: () => {} }) : null;
const db = sqlClient ? drizzle(sqlClient, { schema }) : null;
type Db = NonNullable<Parameters<typeof digestFor>[1]>["db"];

// Synthetic people and events only, far in the future so no other test's events or budget day share them.
describe.skipIf(!db)("the Monday events digest (database)", () => {
  const run = `digest${Date.now()}`;
  const userIds: string[] = [];
  const lines: string[] = [];
  let n = 0;
  // A Monday, 07:00 IST.
  const MONDAY = new Date("2098-03-03T01:30:00Z");
  const TUESDAY = new Date(MONDAY.getTime() + 86_400_000);
  const WEEK = mondayOf(indiaDay(MONDAY));
  const DAYS = [indiaDay(MONDAY), indiaDay(TUESDAY)];
  const SITE = "https://careermetro.test";
  const d = () => db as unknown as Db;

  beforeAll(async () => {
    const used = skills.filter((s) => ["siem"].includes(s.id));
    await db!
      .insert(schema.skills)
      .values(used.map(({ id, name, category }) => ({ id, name, category })))
      .onConflictDoNothing();
  });
  beforeEach(async () => {
    for (const level of ["log", "warn", "error"] as const) vi.spyOn(console, level).mockImplementation((line: unknown) => void lines.push(String(line)));
    await db!.delete(schema.appEmailDays).where(inArray(schema.appEmailDays.day, DAYS));
  });
  afterEach(() => vi.restoreAllMocks());
  afterAll(async () => {
    await db!.delete(schema.appEmailDays).where(inArray(schema.appEmailDays.day, DAYS));
    if (userIds.length) await db!.delete(schema.users).where(inArray(schema.users.id, userIds));
    await db!.delete(schema.events).where(like(schema.events.sourceKey, `${run}%`));
    await sqlClient!.end();
    // Nothing about a person or an event reaches a log line.
    const all = lines.join("\n");
    for (const words of [run, "Digest Circle", "SIEM night (digest)", "Asha"]) expect(all).not.toContain(words);
  });

  /** A person in Pune with a SIEM goal, and the digest on or off. */
  async function person({ on = true, weekly = false }: { on?: boolean; weekly?: boolean } = {}) {
    const email = `${run}-${n++}@example.test`;
    const [u] = await db!.insert(schema.users).values({ email, firstName: "Asha", city: "Pune" }).returning({ id: schema.users.id });
    userIds.push(u.id);
    await db!.insert(schema.userSettings).values({ userId: u.id, eventsDigest: on, emailWeeklySummary: weekly });
    await db!.insert(schema.userGoals).values({ userId: u.id, skillId: "siem", position: 0 });
    return { userId: u.id, email };
  }

  /** A live SIEM event in Pune, `days` after Monday morning. */
  async function event(days: number, over: Partial<typeof schema.events.$inferInsert> = {}) {
    const startsAt = new Date(MONDAY.getTime() + days * 86_400_000);
    const [e] = await db!
      .insert(schema.events)
      .values({
        source: "feed",
        sourceKey: `${run}-${n++}`,
        sourceUrl: "https://events.example.org/digest",
        title: "SIEM night (digest)",
        organiser: "Digest Circle",
        kind: "meetup",
        startsAt,
        endsAt: new Date(startsAt.getTime() + 2 * 3600_000),
        city: "Pune",
        cost: "Free",
        status: "live",
        ...over,
      })
      .returning({ id: schema.events.id });
    await db!.insert(schema.eventTopics).values({ eventId: e.id, kind: "skill", topic: "siem" });
    return e.id;
  }

  const sender = (ok = true) => {
    const sent: Parameters<DigestSend>[0][] = [];
    const send: DigestSend = async (m) => {
      sent.push(m);
      return { ok };
    };
    return { sent, send };
  };
  const weeks = async (userId: string) => (await db!.select().from(schema.eventsDigests).where(eq(schema.eventsDigests.userId, userId))).map((r) => r.week);
  const settingsOf = async (userId: string) => (await db!.select().from(schema.userSettings).where(eq(schema.userSettings.userId, userId)))[0]!;

  it("sends once a week to people who turned it on and have a match in the next 7 days, from the shared budget", async () => {
    await event(2);
    await event(3, { status: "cancelled", title: "Cancelled night" });
    await event(9, { title: "Too far ahead" });
    const a = await person();
    const off = await person({ on: false });
    const only = [a.userId, off.userId];
    const { sent, send } = sender();
    expect(await runEventsDigests({ db: d(), now: MONDAY, site: SITE, send, only })).toEqual({ considered: 1, sent: 1, empty: 0, failed: 0, capped: false });
    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toBe(a.email);
    expect(sent[0]!.subject).toMatch(/^\d+ events? in the next 7 days for your goals and interests$/);
    expect(sent[0]!.text).toContain("SIEM night (digest), Digest Circle");
    expect(sent[0]!.text).not.toContain("Cancelled night");
    expect(sent[0]!.text).not.toContain("Too far ahead");
    expect(sent[0]!.idempotencyKey).toBe(digestKey(a.userId, WEEK));
    const token = (await settingsOf(a.userId)).emailOffToken!;
    expect(sent[0]!.offUrl).toBe(`${SITE}/api/email/off?t=${token}&k=events`);
    expect(await weeks(a.userId)).toEqual([WEEK]);
    expect(await appEmailsSent({ db: d(), now: MONDAY })).toBe(1);
    // Tuesday's catch-up skips them: one a week.
    expect((await runEventsDigests({ db: d(), now: TUESDAY, site: SITE, send, only })).considered).toBe(0);
    expect(sent).toHaveLength(1);
    // Download your data lists the week it went out.
    expect((await exportTimetable(a.userId, d())).digestWeeks).toEqual([WEEK]);
  });

  it("sends nothing and keeps no row on a week with no match, so a later day can still send", async () => {
    const a = await person();
    await db!.update(schema.users).set({ city: null }).where(eq(schema.users.id, a.userId));
    const { sent, send } = sender();
    expect(await runEventsDigests({ db: d(), now: MONDAY, site: SITE, send, only: [a.userId] })).toEqual({ considered: 1, sent: 0, empty: 1, failed: 0, capped: false });
    expect(sent).toEqual([]);
    expect(await weeks(a.userId)).toEqual([]);
    expect(await appEmailsSent({ db: d(), now: MONDAY })).toBe(0);
  });

  it("never takes more than its share of the day's budget, and leaves the rest for the weekly email", async () => {
    await event(1);
    const people = [];
    for (let i = 0; i < 3; i++) people.push(await person());
    const only = people.map((p) => p.userId);
    // The day already has share - 1 app emails: one more digest fits.
    await db!.insert(schema.appEmailDays).values({ day: DAYS[0]!, sent: APP_EMAIL_DIGEST_SHARE - 1 });
    const { sent, send } = sender();
    const r = await runEventsDigests({ db: d(), now: MONDAY, site: SITE, send, only, cap: 1_000 });
    expect(r).toMatchObject({ sent: 1, capped: true });
    expect(sent).toHaveLength(1);
    expect(await appEmailsSent({ db: d(), now: MONDAY })).toBe(APP_EMAIL_DIGEST_SHARE);
    // A smaller cap stops the run after that many, whatever the database says.
    await db!.delete(schema.appEmailDays).where(inArray(schema.appEmailDays.day, DAYS));
    const two = sender();
    expect(await runEventsDigests({ db: d(), now: TUESDAY, site: SITE, send: two.send, only, cap: 1 })).toMatchObject({ sent: 1, capped: true });
  });

  it("gives back the week and the budget when the send is refused outright, and keeps both when it may have gone out", async () => {
    await event(1);
    const refused = await person();
    const { send } = sender(false);
    expect(await runEventsDigests({ db: d(), now: MONDAY, site: SITE, send, only: [refused.userId] })).toMatchObject({ sent: 0, failed: 1 });
    expect(await weeks(refused.userId)).toEqual([]);
    expect(await appEmailsSent({ db: d(), now: MONDAY })).toBe(0);
    const unsure = await person();
    let tries = 0;
    const maybe: DigestSend = async () => {
      tries++;
      return { ok: false, maybeSent: true };
    };
    expect(await runEventsDigests({ db: d(), now: MONDAY, site: SITE, send: maybe, only: [unsure.userId] })).toMatchObject({ sent: 0, failed: 1 });
    expect(tries).toBe(2);
    expect(await weeks(unsure.userId)).toEqual([WEEK]);
    expect(await appEmailsSent({ db: d(), now: MONDAY })).toBe(1);
  });

  it("turns on and off from the switch, only for the person's own row", async () => {
    const [u] = await db!.insert(schema.users).values({ email: `${run}-${n++}@example.test` }).returning({ id: schema.users.id });
    userIds.push(u.id);
    expect(await eventsDigestOn(u.id, d())).toBe(false);
    expect(await setEventsDigest(u.id, { on: "yes" }, { db: d() })).toEqual({ ok: false, error: "invalid" });
    expect(await setEventsDigest(u.id, { on: true }, { db: d() })).toEqual({ ok: true });
    expect(await eventsDigestOn(u.id, d())).toBe(true);
    // A first save makes the row with a new user's defaults, not the column's "Only you".
    expect((await settingsOf(u.id)).profileVisibility).toBe("connections");
    expect(await setEventsDigest(u.id, { on: false }, { db: d() })).toEqual({ ok: true });
    expect(await eventsDigestOn(u.id, d())).toBe(false);
  });

  it("turns off from the email's token: once when nothing else uses it, and keeps it while the weekly email is on", async () => {
    await event(1);
    const a = await person();
    const b = await person({ weekly: true });
    await runEventsDigests({ db: d(), now: MONDAY, site: SITE, send: sender().send, only: [a.userId, b.userId] });
    const ta = (await settingsOf(a.userId)).emailOffToken!;
    const tb = (await settingsOf(b.userId)).emailOffToken!;
    await turnOffEventsDigest("x".repeat(43), d());
    await turnOffEventsDigest("not a token", d());
    expect((await settingsOf(a.userId)).eventsDigest).toBe(true);
    await turnOffEventsDigest(ta, d());
    await turnOffEventsDigest(tb, d());
    const sa = await settingsOf(a.userId);
    const sb = await settingsOf(b.userId);
    expect(sa.eventsDigest).toBe(false);
    expect(sa.emailOffToken).not.toBe(ta);
    expect(sb.eventsDigest).toBe(false);
    expect(sb.emailWeeklySummary).toBe(true);
    expect(sb.emailOffToken).toBe(tb);
  });
});
