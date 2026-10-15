import { asc, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { skills } from "@/content";
import * as schema from "@/db/schema";
import { exportAccountData, EXPORT_VERSION } from "@/lib/account/export";
import type { FeedbackClient } from "./feedback";
import { clearOldPracticeAnswers, practiceFor, practiceTrendsFor, PRACTICE_MESSAGES, ratePracticeAnswer, startOfIndiaDay, submitPracticeAnswer } from "./store";

vi.mock("server-only", () => ({}));

// Practice (handoff 12h) against a real Postgres with migrations applied. Every person and answer here is made up.
const url = process.env.TEST_DATABASE_URL;
const sqlClient = url ? postgres(url, { max: 4, onnotice: () => {} }) : null;
const db = sqlClient ? drizzle(sqlClient, { schema }) : null;
const DAY = 86_400_000;

const ANSWER = "A tuple cannot change after it is made, so Meera uses tuples for fixed records and lists for growing ones.";
const good = { structure: "Clear order.", specificity: "Add one example.", correctness: "Right idea.", strongerAnswer: "A list can change..." };
const usage = { input_tokens: 900, output_tokens: 350 };

function client(text: string | Error) {
  const create = vi.fn();
  if (text instanceof Error) create.mockRejectedValue(text);
  else create.mockResolvedValue({ model: "claude-opus-5-5", stop_reason: "end_turn", usage, content: [{ type: "text", text }] });
  return { client: { beta: { messages: { create } } } as unknown as FeedbackClient, create };
}

describe.skipIf(!db)("practice store (database)", () => {
  const run = `practice-${Date.now()}`;
  const userIds: string[] = [];
  const lines: string[] = [];
  // Mid-afternoon in India, so the India day is the same date as the UTC one.
  const clock = new Date("2026-10-15T09:00:00Z");

  beforeAll(async () => {
    await db!
      .insert(schema.skills)
      .values(skills.map(({ id, name, category }) => ({ id, name, category })))
      .onConflictDoNothing();
    vi.stubEnv("PRACTICE_DAILY_BUDGET_USD", "1000000");
  });
  beforeEach(() => {
    for (const level of ["log", "warn", "error"] as const) vi.spyOn(console, level).mockImplementation((line: unknown) => void lines.push(String(line)));
  });
  afterAll(async () => {
    vi.unstubAllEnvs();
    if (userIds.length) await db!.delete(schema.users).where(inArray(schema.users.id, userIds));
    await sqlClient!.end();
  });

  async function person(n: string, goals: { skillId: string; status?: "active" | "met" }[] = []) {
    const [row] = await db!.insert(schema.users).values({ email: `${run}-${n}@example.test` }).returning({ id: schema.users.id });
    userIds.push(row.id);
    if (goals.length) await db!.insert(schema.userGoals).values(goals.map((g, i) => ({ userId: row.id, skillId: g.skillId, status: g.status ?? "active", position: i + 1 })));
    return row.id;
  }
  const answersOf = (userId: string) => db!.select().from(schema.practiceAnswers).where(eq(schema.practiceAnswers.userId, userId));

  it("refuses a short answer, an unknown question and a skill that isn't one of the person's goals", async () => {
    const me = await person("refuse", [{ skillId: "python" }]);
    const { client: c, create } = client(JSON.stringify(good));
    const deps = { db: db!, client: c, now: clock };
    expect(await submitPracticeAnswer(me, { questionId: "python-1", answer: "too short" }, deps)).toEqual({ ok: false, message: PRACTICE_MESSAGES.invalid });
    expect(await submitPracticeAnswer(me, { questionId: "python-99", answer: ANSWER }, deps)).toEqual({ ok: false, message: PRACTICE_MESSAGES.not_found });
    expect(await submitPracticeAnswer(me, { questionId: "sql-1", answer: ANSWER }, deps)).toEqual({ ok: false, message: PRACTICE_MESSAGES.not_goal });
    expect(create).not.toHaveBeenCalled();
    expect(await answersOf(me)).toEqual([]);
  });

  it("saves the answer with the model's feedback, logs the call with its prompt version and ids only, and counts one answer", async () => {
    const me = await person("feedback", [{ skillId: "python" }, { skillId: "sql", status: "met" }]);
    const goalsOf = () => db!.select().from(schema.userGoals).where(eq(schema.userGoals.userId, me)).orderBy(asc(schema.userGoals.position));
    const goalsBefore = await goalsOf();
    const { client: c, create } = client(JSON.stringify(good));
    const r = await submitPracticeAnswer(me, { questionId: "python-1", answer: `  ${ANSWER}  ` }, { db: db!, client: c, now: clock });
    expect(r).toMatchObject({ ok: true, feedback: good, left: 9 });
    expect(create).toHaveBeenCalledTimes(1);
    const [row] = await answersOf(me);
    expect(row).toMatchObject({ skillId: "python", questionId: "python-1", answer: ANSWER, feedback: good, confidence: null });
    const [call] = await db!.select().from(schema.aiCalls).where(eq(schema.aiCalls.id, row.aiCallId!));
    expect(call).toMatchObject({ purpose: "practice-feedback", promptVersion: "practice-feedback/v1", status: "done", ok: true, inputRefs: { practiceAnswerId: row.id, questionId: "python-1" } });
    // The answer never reaches ai_calls or a log line.
    expect(JSON.stringify(call)).not.toContain("Meera");
    expect(lines.join("\n")).not.toContain("Meera");
    // Practice never writes to goals or proof.
    expect(await goalsOf()).toEqual(goalsBefore);
    expect(await db!.select().from(schema.gapProofs).where(eq(schema.gapProofs.userId, me))).toEqual([]);
    expect((await practiceFor(me, clock, db!)).left).toBe(9);
  });

  it("keeps the answer without feedback when the model fails, and that answer uses none of the day's 10", async () => {
    const me = await person("fallback", [{ skillId: "python" }]);
    const { client: c } = client("not json");
    const r = await submitPracticeAnswer(me, { questionId: "python-2", answer: ANSWER }, { db: db!, client: c, now: clock });
    expect(r).toMatchObject({ ok: true, feedback: null, left: 10 });
    const [row] = await answersOf(me);
    expect(row.feedback).toBeNull();
    expect((await practiceFor(me, clock, db!)).left).toBe(10);
    // An answer without feedback can't be rated.
    expect((await ratePracticeAnswer(me, { answerId: row.id, confidence: 3 }, db!)).ok).toBe(false);
  });

  it("stops at 10 answers with feedback in an India day", async () => {
    const me = await person("limit", [{ skillId: "python" }]);
    const today = startOfIndiaDay(clock);
    await db!.insert(schema.practiceAnswers).values(
      Array.from({ length: 10 }, (_, i) => ({ userId: me, skillId: "python", questionId: "python-1", answer: "an earlier answer", feedback: good, createdAt: new Date(today.getTime() + i * 60_000) })),
    );
    // One from yesterday doesn't count.
    await db!.insert(schema.practiceAnswers).values({ userId: me, skillId: "python", questionId: "python-1", answer: "yesterday", feedback: good, createdAt: new Date(today.getTime() - 60_000) });
    expect((await practiceFor(me, clock, db!)).left).toBe(0);
    const { client: c, create } = client(JSON.stringify(good));
    expect(await submitPracticeAnswer(me, { questionId: "python-3", answer: ANSWER }, { db: db!, client: c, now: clock })).toEqual({ ok: false, message: PRACTICE_MESSAGES.limit, left: 0 });
    expect(create).not.toHaveBeenCalled();
    // The next India day starts at 18:30 UTC.
    expect((await practiceFor(me, new Date("2026-10-15T18:31:00Z"), db!)).left).toBe(10);
  });

  it("rates only the person's own answers, and builds the picker and the trend from those ratings", async () => {
    const me = await person("rate", [{ skillId: "sql", status: "met" }, { skillId: "python" }, { skillId: "tableau" }, { skillId: "docker" }]);
    const other = await person("rate-other", [{ skillId: "python" }]);
    const { client: c } = client(JSON.stringify(good));
    const a = await submitPracticeAnswer(me, { questionId: "python-1", answer: ANSWER }, { db: db!, client: c, now: clock });
    const b = await submitPracticeAnswer(me, { questionId: "python-2", answer: ANSWER }, { db: db!, client: c, now: new Date(clock.getTime() + 60_000) });
    if (!a.ok || !b.ok) throw new Error("not saved");
    expect(await ratePracticeAnswer(other, { answerId: a.answerId, confidence: 4 }, db!)).toMatchObject({ ok: false });
    expect(await ratePracticeAnswer(me, { answerId: a.answerId, confidence: 5 }, db!)).toMatchObject({ ok: false });
    expect(await ratePracticeAnswer(me, { answerId: a.answerId, confidence: 1 }, db!)).toEqual({ ok: true });
    expect(await ratePracticeAnswer(me, { answerId: b.answerId, confidence: 2 }, db!)).toEqual({ ok: true });
    // Rating again replaces it.
    expect(await ratePracticeAnswer(me, { answerId: b.answerId, confidence: 3 }, db!)).toEqual({ ok: true });

    const view = await practiceFor(me, clock, db!);
    expect(view.skills.map((s) => [s.skillId, s.tag])).toEqual([
      ["sql", "met"],
      ["python", "current"],
      ["docker", "ahead"],
    ]);
    expect(view.skills.find((s) => s.skillId === "python")!.ratings).toEqual([1, 3]);
    expect(view.skills[0].questions).toHaveLength(5);
    expect(view.noQuestions).toEqual(["Tableau"]);
    expect(await practiceTrendsFor(me, db!)).toEqual([{ skillId: "python", name: "Python", ratings: [1, 3] }]);
    expect(await practiceTrendsFor(other, db!)).toEqual([]);
  });

  it("is in the data download, goes after 30 days and goes with the account", async () => {
    const me = await person("keep", [{ skillId: "python" }]);
    const { client: c } = client(JSON.stringify(good));
    await submitPracticeAnswer(me, { questionId: "python-4", answer: ANSWER }, { db: db!, client: c, now: clock });
    const data = await exportAccountData(me, db!);
    expect(EXPORT_VERSION).toBe(16);
    expect(data!.exportVersion).toBe(16);
    expect(data!.practiceAnswers).toEqual([expect.objectContaining({ skill: "python", questionId: "python-4", answer: ANSWER, feedback: good, question: expect.stringMatching(/\?$/) })]);

    expect(await clearOldPracticeAnswers(db!, new Date(clock.getTime() + 29 * DAY))).toBeGreaterThanOrEqual(0);
    expect(await answersOf(me)).toHaveLength(1);
    expect(await clearOldPracticeAnswers(db!, new Date(clock.getTime() + 31 * DAY))).toBeGreaterThanOrEqual(1);
    expect(await answersOf(me)).toEqual([]);

    await submitPracticeAnswer(me, { questionId: "python-5", answer: ANSWER }, { db: db!, client: c, now: new Date() });
    expect(await answersOf(me)).toHaveLength(1);
    await db!.delete(schema.users).where(eq(schema.users.id, me));
    expect(await answersOf(me)).toEqual([]);
  });
});
