import { eq, inArray, like } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "@/db/schema";
import { appEmailsSent } from "@/lib/email/budget";
import { APP_EMAIL_DAILY_BUDGET } from "@/lib/schemas/constants";
import { setJobStatus, updateJob } from "./store";
import { runWeeklyEmails, turnOffWeeklyEmail, weeklyFor, weeklyKey, type WeeklySend } from "./weekly-store";

vi.mock("server-only", () => ({}));

const url = process.env.TEST_DATABASE_URL;
const sqlClient = url ? postgres(url, { max: 4, onnotice: () => {} }) : null;
const db = sqlClient ? drizzle(sqlClient, { schema }) : null;
type Db = NonNullable<Parameters<typeof weeklyFor>[1]>["db"];

describe.skipIf(!db)("the weekly My jobs email (database)", () => {
  const run = `weekly${Date.now()}`;
  const userIds: string[] = [];
  const lines: string[] = [];
  let n = 0;
  // Monday 26 Oct 2026, 08:30 IST.
  const MONDAY = new Date("2026-10-26T03:00:00Z");
  const TUESDAY = new Date("2026-10-27T03:00:00Z");
  const d = () => db as unknown as Db;

  // The shared app-email budget is one count a day for the whole app, so each test starts these days at zero.
  const DAYS = ["2026-10-26", "2026-10-27", "2026-10-28"];
  beforeEach(async () => {
    for (const level of ["log", "warn", "error"] as const) vi.spyOn(console, level).mockImplementation((line: unknown) => void lines.push(String(line)));
    await db!.delete(schema.appEmailDays).where(inArray(schema.appEmailDays.day, DAYS));
  });
  afterEach(() => vi.restoreAllMocks());
  afterAll(async () => {
    await db!.delete(schema.appEmailDays).where(inArray(schema.appEmailDays.day, DAYS));
    if (userIds.length) await db!.delete(schema.users).where(inArray(schema.users.id, userIds));
    await db!.delete(schema.jobPosts).where(like(schema.jobPosts.boardToken, `${run}%`));
    await sqlClient!.end();
    // Nothing about a person or a job reaches a log line.
    const all = lines.join("\n");
    for (const words of [run, "Weekly Labs", "Analyst (weekly)"]) expect(all).not.toContain(words);
  });

  /** A person with the weekly email on, and one Applied job from 10 days before Monday. */
  async function person({ on = true, applied = true }: { on?: boolean; applied?: boolean } = {}) {
    const email = `${run}-${n++}@example.test`;
    const [u] = await db!.insert(schema.users).values({ email, firstName: "Priya" }).returning({ id: schema.users.id });
    userIds.push(u.id);
    await db!.insert(schema.userSettings).values({ userId: u.id, emailWeeklySummary: on });
    const [p] = await db!
      .insert(schema.jobPosts)
      .values({ ats: "lever", boardToken: run, externalId: `${run}-${n++}`, url: "https://jobs.lever.co/example/1", title: "Analyst (weekly)", company: "Weekly Labs", city: "Pune", requiredSkillIds: ["sql"] })
      .returning({ id: schema.jobPosts.id });
    const at = new Date(MONDAY.getTime() - (applied ? 10 : 2) * 86_400_000);
    await db!.insert(schema.jobSaves).values({ userId: u.id, jobPostId: p.id, stage: 1, appliedAt: at, statusAt: at, updatedAt: at });
    return { userId: u.id, postId: p.id, email };
  }
  const sender = (ok = true) => {
    const sent: Parameters<WeeklySend>[0][] = [];
    const send: WeeklySend = async (m) => {
      sent.push(m);
      return { ok };
    };
    return { sent, send };
  };
  const rows = async (userId: string) => db!.select().from(schema.weeklyEmails).where(eq(schema.weeklyEmails.userId, userId));
  const tokenOf = async (userId: string) => (await db!.select({ t: schema.userSettings.emailOffToken }).from(schema.userSettings).where(eq(schema.userSettings.userId, userId)))[0]!.t;

  it("sends once a week to people who turned it on, and never on an empty week", async () => {
    const a = await person();
    const quiet = await person({ applied: false });
    const off = await person({ on: false });
    const only = [a.userId, quiet.userId, off.userId];
    const { sent, send } = sender();
    expect(await runWeeklyEmails({ db: d(), now: MONDAY, site: "https://careermetro.test", send, only })).toEqual({ considered: 2, sent: 1, empty: 1, failed: 0, capped: false });
    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toBe(a.email);
    expect(sent[0]!.subject).toBe("1 job waiting on a reply");
    expect(sent[0]!.text).toContain("Analyst (weekly), Weekly Labs");
    expect(sent[0]!.offUrl).toBe(`https://careermetro.test/api/email/off?t=${await tokenOf(a.userId)}`);
    expect(await tokenOf(a.userId)).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect((await rows(a.userId)).map((r) => r.week)).toEqual(["2026-10-26"]);
    expect((await rows(quiet.userId)).map((r) => r.week)).toEqual(["2026-10-26"]);
    expect(await rows(off.userId)).toEqual([]);
    // Tuesday's run skips them all: sent, or found empty, this India week.
    const again = sender();
    expect((await runWeeklyEmails({ db: d(), now: TUESDAY, site: "https://careermetro.test", send: again.send, only })).sent).toBe(0);
    expect(again.sent).toHaveLength(0);
  });

  it("tries a failed send again the next day, and stops at the cap", async () => {
    const a = await person();
    const b = await person();
    const only = [a.userId, b.userId];
    const failing = sender(false);
    expect(await runWeeklyEmails({ db: d(), now: MONDAY, site: "https://careermetro.test", send: failing.send, only })).toMatchObject({ sent: 0, failed: 2 });
    const capped = sender();
    expect(await runWeeklyEmails({ db: d(), now: TUESDAY, site: "https://careermetro.test", send: capped.send, only, cap: 1 })).toMatchObject({ sent: 1, capped: true });
    const rest = sender();
    expect(await runWeeklyEmails({ db: d(), now: new Date("2026-10-28T03:00:00Z"), site: "https://careermetro.test", send: rest.send, only })).toMatchObject({ sent: 1, capped: false });
    expect([...capped.sent, ...rest.sent].map((m) => m.to).sort()).toEqual([a.email, b.email].sort());
  });

  it("stops at the sender's daily quota, and the next day sends the rest", async () => {
    const a = await person();
    const b = await person();
    const only = [a.userId, b.userId];
    let calls = 0;
    const quota: WeeklySend = async () => {
      calls++;
      return { ok: false, quota: true };
    };
    expect(await runWeeklyEmails({ db: d(), now: MONDAY, site: "https://careermetro.test", send: quota, only })).toMatchObject({ sent: 0, failed: 1, capped: true });
    expect(calls).toBe(1);
    // Nothing went out, so the week and the budget are free again.
    expect(await rows(a.userId)).toEqual([]);
    expect(await rows(b.userId)).toEqual([]);
    expect(await appEmailsSent({ db: d(), now: MONDAY })).toBe(0);
    const rest = sender();
    expect(await runWeeklyEmails({ db: d(), now: TUESDAY, site: "https://careermetro.test", send: rest.send, only })).toMatchObject({ sent: 2, capped: false });
    expect(await appEmailsSent({ db: d(), now: TUESDAY })).toBe(2);
  });

  it("sends each with its idempotency key, and draws from the shared app-email budget", async () => {
    const a = await person();
    const b = await person();
    const only = [a.userId, b.userId];
    // Another app email (later, the events digest) already took all but one of today's budget.
    await db!.insert(schema.appEmailDays).values({ day: "2026-10-26", sent: APP_EMAIL_DAILY_BUDGET - 1 });
    const first = sender();
    expect(await runWeeklyEmails({ db: d(), now: MONDAY, site: "https://careermetro.test", send: first.send, only })).toMatchObject({ sent: 1, capped: true });
    expect(await appEmailsSent({ db: d(), now: MONDAY })).toBe(APP_EMAIL_DAILY_BUDGET);
    const to = first.sent[0]!.to === a.email ? a : b;
    expect(first.sent[0]!.idempotencyKey).toBe(weeklyKey(to.userId, "2026-10-26"));
    expect(first.sent[0]!.idempotencyKey).toBe(`weekly-${to.userId}-2026-10-26`);
    // Spent: nobody else gets one today.
    const none = sender();
    expect(await runWeeklyEmails({ db: d(), now: MONDAY, site: "https://careermetro.test", send: none.send, only })).toMatchObject({ sent: 0, capped: true });
    expect(none.sent).toHaveLength(0);
  });

  it("starts with the people sent longest ago, so the same people aren't always left at the end", async () => {
    const a = await person();
    const b = await person();
    const [low, high] = [a, b].sort((x, y) => (x.userId < y.userId ? -1 : 1));
    // The later id was sent longer ago, so it goes first even though its id sorts last.
    await db!.insert(schema.weeklyEmails).values([
      { userId: low!.userId, week: "2026-10-19" },
      { userId: high!.userId, week: "2026-10-12" },
    ]);
    const one = sender();
    expect(await runWeeklyEmails({ db: d(), now: MONDAY, site: "https://careermetro.test", send: one.send, only: [a.userId, b.userId], cap: 1 })).toMatchObject({ sent: 1, capped: true });
    expect(one.sent.map((m) => m.to)).toEqual([high!.email]);
    // Someone never sent goes before both.
    const c = await person();
    const next = sender();
    expect(await runWeeklyEmails({ db: d(), now: TUESDAY, site: "https://careermetro.test", send: next.send, only: [a.userId, b.userId, c.userId], cap: 1 })).toMatchObject({ sent: 1 });
    expect(next.sent.map((m) => m.to)).toEqual([c.email]);
  });

  it("never sends twice when a send may have gone out: one more try with the same key, then the week stays claimed", async () => {
    const a = await person();
    const only = [a.userId];
    const keys: string[] = [];
    const unsure: WeeklySend = async (m) => {
      keys.push(m.idempotencyKey);
      return { ok: false, maybeSent: true };
    };
    expect(await runWeeklyEmails({ db: d(), now: MONDAY, site: "https://careermetro.test", send: unsure, only })).toMatchObject({ sent: 0, failed: 1 });
    expect(keys).toEqual([weeklyKey(a.userId, "2026-10-26"), weeklyKey(a.userId, "2026-10-26")]);
    expect((await rows(a.userId)).map((r) => r.week)).toEqual(["2026-10-26"]);
    expect(await appEmailsSent({ db: d(), now: MONDAY })).toBe(1);
    // Tuesday's run leaves them alone.
    const again = sender();
    await runWeeklyEmails({ db: d(), now: TUESDAY, site: "https://careermetro.test", send: again.send, only });
    expect(again.sent).toHaveLength(0);
    // An unsure first try that the second (same key) confirms counts as sent.
    const b = await person();
    let tries = 0;
    const late: WeeklySend = async () => (++tries === 1 ? { ok: false, maybeSent: true } : { ok: true });
    expect(await runWeeklyEmails({ db: d(), now: MONDAY, site: "https://careermetro.test", send: late, only: [b.userId] })).toMatchObject({ sent: 1, failed: 0 });
    expect(tries).toBe(2);
  });

  it("sends one email when two runs go at once", async () => {
    const a = await person();
    const one = sender();
    const two = sender();
    const runs = await Promise.all([one, two].map((s) => runWeeklyEmails({ db: d(), now: MONDAY, site: "https://careermetro.test", send: s.send, only: [a.userId] })));
    expect(runs.reduce((n, r) => n + r.sent, 0)).toBe(1);
    expect(one.sent.length + two.sent.length).toBe(1);
    expect(await appEmailsSent({ db: d(), now: MONDAY })).toBe(1);
  });

  it("turns off from the email's token, once, and an unknown token changes nothing", async () => {
    const a = await person();
    await runWeeklyEmails({ db: d(), now: MONDAY, site: "https://careermetro.test", send: sender().send, only: [a.userId] });
    const token = (await tokenOf(a.userId))!;
    await turnOffWeeklyEmail("x".repeat(43), d());
    await turnOffWeeklyEmail("not a token", d());
    let [s] = await db!.select().from(schema.userSettings).where(eq(schema.userSettings.userId, a.userId));
    expect(s.emailWeeklySummary).toBe(true);
    await turnOffWeeklyEmail(token, d());
    [s] = await db!.select().from(schema.userSettings).where(eq(schema.userSettings.userId, a.userId));
    expect(s.emailWeeklySummary).toBe(false);
    expect(s.emailOffToken).not.toBe(token);
  });

  it("counts waiting from the last status change: a note doesn't move it, a new status does", async () => {
    const a = await person();
    const ref = { kind: "post" as const, postId: a.postId };
    const [before] = await db!.select().from(schema.jobSaves).where(eq(schema.jobSaves.userId, a.userId));
    expect(await updateJob(a.userId, { ref, status: "applied", note: "Called them (weekly)" }, { db: d(), now: MONDAY })).toEqual({ ok: true });
    let [row] = await db!.select().from(schema.jobSaves).where(eq(schema.jobSaves.userId, a.userId));
    expect(row.statusAt!.toISOString()).toBe(before.statusAt!.toISOString());
    expect((await weeklyFor(a.userId, { db: d(), now: MONDAY }))?.waiting).toHaveLength(1);
    expect(await setJobStatus(a.userId, { ref, status: "heard" }, { db: d(), now: MONDAY })).toEqual({ ok: true });
    [row] = await db!.select().from(schema.jobSaves).where(eq(schema.jobSaves.userId, a.userId));
    expect(row.statusAt!.toISOString()).toBe(MONDAY.toISOString());
    expect(await weeklyFor(a.userId, { db: d(), now: MONDAY })).toBeNull();
  });
});
