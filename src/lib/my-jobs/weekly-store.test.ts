import { eq, inArray, like } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "@/db/schema";
import { setJobStatus, updateJob } from "./store";
import { runWeeklyEmails, turnOffWeeklyEmail, weeklyFor, type WeeklySend } from "./weekly-store";

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

  beforeEach(() => {
    for (const level of ["log", "warn", "error"] as const) vi.spyOn(console, level).mockImplementation((line: unknown) => void lines.push(String(line)));
  });
  afterEach(() => vi.restoreAllMocks());
  afterAll(async () => {
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

  it("stops at the sender's daily limit, and the next day sends the rest", async () => {
    const a = await person();
    const b = await person();
    const only = [a.userId, b.userId];
    let calls = 0;
    const limited: WeeklySend = async () => {
      calls++;
      return { ok: false, limited: true };
    };
    expect(await runWeeklyEmails({ db: d(), now: MONDAY, site: "https://careermetro.test", send: limited, only })).toMatchObject({ sent: 0, failed: 1, capped: true });
    expect(calls).toBe(1);
    const rest = sender();
    expect(await runWeeklyEmails({ db: d(), now: TUESDAY, site: "https://careermetro.test", send: rest.send, only })).toMatchObject({ sent: 2, capped: false });
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
