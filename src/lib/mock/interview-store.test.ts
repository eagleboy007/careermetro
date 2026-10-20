import { eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { skills } from "@/content";
import * as schema from "@/db/schema";
import { EXPORT_VERSION, exportAccountData } from "@/lib/account/export";
import { setElite } from "@/lib/elite/store";
import { MOCK_FEEDBACK_PER_DAY, MOCK_SESSIONS_PER_DAY } from "@/lib/schemas";
import { MOCK_MODEL, type MockFeedbackClient } from "./interview-feedback";
import { clearOldMockAnswers, endMockInterview, runningInterview, saveMockAnswer, startMockInterview } from "./interview-store";
import { mockPageFor } from "./store";

vi.mock("server-only", () => ({}));

// The mock interview (FR-50 part 3) against a real Postgres with migrations applied. Every person and answer here is
// made up; the model is a fake client that answers for every position it is sent.
const url = process.env.TEST_DATABASE_URL;
const sqlClient = url ? postgres(url, { max: 4, onnotice: () => {} }) : null;
const db = sqlClient ? drizzle(sqlClient, { schema }) : null;
const DAY = 86_400_000;
const ANSWER = "Meera would check the slow query plan first, then add an index on the join column and test again.";

function client(reply: "words" | "not json" | Error = "words") {
  const create = vi.fn(async (body: { messages: { content: string }[] }) => {
    if (reply instanceof Error) throw reply;
    const positions = [...body.messages[0].content.matchAll(/<answer position="(\d+)">/g)].map((m) => Number(m[1]));
    const text =
      reply === "words"
        ? JSON.stringify({
            summary: "You answer in order and in plain words.",
            questions: positions.map((position) => ({ position, whatWorked: `Clear start on ${position}.`, addNextTime: "Add one example." })),
          })
        : reply;
    return { model: MOCK_MODEL, stop_reason: "end_turn", usage: { input_tokens: 1500, output_tokens: 400 }, content: [{ type: "text", text }] };
  });
  return { client: { beta: { messages: { create } } } as unknown as MockFeedbackClient, create };
}

describe.skipIf(!db)("mock interview store (database)", () => {
  const run = `mocki-${Date.now()}`;
  const userIds: string[] = [];
  const lines: string[] = [];
  let n = 0;
  const person = async (elite = true, goals: string[] = []) => {
    const [u] = await db!
      .insert(schema.users)
      .values({ email: `${run}-${n}@example.test`, authSubject: `${run}-${n++}`, name: "Meera Example" })
      .returning({ id: schema.users.id });
    userIds.push(u.id);
    if (elite) expect((await setElite(u.id, true, { db: db! })).ok).toBe(true);
    if (goals.length) await db!.insert(schema.userGoals).values(goals.map((skillId, i) => ({ userId: u.id, skillId, position: i + 1 })));
    return u.id;
  };
  const sessionOf = async (id: string) => (await db!.select().from(schema.mockSessions).where(eq(schema.mockSessions.id, id)))[0];
  const answersOf = (id: string) => db!.select().from(schema.mockAnswers).where(eq(schema.mockAnswers.sessionId, id));
  const start = async (me: string, now = new Date(), input: Record<string, string> = {}) => {
    const out = await startMockInterview(me, { roleSlug: "data-analyst", length: "quick", focus: "mix", ...input }, { db: db!, now });
    if (!out.ok) throw new Error(out.error);
    return out.session;
  };

  beforeAll(async () => {
    await db!
      .insert(schema.skills)
      .values(skills.map(({ id, name, category }) => ({ id, name, category })))
      .onConflictDoNothing();
    vi.stubEnv("MOCK_DAILY_BUDGET_USD", "1000000");
  });
  beforeEach(() => {
    for (const level of ["log", "warn", "error"] as const) vi.spyOn(console, level).mockImplementation((line: unknown) => void lines.push(String(line)));
  });
  afterAll(async () => {
    vi.unstubAllEnvs();
    if (userIds.length) await db!.delete(schema.users).where(inArray(schema.users.id, userIds));
    await sqlClient?.end();
  });

  it("starts nothing on Free, and refuses a role or length it doesn't know", async () => {
    const free = await person(false);
    expect(await startMockInterview(free, { roleSlug: "data-analyst", length: "quick", focus: "mix" }, { db: db! })).toEqual({ ok: false, error: "not_elite" });
    expect(await db!.select().from(schema.mockSessions).where(eq(schema.mockSessions.userId, free))).toEqual([]);
    expect((await mockPageFor(free, null, { db: db! })).interview).toBeNull();
    const me = await person();
    expect(await startMockInterview(me, { roleSlug: "astronaut", length: "quick", focus: "mix" }, { db: db! })).toEqual({ ok: false, error: "invalid" });
    expect(await startMockInterview(me, { roleSlug: "data-analyst", length: "long", focus: "mix" }, { db: db! })).toEqual({ ok: false, error: "invalid" });
  });

  it("runs a quick round: answers saved on Next, ended once with feedback in words, logged with ids only", async () => {
    const me = await person();
    const t0 = new Date();
    const at = (s: number) => new Date(t0.getTime() + s * 1000);
    const session = await start(me, t0);
    expect(session.questions).toHaveLength(4);
    expect(session.secondsLeft).toBe(600);
    const row = await sessionOf(session.id);
    expect(row).toMatchObject({ userId: me, roleSlug: "data-analyst", length: "quick", focus: "mix", endedAt: null, feedback: null, aiCallId: null });
    expect(row.questionIds).toEqual(session.questions.map((q) => q.id));

    expect(await saveMockAnswer(me, { sessionId: session.id, position: 1, answer: `  ${ANSWER}  ` }, { db: db!, now: at(60) })).toEqual({ ok: true });
    expect(await saveMockAnswer(me, { sessionId: session.id, position: 2, answer: "A first try" }, { db: db!, now: at(90) })).toEqual({ ok: true });
    // Editing replaces, an empty answer clears, and a position past the round is refused.
    expect(await saveMockAnswer(me, { sessionId: session.id, position: 2, answer: "" }, { db: db!, now: at(95) })).toEqual({ ok: true });
    expect(await saveMockAnswer(me, { sessionId: session.id, position: 5, answer: "x" }, { db: db!, now: at(95) })).toEqual({ ok: false, error: "invalid" });
    expect(await saveMockAnswer(me, { sessionId: session.id, position: 1, answer: "x".repeat(4001) }, { db: db!, now: at(95) })).toEqual({ ok: false, error: "invalid" });
    // Someone else can't add to it, see it or end it.
    const other = await person();
    expect(await saveMockAnswer(other, { sessionId: session.id, position: 3, answer: "Not mine" }, { db: db!, now: at(96) })).toEqual({ ok: false, error: "not_found" });
    expect(await endMockInterview(other, { sessionId: session.id, answers: [] }, { db: db!, now: at(96) })).toEqual({ ok: false, error: "not_found" });

    // The page carries on with it, with the saved answer.
    const running = await runningInterview(me, { db: db!, now: at(120) });
    expect(running?.id).toBe(session.id);
    expect(running?.answers).toEqual([ANSWER, "", "", ""]);
    expect(running?.secondsLeft).toBe(480);

    // End with the answer on screen for question 3: one call for the whole round.
    const { client: c, create } = client();
    const out = await endMockInterview(me, { sessionId: session.id, answers: [{ position: 3, answer: "I would group by region and sum the sales." }] }, { db: db!, now: at(300), client: c });
    if (!out.ok) throw new Error(out.error);
    expect(create).toHaveBeenCalledTimes(1);
    expect(out.result).toMatchObject({ feedback: "ready", answered: 2, total: 4, summary: "You answer in order and in plain words." });
    expect(out.result.items[0]).toMatchObject({ position: 1, answer: ANSWER, whatWorked: "Clear start on 1.", addNextTime: "Add one example." });
    expect(out.result.items[1]).toMatchObject({ answer: null, whatWorked: null, bankHref: "/mock?tab=bank&role=data-analyst" });
    expect(out.result.items[2].whatWorked).toBe("Clear start on 3.");
    expect(JSON.stringify(out.result)).not.toMatch(/"score"|"grade"|"rating"/);

    const ended = await sessionOf(session.id);
    expect(ended.endedAt?.toISOString()).toBe(at(300).toISOString());
    expect(ended.feedback).toEqual({ summary: "You answer in order and in plain words." });
    const [call] = await db!.select().from(schema.aiCalls).where(eq(schema.aiCalls.id, ended.aiCallId!));
    expect(call).toMatchObject({ purpose: "mock-interview", promptVersion: "mock-interview/v1", status: "done", ok: true, inputRefs: { mockSessionId: session.id, roleSlug: "data-analyst" } });
    expect((await answersOf(session.id)).map((a) => [a.position, a.whatWorked])).toEqual(
      expect.arrayContaining([
        [1, "Clear start on 1."],
        [3, "Clear start on 3."],
      ]),
    );
    // The answers never reach ai_calls or a log line.
    expect(JSON.stringify(call)).not.toContain("Meera");
    expect(lines.join("\n")).not.toMatch(/Meera|group by region/);

    // Once ended: no more answers, and ending again shows the same result without another call.
    expect(await saveMockAnswer(me, { sessionId: session.id, position: 4, answer: "Late" }, { db: db!, now: at(301) })).toEqual({ ok: false, error: "over" });
    const again = await endMockInterview(me, { sessionId: session.id, answers: [{ position: 4, answer: "Late" }] }, { db: db!, now: at(302), client: c });
    expect(again).toEqual(out);
    expect(create).toHaveBeenCalledTimes(1);
    expect(await runningInterview(me, { db: db!, now: at(303) })).toBeNull();
  });

  it("refuses answers after the time and its minute's grace, and ends a late round at its deadline", async () => {
    const me = await person();
    const t0 = new Date();
    const at = (s: number) => new Date(t0.getTime() + s * 1000);
    const session = await start(me, t0);
    expect(await saveMockAnswer(me, { sessionId: session.id, position: 1, answer: "Just in time" }, { db: db!, now: at(650) })).toEqual({ ok: true });
    expect(await saveMockAnswer(me, { sessionId: session.id, position: 2, answer: "Too late" }, { db: db!, now: at(661) })).toEqual({ ok: false, error: "over" });
    expect(await runningInterview(me, { db: db!, now: at(601) })).toBeNull();
    const { client: c } = client();
    const out = await endMockInterview(me, { sessionId: session.id, answers: [{ position: 2, answer: "Too late" }] }, { db: db!, now: at(900), client: c });
    if (!out.ok) throw new Error(out.error);
    expect(out.result.answered).toBe(1);
    expect((await sessionOf(session.id)).endedAt?.toISOString()).toBe(at(600).toISOString());
  });

  it("ends a round with nothing answered without a call, and saves the answers when feedback fails", async () => {
    const me = await person();
    const { client: c, create } = client();
    const empty = await start(me);
    const none = await endMockInterview(me, { sessionId: empty.id, answers: [] }, { db: db!, client: c });
    expect(none).toMatchObject({ ok: true, result: { feedback: "none_answered", answered: 0, summary: null } });
    expect(create).not.toHaveBeenCalled();

    const broken = await start(me);
    const { client: bad } = client("not json");
    const out = await endMockInterview(me, { sessionId: broken.id, answers: [{ position: 1, answer: ANSWER }] }, { db: db!, client: bad });
    expect(out).toMatchObject({ ok: true, result: { feedback: "unavailable", answered: 1, summary: null } });
    const row = await sessionOf(broken.id);
    expect(row.endedAt).not.toBeNull();
    expect(row.feedback).toBeNull();
    expect((await answersOf(broken.id))[0]).toMatchObject({ answer: ANSWER, whatWorked: null, addNextTime: null });
  });

  it("still ends and saves past the daily budget, and says feedback isn't available today", async () => {
    const me = await person();
    const session = await start(me);
    vi.stubEnv("MOCK_DAILY_BUDGET_USD", "0");
    const { client: c, create } = client();
    const out = await endMockInterview(me, { sessionId: session.id, answers: [{ position: 1, answer: ANSWER }] }, { db: db!, client: c });
    vi.stubEnv("MOCK_DAILY_BUDGET_USD", "1000000");
    expect(out).toMatchObject({ ok: true, result: { feedback: "unavailable_today", answered: 1 } });
    expect(create).not.toHaveBeenCalled();
    expect(await sessionOf(session.id)).toMatchObject({ aiCallId: null, feedback: null });
    expect((await sessionOf(session.id)).endedAt).not.toBeNull();
  });

  it("allows 5 rounds and 5 feedbacks a day per person", async () => {
    const me = await person();
    const { client: c, create } = client();
    for (let i = 0; i < MOCK_SESSIONS_PER_DAY; i++) {
      const s = await start(me);
      const out = await endMockInterview(me, { sessionId: s.id, answers: [{ position: 1, answer: ANSWER }] }, { db: db!, client: c });
      expect(out).toMatchObject({ ok: true, result: { feedback: "ready" } });
    }
    expect(create).toHaveBeenCalledTimes(MOCK_FEEDBACK_PER_DAY);
    expect(await startMockInterview(me, { roleSlug: "data-analyst", length: "quick", focus: "mix" }, { db: db! })).toEqual({ ok: false, error: "limit" });
    // The feedback limit holds on its own too: a sixth ending in the day gets none.
    const extra = await db!.insert(schema.mockSessions).values({ userId: me, roleSlug: "data-analyst", length: "quick", focus: "mix", questionIds: ["sql-1"] }).returning({ id: schema.mockSessions.id });
    const sixth = await endMockInterview(me, { sessionId: extra[0].id, answers: [{ position: 1, answer: ANSWER }] }, { db: db!, client: c });
    expect(sixth).toMatchObject({ ok: true, result: { feedback: "unavailable_today" } });
    expect(create).toHaveBeenCalledTimes(MOCK_FEEDBACK_PER_DAY);
  });

  it("asks about the person's open goals for Your gaps, and stops a person who turned Elite off", async () => {
    const me = await person(true, ["sql"]);
    const s = await start(me, new Date(), { focus: "gaps", length: "full" });
    expect(s.questions.slice(0, 5).every((q) => q.id.startsWith("sql-"))).toBe(true);
    await setElite(me, false, { db: db! });
    expect(await saveMockAnswer(me, { sessionId: s.id, position: 1, answer: "x" }, { db: db! })).toEqual({ ok: false, error: "not_elite" });
    expect(await endMockInterview(me, { sessionId: s.id, answers: [] }, { db: db! })).toEqual({ ok: false, error: "not_elite" });
  });

  it("is in Download your data, deletes answers after 30 days keeping the session, and goes with the account", async () => {
    const me = await person();
    const t0 = new Date();
    const session = await start(me, t0);
    const { client: c } = client();
    await endMockInterview(me, { sessionId: session.id, answers: [{ position: 1, answer: ANSWER }] }, { db: db!, now: t0, client: c });
    const data = (await exportAccountData(me, db!))!;
    expect(EXPORT_VERSION).toBe(27);
    expect(data.exportVersion).toBe(27);
    expect(data.mockSessions).toHaveLength(1);
    expect(data.mockSessions[0]).toMatchObject({ roleSlug: "data-analyst", length: "quick", focus: "mix", summary: "You answer in order and in plain words." });
    expect(data.mockSessions[0].answers).toEqual([{ position: 1, answer: ANSWER, whatWorked: "Clear start on 1.", addNextTime: "Add one example." }]);

    expect(await clearOldMockAnswers(db!, new Date(t0.getTime() + 29 * DAY))).toBeGreaterThanOrEqual(0);
    expect(await answersOf(session.id)).toHaveLength(1);
    expect(await clearOldMockAnswers(db!, new Date(t0.getTime() + 31 * DAY))).toBeGreaterThanOrEqual(1);
    expect(await answersOf(session.id)).toEqual([]);
    expect(await sessionOf(session.id)).toMatchObject({ feedback: { summary: "You answer in order and in plain words." } });
    expect((await exportAccountData(me, db!))!.mockSessions[0].answers).toEqual([]);

    await db!.delete(schema.users).where(eq(schema.users.id, me));
    expect(await sessionOf(session.id)).toBeUndefined();
  });
});
