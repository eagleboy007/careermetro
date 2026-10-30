import { eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, describe, expect, it, vi } from "vitest";
import * as schema from "@/db/schema";
import { mockQuestions } from "@/content";
import { EXPORT_VERSION, exportAccountData } from "@/lib/account/export";
import { setElite } from "@/lib/elite/store";
import { TIMED_TESTS_PER_DAY } from "@/lib/schemas";
import { NO_PICK } from "./rules";
import { finishTimedTest, mockPageFor, pickTimedTest, startTimedTest } from "./store";

vi.mock("server-only", () => ({}));

// Interview prep (FR-50 part 2) against a real Postgres with migrations applied. Every person here is made up. The
// unreviewed multiple-choice questions are allowed, as on every deployment but production.
const url = process.env.TEST_DATABASE_URL;
const sqlClient = url ? postgres(url, { max: 4, onnotice: () => {} }) : null;
const db = sqlClient ? drizzle(sqlClient, { schema }) : null;
const answerOf = new Map(mockQuestions.flatMap((q) => (q.kind === "choice" ? [[q.id, q.answer] as const] : [])));
const deps = (now?: Date) => ({ db: db!, now, allowUnreviewed: true });

describe.skipIf(!db)("interview prep store (database)", () => {
  const run = `mock${Date.now()}`;
  const userIds: string[] = [];
  let n = 0;
  const person = async (elite = true) => {
    const [u] = await db!
      .insert(schema.users)
      .values({ email: `${run}-${n}@example.com`, authSubject: `${run}-${n++}`, name: "Asha Example" })
      .returning({ id: schema.users.id });
    userIds.push(u.id);
    if (elite) expect((await setElite(u.id, true, { db: db! })).ok).toBe(true);
    return u.id;
  };
  const rowOf = async (id: string) => (await db!.select().from(schema.timedTests).where(eq(schema.timedTests.id, id)))[0];

  afterAll(async () => {
    if (userIds.length) await db!.delete(schema.users).where(inArray(schema.users.id, userIds));
    await sqlClient?.end();
  });

  it("opens 5 bank questions on Free, starts no test and keeps none", async () => {
    const me = await person(false);
    const page = await mockPageFor(me, null, deps());
    expect(page.elite).toBe(false);
    expect(page.role.slug).toBe("data-analyst");
    expect(page.bank.items.filter((q) => q.open)).toHaveLength(5);
    expect(page.bank.items.length).toBeGreaterThan(5);
    expect(page.test).toBeNull();
    expect(await startTimedTest(me, { roleSlug: "data-analyst" }, deps())).toEqual({ ok: false, error: "not_elite" });
    expect(await db!.select().from(schema.timedTests).where(eq(schema.timedTests.userId, me))).toHaveLength(0);
  });

  it("starts a test of 12 for the role, without the answers, and the page carries on with it", async () => {
    const me = await person();
    const start = new Date();
    const out = await startTimedTest(me, { roleSlug: "data-analyst" }, deps(start));
    if (!out.ok) throw new Error(out.error);
    expect(out.test.questions).toHaveLength(12);
    expect(out.test.picks).toEqual(Array(12).fill(null));
    expect(out.test.secondsLeft).toBe(900);
    expect(JSON.stringify(out.test)).not.toMatch(/"answer"|explanation/);
    const row = await rowOf(out.test.id);
    expect(row).toMatchObject({ userId: me, roleSlug: "data-analyst", picks: Array(12).fill(NO_PICK), endedAt: null, right: null });
    expect(row.questionIds).toEqual(out.test.questions.map((q) => q.id));

    const page = await mockPageFor(me, "devops-engineer", deps(new Date(start.getTime() + 60_000)));
    expect(page.elite).toBe(true);
    expect(page.role.slug).toBe("devops-engineer");
    expect(page.bank.items.every((q) => q.open)).toBe(true);
    expect(page.test?.id).toBe(out.test.id);
    expect(page.test?.secondsLeft).toBe(840);
  });

  it("refuses a role without enough questions and one that doesn't exist", async () => {
    const me = await person();
    expect(await startTimedTest(me, { roleSlug: "grc-manager" }, deps())).toEqual({ ok: false, error: "no_test" });
    expect(await startTimedTest(me, { roleSlug: "astronaut" }, deps())).toEqual({ ok: false, error: "invalid" });
    expect(await startTimedTest(me, "data-analyst", deps())).toEqual({ ok: false, error: "invalid" });
  });

  it("counts picks for the person's own test, its own questions and real options, within the 15 minutes only", async () => {
    const me = await person();
    const other = await person();
    const start = new Date();
    const out = await startTimedTest(me, { roleSlug: "data-analyst" }, deps(start));
    if (!out.ok) throw new Error(out.error);
    const ids = out.test.questions.map((q) => q.id);
    const at = (s: number) => new Date(start.getTime() + s * 1000);

    // Right on the first five, wrong on the sixth, changed on the seventh.
    for (const [i, id] of ids.slice(0, 5).entries()) expect(await pickTimedTest(me, { testId: out.test.id, questionId: id, pick: answerOf.get(id) }, deps(at(10 + i)))).toEqual({ ok: true });
    const wrong = (answerOf.get(ids[5])! + 1) % 4;
    expect(await pickTimedTest(me, { testId: out.test.id, questionId: ids[5], pick: wrong }, deps(at(30)))).toEqual({ ok: true });
    expect(await pickTimedTest(me, { testId: out.test.id, questionId: ids[6], pick: wrong === 0 ? 1 : 0 }, deps(at(31)))).toEqual({ ok: true });
    expect(await pickTimedTest(me, { testId: out.test.id, questionId: ids[6], pick: answerOf.get(ids[6]) }, deps(at(32)))).toEqual({ ok: true });

    // Not one of this test's questions, an option that isn't there, someone else's test.
    const outside = mockQuestions.find((q) => q.kind === "choice" && !ids.includes(q.id))!;
    expect(await pickTimedTest(me, { testId: out.test.id, questionId: outside.id, pick: 0 }, deps(at(40)))).toEqual({ ok: false, error: "invalid" });
    expect(await pickTimedTest(me, { testId: out.test.id, questionId: ids[0], pick: 4 }, deps(at(40)))).toEqual({ ok: false, error: "invalid" });
    expect(await pickTimedTest(other, { testId: out.test.id, questionId: ids[7], pick: 0 }, deps(at(40)))).toEqual({ ok: false, error: "not_found" });
    expect(await finishTimedTest(other, { testId: out.test.id }, deps(at(40)))).toEqual({ ok: false, error: "not_found" });

    // Past the 15 minutes: refused, and nothing changes.
    const before = (await rowOf(out.test.id)).picks;
    expect(await pickTimedTest(me, { testId: out.test.id, questionId: ids[8], pick: answerOf.get(ids[8]) }, deps(at(15 * 60 + 1)))).toEqual({ ok: false, error: "over" });
    expect((await rowOf(out.test.id)).picks).toEqual(before);
    expect(before.filter((p) => p !== NO_PICK)).toHaveLength(7);
    // The page no longer offers it.
    expect((await mockPageFor(me, null, deps(at(15 * 60 + 1)))).test).toBeNull();

    // A late finish ends it at the deadline and counts what came in time: 6 right.
    const done = await finishTimedTest(me, { testId: out.test.id }, deps(at(20 * 60)));
    if (!done.ok) throw new Error(done.error);
    expect(done.review.right).toBe(6);
    expect(done.review.total).toBe(12);
    expect(done.review.secondsUsed).toBe(900);
    expect(done.review.items).toHaveLength(12);
    expect(done.review.items[5]).toMatchObject({ pick: wrong, answer: answerOf.get(ids[5]) });
    expect(done.review.items[11].pick).toBeNull();
    const row = await rowOf(out.test.id);
    expect(row.right).toBe(6);
    expect(row.endedAt?.toISOString()).toBe(at(900).toISOString());

    // Finishing again shows the same review; a finished test takes no picks.
    expect(await finishTimedTest(me, { testId: out.test.id }, deps(at(21 * 60)))).toEqual(done);
    expect(await pickTimedTest(me, { testId: out.test.id, questionId: ids[11], pick: 0 }, deps(at(60)))).toEqual({ ok: false, error: "over" });
  });

  it("ends an early finish at once", async () => {
    const me = await person();
    const start = new Date();
    const out = await startTimedTest(me, { roleSlug: "data-analyst" }, deps(start));
    if (!out.ok) throw new Error(out.error);
    const done = await finishTimedTest(me, { testId: out.test.id }, deps(new Date(start.getTime() + 125_000)));
    expect(done).toMatchObject({ ok: true, review: { right: 0, secondsUsed: 125 } });
  });

  it("stops a Free person who had Elite, and allows 10 starts a day", async () => {
    const me = await person();
    for (let i = 0; i < TIMED_TESTS_PER_DAY; i++) expect((await startTimedTest(me, { roleSlug: "data-analyst" }, deps())).ok).toBe(true);
    expect(await startTimedTest(me, { roleSlug: "data-analyst" }, deps())).toEqual({ ok: false, error: "limit" });
    const [last] = await db!.select().from(schema.timedTests).where(eq(schema.timedTests.userId, me)).limit(1);
    await setElite(me, false, { db: db! });
    expect(await pickTimedTest(me, { testId: last.id, questionId: last.questionIds[0], pick: 0 }, deps())).toEqual({ ok: false, error: "not_elite" });
    expect(await finishTimedTest(me, { testId: last.id }, deps())).toEqual({ ok: false, error: "not_elite" });
  });

  it("is in Download your data, and goes with the account", async () => {
    const me = await person();
    const out = await startTimedTest(me, { roleSlug: "data-analyst" }, deps());
    if (!out.ok) throw new Error(out.error);
    await finishTimedTest(me, { testId: out.test.id }, deps());
    const data = (await exportAccountData(me, db!))!;
    expect(EXPORT_VERSION).toBe(36);
    expect(data.exportVersion).toBe(36);
    expect(data.timedTests).toHaveLength(1);
    expect(data.timedTests[0]).toMatchObject({ roleSlug: "data-analyst", right: 0, picks: Array(12).fill(NO_PICK) });
    await db!.delete(schema.users).where(eq(schema.users.id, me));
    expect(await rowOf(out.test.id)).toBeUndefined();
  });
});
