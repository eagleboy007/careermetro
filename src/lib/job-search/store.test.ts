import { eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "@/db/schema";
import { EXPORT_VERSION, exportAccountData } from "@/lib/account/export";
import { JOB_SEARCH_CHANGES_PER_DAY } from "@/lib/schemas/constants";
import { noticeCountdown, suggestedCanJoin } from "./rules";
import { exportJobSearch, JOB_SEARCH_MESSAGES, jobSearchFor, jobSearchOn, setJobSearch, setNotice } from "./store";

vi.mock("server-only", () => ({}));

// Job search switch and notice period (docs/plans/job-search-plan.md) against a real Postgres with migrations applied.
// Every person here is made up.
const url = process.env.TEST_DATABASE_URL;
const sqlClient = url ? postgres(url, { max: 4, onnotice: () => {} }) : null;
const db = sqlClient ? drizzle(sqlClient, { schema }) : null;

describe.skipIf(!db)("job search store (database)", () => {
  const run = `jobsearch${Date.now()}`;
  const userIds: string[] = [];
  const lines: string[] = [];
  let n = 0;
  // 20 Oct 2026, 23:00 in India (17:30 UTC): India's date is the 20th whatever the server's time zone.
  const now = new Date("2026-10-20T17:30:00Z");
  const person = async () => {
    const [u] = await db!
      .insert(schema.users)
      .values({ email: `${run}-${n}@example.com`, authSubject: `${run}-${n++}`, name: "Asha Example" })
      .returning({ id: schema.users.id });
    userIds.push(u.id);
    return u.id;
  };
  const rowOf = async (id: string) => (await db!.select().from(schema.userSettings).where(eq(schema.userSettings.userId, id)))[0];

  beforeEach(() => {
    for (const level of ["log", "warn", "error"] as const) vi.spyOn(console, level).mockImplementation((line: unknown) => void lines.push(String(line)));
  });
  afterEach(() => vi.restoreAllMocks());
  afterAll(async () => {
    if (userIds.length) await db!.delete(schema.users).where(inArray(schema.users.id, userIds));
    await sqlClient?.end();
    // The switch, the days and the date never reach a log.
    expect(lines.join("\n")).not.toMatch(/2026-10-0|notice|job_search|Asha/);
  });

  it("starts everyone looking, with no row and no notice period", async () => {
    const me = await person();
    expect(await jobSearchOn(me, db!)).toBe(true);
    expect(await jobSearchFor(me, db!)).toEqual({ on: true, noticeDays: null, resignedOn: null });
    expect(await rowOf(me)).toBeUndefined();
  });

  it("turns job search off and on for that person only, and a first save keeps a new user's other defaults", async () => {
    const me = await person();
    const other = await person();
    expect(await setJobSearch(me, false, { db: db!, now })).toEqual({ ok: true, view: { on: false, noticeDays: null, resignedOn: null } });
    expect(await jobSearchOn(me, db!)).toBe(false);
    expect(await jobSearchOn(other, db!)).toBe(true);
    expect(await rowOf(me)).toMatchObject({ jobSearch: false, profileVisibility: "connections", gapsVisibleTo: "connections", companiesCanFind: false });
    expect(await setJobSearch(me, true, { db: db!, now })).toMatchObject({ ok: true, view: { on: true } });
    expect(await jobSearchOn(me, db!)).toBe(true);
  });

  it("keeps the person's other settings when it changes an existing row", async () => {
    const me = await person();
    await db!.insert(schema.userSettings).values({ userId: me, profileVisibility: "signed_in", companiesCanFind: true });
    await setJobSearch(me, false, { db: db!, now });
    expect(await rowOf(me)).toMatchObject({ jobSearch: false, profileVisibility: "signed_in", companiesCanFind: true });
  });

  it("saves the days and the resignation date, works out the countdown in India time, and clears it", async () => {
    const me = await person();
    expect(await setNotice(me, { days: 60, resignedOn: null }, { db: db!, now })).toEqual({ ok: true, view: { on: true, noticeDays: 60, resignedOn: null } });
    // At 23:00 in India the 21st is still in the future; the 20th, today, is allowed.
    expect(await setNotice(me, { days: 60, resignedOn: "2026-10-21" }, { db: db!, now })).toEqual({ ok: false, error: "future" });
    expect(await setNotice(me, { days: 60, resignedOn: "2026-10-20" }, { db: db!, now })).toMatchObject({ ok: true });
    // Just after midnight in India it is already the 21st.
    expect(await setNotice(me, { days: 60, resignedOn: "2026-10-21" }, { db: db!, now: new Date("2026-10-20T18:31:00Z") })).toMatchObject({ ok: true });
    const saved = await setNotice(me, { days: 60, resignedOn: "2026-10-01" }, { db: db!, now });
    expect(saved).toEqual({ ok: true, view: { on: true, noticeDays: 60, resignedOn: "2026-10-01" } });
    const view = await jobSearchFor(me, db!);
    expect(noticeCountdown(view.resignedOn!, view.noticeDays!, "2026-10-20")).toEqual({ lastDay: "2026-11-30", joinFrom: "2026-12-01", left: 41, served: 32 });
    expect(suggestedCanJoin(view, "2026-10-20")).toBe("60");
    // Clearing the date stops the countdown and keeps the days.
    expect(await setNotice(me, { days: 60, resignedOn: null }, { db: db!, now })).toMatchObject({ ok: true, view: { noticeDays: 60, resignedOn: null } });
    expect(suggestedCanJoin(await jobSearchFor(me, db!), "2026-10-20")).toBeNull();
  });

  it("refuses a date without days, other days and bad dates, and the database refuses them too", async () => {
    const me = await person();
    expect(await setNotice(me, { days: null, resignedOn: "2026-10-01" }, { db: db!, now })).toEqual({ ok: false, error: "days" });
    expect(JOB_SEARCH_MESSAGES.days).toBe("Pick your notice period first.");
    expect(await setNotice(me, { days: 45, resignedOn: null }, { db: db!, now })).toEqual({ ok: false, error: "invalid" });
    expect(await setNotice(me, { days: 30, resignedOn: "2026-02-30" }, { db: db!, now })).toEqual({ ok: false, error: "invalid" });
    expect(await setJobSearch(me, "off", { db: db!, now })).toEqual({ ok: false, error: "invalid" });
    expect(await rowOf(me)).toBeUndefined();
    await expect(db!.insert(schema.userSettings).values({ userId: me, noticeDays: 45 })).rejects.toThrow();
    await expect(db!.insert(schema.userSettings).values({ userId: me, resignedOn: "2026-10-01" })).rejects.toThrow();
  });

  it(`allows ${JOB_SEARCH_CHANGES_PER_DAY} changes a day per person, then says so and changes nothing`, async () => {
    const me = await person();
    for (let i = 0; i < JOB_SEARCH_CHANGES_PER_DAY; i++) expect((await setJobSearch(me, i % 2 === 1, { db: db!, now })).ok).toBe(true);
    // The last one was on; the next, off, is refused, and the notice card counts toward the same limit.
    expect(await setJobSearch(me, false, { db: db!, now })).toEqual({ ok: false, error: "limit" });
    expect(await setNotice(me, { days: 30, resignedOn: null }, { db: db!, now })).toEqual({ ok: false, error: "limit" });
    expect(JOB_SEARCH_MESSAGES.limit).toMatch(/Try again tomorrow/);
    expect(await jobSearchFor(me, db!)).toEqual({ on: true, noticeDays: null, resignedOn: null });
  });

  it("is in Download your data, and goes with the account", async () => {
    const me = await person();
    const never = await person();
    await setJobSearch(me, false, { db: db!, now });
    await setNotice(me, { days: 90, resignedOn: "2026-10-05" }, { db: db!, now });
    const data = (await exportAccountData(me, db!))!;
    expect(EXPORT_VERSION).toBe(29);
    expect(data.exportVersion).toBe(29);
    expect(data.jobSearch).toEqual({ lookingForAJob: false, noticeDays: 90, resignedOn: "2026-10-05" });
    expect(await exportJobSearch(never, db!)).toEqual({ lookingForAJob: true, noticeDays: null, resignedOn: null });
    await db!.delete(schema.users).where(eq(schema.users.id, me));
    expect(await rowOf(me)).toBeUndefined();
  });
});
