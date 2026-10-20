import { eq, inArray, like } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "@/db/schema";
import { EXPORT_VERSION, exportAccountData } from "@/lib/account/export";
import { clearStageInput, departureExport, saveInput, stageInput } from "@/lib/schemas";
import { DEPARTURE_CHANGES_PER_DAY } from "@/lib/schemas/constants";
import { LIMITS } from "@/lib/shared-limit";
import { clearOldDepartures, clearStage, DEPARTURE_MESSAGES, departuresBoard, exportDepartures, lastFeedRun, saveRole, setStage } from "./store";

vi.mock("server-only", () => ({}));

describe("save and stage input", () => {
  const id = "6f1c2b9e-0000-4000-8000-000000000001";
  it("takes a post id and a save, or a stage 1 to 4, and nothing else", () => {
    expect(saveInput.safeParse({ postId: id, saved: true }).success).toBe(true);
    expect(saveInput.safeParse({ postId: "not-a-uuid", saved: true }).success).toBe(false);
    expect(saveInput.safeParse({ postId: id, saved: true, userId: id }).success).toBe(false);
    for (const stage of [1, 2, 3, 4]) expect(stageInput.safeParse({ postId: id, stage }).success).toBe(true);
    for (const stage of [0, 5, 1.5, "1"]) expect(stageInput.safeParse({ postId: id, stage }).success).toBe(false);
    expect(clearStageInput.safeParse({ postId: id }).success).toBe(true);
    expect(LIMITS.departureChangesPerUserDay.max).toBe(DEPARTURE_CHANGES_PER_DAY);
    expect(DEPARTURE_CHANGES_PER_DAY).toBe(200);
  });
});

// Saved and Applied on live Departures (docs/plans/departures-live-plan.md) against a real Postgres with migrations
// applied. Every person and company here is made up.
const url = process.env.TEST_DATABASE_URL;
const sqlClient = url ? postgres(url, { max: 4, onnotice: () => {} }) : null;
const db = sqlClient ? drizzle(sqlClient, { schema }) : null;

describe.skipIf(!db)("departures store (database)", () => {
  const run = `deps${Date.now()}`;
  const userIds: string[] = [];
  const runIds: string[] = [];
  const lines: string[] = [];
  let n = 0;
  const now = new Date();
  const DAY = 86_400_000;
  const person = async () => {
    const [u] = await db!
      .insert(schema.users)
      .values({ email: `${run}-${n}@example.com`, authSubject: `${run}-${n++}`, name: "Asha Example" })
      .returning({ id: schema.users.id });
    userIds.push(u.id);
    return u.id;
  };
  const post = async (over: Partial<typeof schema.jobPosts.$inferInsert> = {}) => {
    const [p] = await db!
      .insert(schema.jobPosts)
      .values({
        ats: "lever",
        boardToken: run,
        externalId: `${run}-${n++}`,
        url: "https://jobs.lever.co/example/1",
        title: "Junior data analyst",
        company: "Example Labs",
        city: "Pune",
        requiredSkillIds: ["sql", "excel"],
        ...over,
      })
      .returning({ id: schema.jobPosts.id });
    return p.id;
  };
  const rowOf = async (userId: string, postId: string) =>
    (await db!.select().from(schema.jobSaves).where(eq(schema.jobSaves.userId, userId))).find((r) => r.jobPostId === postId);

  beforeEach(() => {
    for (const level of ["log", "warn", "error"] as const) vi.spyOn(console, level).mockImplementation((line: unknown) => void lines.push(String(line)));
  });
  afterEach(() => vi.restoreAllMocks());
  afterAll(async () => {
    if (userIds.length) await db!.delete(schema.users).where(inArray(schema.users.id, userIds));
    await db!.delete(schema.jobPosts).where(like(schema.jobPosts.boardToken, `${run}%`));
    if (runIds.length) await db!.delete(schema.jobFeedRuns).where(inArray(schema.jobFeedRuns.id, runIds));
    await sqlClient?.end();
    // Titles, saves and stages never reach a log.
    expect(lines.join("\n")).not.toMatch(/Junior data analyst|Example Labs|Asha/);
  });

  it("keeps only one role's posts for ?role=, the person's own included", async () => {
    const me = await person();
    const slug = `${run}-role`;
    const mineOfRole = await post({ roleSlug: slug });
    const other = await post({ roleSlug: `${run}-other` });
    await saveRole(me, { postId: mineOfRole, saved: true }, { db: db!, now });
    await saveRole(me, { postId: other, saved: true }, { db: db!, now });
    const board = await departuresBoard(me, { db: db!, roleSlug: slug });
    expect(board.posts.map((p) => p.id)).toEqual([mineOfRole]);
    expect(board.saved).toEqual([mineOfRole]);
    expect((await departuresBoard(me, { db: db! })).saved).toEqual(expect.arrayContaining([mineOfRole, other]));
  });

  it("saves and unsaves for that person only; another person never sees the list", async () => {
    const me = await person();
    const other = await person();
    const p = await post();
    expect(await saveRole(me, { postId: p, saved: true }, { db: db!, now })).toEqual({ ok: true });
    expect((await rowOf(me, p))?.savedAt).not.toBeNull();
    const mine = await departuresBoard(me, { db: db! });
    expect(mine.saved).toContain(p);
    const theirs = await departuresBoard(other, { db: db! });
    expect(theirs.saved).not.toContain(p);
    expect(theirs.applied.map(([id]) => id)).not.toContain(p);
    // Saving twice is fine; taking it off Saved with no stage deletes the row.
    expect(await saveRole(me, { postId: p, saved: true }, { db: db!, now })).toEqual({ ok: true });
    expect(await saveRole(me, { postId: p, saved: false }, { db: db!, now })).toEqual({ ok: true });
    expect(await rowOf(me, p)).toBeUndefined();
    // Another person taking it off Saved changes nothing of mine.
    await saveRole(me, { postId: p, saved: true }, { db: db!, now });
    expect(await saveRole(other, { postId: p, saved: false }, { db: db!, now })).toEqual({ ok: true });
    expect((await rowOf(me, p))?.savedAt).not.toBeNull();
  });

  it("tracks Applied to Offer, keeps the first applied time, and I didn't apply clears it", async () => {
    const me = await person();
    const p = await post();
    expect(await setStage(me, { postId: p, stage: 1 }, { db: db!, now })).toEqual({ ok: true });
    const first = (await rowOf(me, p))!.appliedAt!;
    expect(await setStage(me, { postId: p, stage: 3 }, { db: db!, now: new Date(now.getTime() + DAY) })).toEqual({ ok: true });
    expect(await rowOf(me, p)).toMatchObject({ stage: 3, appliedAt: first, savedAt: null });
    expect((await departuresBoard(me, { db: db! })).applied).toContainEqual([p, 3]);
    expect(await setStage(me, { postId: p, stage: 5 }, { db: db!, now })).toEqual({ ok: false, error: "invalid" });
    expect(await rowOf(me, p)).toMatchObject({ stage: 3 });
    // Saved too: clearing the stage keeps the row for the bookmark.
    await saveRole(me, { postId: p, saved: true }, { db: db!, now });
    expect(await clearStage(me, { postId: p }, { db: db!, now })).toEqual({ ok: true });
    expect(await rowOf(me, p)).toMatchObject({ stage: null, appliedAt: null });
    await saveRole(me, { postId: p, saved: false }, { db: db!, now });
    expect(await rowOf(me, p)).toBeUndefined();
  });

  it("allows stage 1 to 4 only and never a row with neither a save nor a stage, in the table itself", async () => {
    const me = await person();
    const p = await post();
    await expect(db!.insert(schema.jobSaves).values({ userId: me, jobPostId: p, stage: 5 })).rejects.toThrow();
    await expect(db!.insert(schema.jobSaves).values({ userId: me, jobPostId: p })).rejects.toThrow();
  });

  it("keeps a closed post in Saved and Applied, refuses new saves and applications on it, and lets its stage move", async () => {
    const me = await person();
    const kept = await post();
    const closedNew = await post({ closedAt: now });
    await saveRole(me, { postId: kept, saved: true }, { db: db!, now });
    await setStage(me, { postId: kept, stage: 1 }, { db: db!, now });
    await db!.update(schema.jobPosts).set({ closedAt: now }).where(eq(schema.jobPosts.id, kept));
    const board = await departuresBoard(me, { db: db! });
    expect(board.posts.find((x) => x.id === kept)?.closedAt).not.toBeNull();
    expect(board.saved).toContain(kept);
    expect(board.applied).toContainEqual([kept, 1]);
    expect(await setStage(me, { postId: kept, stage: 2 }, { db: db!, now })).toEqual({ ok: true });
    expect(await saveRole(me, { postId: closedNew, saved: true }, { db: db!, now })).toEqual({ ok: false, error: "closed" });
    expect(await setStage(me, { postId: closedNew, stage: 1 }, { db: db!, now })).toEqual({ ok: false, error: "closed" });
    expect(DEPARTURE_MESSAGES.closed).toMatch(/closed on the company's board/);
    // A closed post is not among the open ones shown to someone else.
    const theirs = await departuresBoard(await person(), { db: db! });
    expect(theirs.posts.some((x) => x.id === kept || x.id === closedNew)).toBe(false);
    expect(await saveRole(me, { postId: "6f1c2b9e-0000-4000-8000-00000000dead", saved: true }, { db: db!, now })).toEqual({ ok: false, error: "not_found" });
  });

  it("deletes posts closed over 180 days ago with their saves, keeps newer ones and every open post", async () => {
    const me = await person();
    const old = await post({ closedAt: new Date(now.getTime() - 181 * DAY) });
    const recent = await post({ closedAt: new Date(now.getTime() - 179 * DAY) });
    const open = await post({ firstSeenAt: new Date(now.getTime() - 400 * DAY) });
    for (const p of [old, recent]) await db!.insert(schema.jobSaves).values({ userId: me, jobPostId: p, stage: 1, appliedAt: now });
    const result = await clearOldDepartures(db!, now);
    expect(result.closedPostsDeleted).toBeGreaterThanOrEqual(1);
    const left = await db!.select({ id: schema.jobPosts.id }).from(schema.jobPosts).where(inArray(schema.jobPosts.id, [old, recent, open]));
    expect(left.map((r) => r.id).sort()).toEqual([recent, open].sort());
    expect(await rowOf(me, old)).toBeUndefined();
    expect(await rowOf(me, recent)).toBeDefined();
  });

  it("says Updated from the last run that read a board, not a run where every board failed", async () => {
    const good = new Date(now.getTime() + 60_000);
    const [a] = await db!.insert(schema.jobFeedRuns).values({ startedAt: good, finishedAt: good, boardsOk: 3 }).returning({ id: schema.jobFeedRuns.id });
    const [b] = await db!
      .insert(schema.jobFeedRuns)
      .values({ startedAt: new Date(good.getTime() + 60_000), finishedAt: new Date(good.getTime() + 60_000), boardsOk: 0, boardsFailed: 3 })
      .returning({ id: schema.jobFeedRuns.id });
    runIds.push(a.id, b.id);
    expect((await lastFeedRun(db!))?.getTime()).toBe(good.getTime());
    // Runs over 90 days old go.
    const [c] = await db!.insert(schema.jobFeedRuns).values({ startedAt: new Date(now.getTime() - 91 * DAY) }).returning({ id: schema.jobFeedRuns.id });
    runIds.push(c.id);
    expect((await clearOldDepartures(db!, now)).feedRunsDeleted).toBeGreaterThanOrEqual(1);
    expect(await db!.select().from(schema.jobFeedRuns).where(eq(schema.jobFeedRuns.id, c.id))).toEqual([]);
  });

  it("is in Download your data (version 27), and goes with the account", async () => {
    const me = await person();
    const p = await post({ title: "Reporting analyst", city: "Remote" });
    await saveRole(me, { postId: p, saved: true }, { db: db!, now });
    await setStage(me, { postId: p, stage: 2 }, { db: db!, now });
    const rows = await exportDepartures(me, db!);
    expect(rows).toEqual([
      { title: "Reporting analyst", company: "Example Labs", city: "Remote", url: "https://jobs.lever.co/example/1", saved_at: now.toISOString(), stage: "Heard back", applied_at: now.toISOString(), closed: false },
    ]);
    for (const r of rows) expect(departureExport.safeParse(r).success).toBe(true);
    const data = await exportAccountData(me, db!);
    expect(EXPORT_VERSION).toBe(27);
    expect(data!.exportVersion).toBe(27);
    expect(data!.departures).toEqual(rows);
    // Deleting the account removes its saves (on delete cascade); the post belongs to no one and stays.
    await db!.delete(schema.users).where(eq(schema.users.id, me));
    expect(await db!.select().from(schema.jobSaves).where(eq(schema.jobSaves.userId, me))).toEqual([]);
    expect(await db!.select({ id: schema.jobPosts.id }).from(schema.jobPosts).where(eq(schema.jobPosts.id, p))).toHaveLength(1);
  });
});
