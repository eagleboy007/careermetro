import { eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mockQuestions, skills } from "@/content";
import * as schema from "@/db/schema";
import { EXPORT_VERSION, exportAccountData } from "@/lib/account/export";
import { setElite } from "@/lib/elite/store";
import { MOCK_FEEDBACK_PER_DAY, MOCK_SESSIONS_PER_DAY, type MockQuestion } from "@/lib/schemas";
import { MOCK_MODEL, type MockFeedbackClient } from "./interview-feedback";
import { clearOldMockAnswers, endMockInterview, exportMockSessions, runningInterview, saveFollowUpAnswer, saveMockAnswer, startMockInterview } from "./interview-store";
import { mockPageFor } from "./store";

vi.mock("server-only", () => ({}));

// The mock interview (FR-50 part 3) against a real Postgres with migrations applied. Every person and answer here is
// made up; the model is a fake client that answers for every position it is sent.
const url = process.env.TEST_DATABASE_URL;
const sqlClient = url ? postgres(url, { max: 4, onnotice: () => {} }) : null;
const db = sqlClient ? drizzle(sqlClient, { schema }) : null;
const DAY = 86_400_000;
const ANSWER = "Meera would check the slow query plan first, then add an index on the join column and test again.";
// 20 words or more, so it may get a follow-up; ANSWER has 19, so it never does.
const LONG = "Meera would check the slow query plan first, then add an index on the join column, test it again and tell the team what changed.";
// Every open question with two follow-ups not yet reviewed, so a round always has one to ask where unreviewed ones are allowed.
const FU_BANK: MockQuestion[] = mockQuestions.map((q) =>
  q.kind === "open"
    ? {
        ...q,
        followUps: [
          { id: `${q.id}-fu-1`, text: `What would you check first on ${q.id}?`, skipIf: ["check first"] },
          { id: `${q.id}-fu-2`, text: `What would you do next on ${q.id}?`, skipIf: [] },
        ],
        followUpsReviewed: false,
      }
    : q,
);

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
    expect(call).toMatchObject({ purpose: "mock-interview", promptVersion: "mock-interview/v2", status: "done", ok: true, inputRefs: { mockSessionId: session.id, roleSlug: "data-analyst" } });
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

  it("asks a follow-up picked by code after a long answer, once a position and 2 a Quick round, and takes the reply", async () => {
    const me = await person();
    const t0 = new Date();
    const at = (s: number) => new Date(t0.getTime() + s * 1000);
    const deps = (s: number) => ({ db: db!, now: at(s), bank: FU_BANK, allowUnreviewed: true });
    const started = await startMockInterview(me, { roleSlug: "data-analyst", length: "quick", focus: "mix" }, deps(0));
    if (!started.ok) throw new Error(started.error);
    const session = started.session;
    const [q1, q2] = session.questions;

    // A long answer gets the question's first follow-up; saving it again keeps that one and asks nothing new.
    expect(await saveMockAnswer(me, { sessionId: session.id, position: 1, answer: LONG }, deps(30))).toEqual({
      ok: true,
      followUp: { position: 1, topic: q1.topic, text: `What would you check first on ${q1.id}?` },
    });
    expect(await saveMockAnswer(me, { sessionId: session.id, position: 1, answer: `${LONG} Edited.` }, deps(40))).toEqual({ ok: true });
    expect((await answersOf(session.id)).find((a) => a.position === 1)).toMatchObject({ followUpId: `${q1.id}-fu-1`, followUpAnswer: null });
    expect(await saveFollowUpAnswer(me, { sessionId: session.id, position: 1, answer: "  Meera would read the plan for a full scan.  " }, deps(60))).toEqual({ ok: true });
    // No follow-up was asked at position 2 yet, and someone else's session is not found.
    expect(await saveFollowUpAnswer(me, { sessionId: session.id, position: 2, answer: "Not asked" }, deps(61))).toEqual({ ok: false, error: "invalid" });
    const other = await person();
    expect(await saveFollowUpAnswer(other, { sessionId: session.id, position: 1, answer: "Not mine" }, deps(62))).toEqual({ ok: false, error: "not_found" });
    expect(await saveFollowUpAnswer(me, { sessionId: session.id, position: 1, answer: "   " }, deps(62))).toEqual({ ok: false, error: "invalid" });

    // An answer that already covers the first follow-up's point gets the second; then the round's share is used.
    expect(await saveMockAnswer(me, { sessionId: session.id, position: 2, answer: `${LONG} I would check first the plan.` }, deps(90))).toEqual({
      ok: true,
      followUp: { position: 2, topic: q2.topic, text: `What would you do next on ${q2.id}?` },
    });
    expect(await saveMockAnswer(me, { sessionId: session.id, position: 3, answer: LONG }, deps(120))).toEqual({ ok: true });
    expect(await saveMockAnswer(me, { sessionId: session.id, position: 4, answer: "Too short for one." }, deps(130))).toEqual({ ok: true });
    const rows = await answersOf(session.id);
    expect(rows.filter((a) => a.followUpId !== null).map((a) => a.position).sort()).toEqual([1, 2]);

    // Ending sends the open follow-up's reply with it, and one call covers the answers and the replies.
    const { client: c, create } = client();
    const out = await endMockInterview(me, { sessionId: session.id, answers: [], followUps: [{ position: 2, answer: "Meera would add the index." }] }, { ...deps(200), client: c });
    if (!out.ok) throw new Error(out.error);
    expect(create).toHaveBeenCalledTimes(1);
    const sent = create.mock.calls[0][0].messages[0].content;
    expect(sent).toContain('<follow_up position="1">\nMeera would read the plan for a full scan.\n</follow_up>');
    expect(sent).toContain('<follow_up position="2">\nMeera would add the index.\n</follow_up>');
    expect(sent.match(/<follow_up position=/g)).toHaveLength(2);
    expect(out.result).toMatchObject({ feedback: "ready", answered: 4, total: 4 });
    expect(out.result.items[0].followUp).toEqual({ question: `What would you check first on ${q1.id}?`, answer: "Meera would read the plan for a full scan." });
    expect(out.result.items[1].followUp).toEqual({ question: `What would you do next on ${q2.id}?`, answer: "Meera would add the index." });
    expect(out.result.items[2].followUp).toBeNull();
    const [call] = await db!.select().from(schema.aiCalls).where(eq(schema.aiCalls.id, (await sessionOf(session.id)).aiCallId!));
    expect(call).toMatchObject({ purpose: "mock-interview", promptVersion: "mock-interview/v2", ok: true });
    expect(JSON.stringify(call)).not.toContain("Meera");
    expect(lines.join("\n")).not.toMatch(/Meera|full scan/);

    // Closed: no more replies.
    expect(await saveFollowUpAnswer(me, { sessionId: session.id, position: 1, answer: "Late" }, deps(201))).toEqual({ ok: false, error: "over" });

    // In Download your data with the follow-up and its reply, and cleared with the answers after 30 days.
    // Read with the test bank: Download your data uses the real bank, whose about-you follow-ups have other words.
    const exported = await exportMockSessions(me, db!, FU_BANK);
    expect(exported[0].answers.find((a) => a.position === 1)?.followUp).toEqual({ question: `What would you check first on ${q1.id}?`, answer: "Meera would read the plan for a full scan." });
    expect(exported[0].answers.find((a) => a.position === 3)?.followUp).toBeNull();
    expect(await clearOldMockAnswers(db!, new Date(t0.getTime() + 31 * DAY))).toBeGreaterThanOrEqual(4);
    expect(await answersOf(session.id)).toEqual([]);
  });

  it("asks no follow-up that isn't reviewed where unreviewed ones aren't allowed, and refuses a reply after the grace", async () => {
    const me = await person();
    const t0 = new Date();
    const at = (s: number) => new Date(t0.getTime() + s * 1000);
    const prod = await startMockInterview(me, { roleSlug: "data-analyst", length: "quick", focus: "mix" }, { db: db!, now: t0, bank: FU_BANK, allowUnreviewed: false });
    if (!prod.ok) throw new Error(prod.error);
    expect(await saveMockAnswer(me, { sessionId: prod.session.id, position: 1, answer: LONG }, { db: db!, now: at(30), bank: FU_BANK, allowUnreviewed: false })).toEqual({ ok: true });
    expect((await answersOf(prod.session.id))[0].followUpId).toBeNull();

    const preview = await startMockInterview(me, { roleSlug: "data-analyst", length: "quick", focus: "mix" }, { db: db!, now: t0, bank: FU_BANK, allowUnreviewed: true });
    if (!preview.ok) throw new Error(preview.error);
    const asked = await saveMockAnswer(me, { sessionId: preview.session.id, position: 1, answer: LONG }, { db: db!, now: at(30), bank: FU_BANK, allowUnreviewed: true });
    expect(asked).toMatchObject({ ok: true, followUp: { position: 1 } });
    expect(await saveFollowUpAnswer(me, { sessionId: preview.session.id, position: 1, answer: "In time" }, { db: db!, now: at(650) })).toEqual({ ok: true });
    // Clearing the answer takes its follow-up with it.
    expect(await saveMockAnswer(me, { sessionId: preview.session.id, position: 1, answer: "" }, { db: db!, now: at(655), bank: FU_BANK, allowUnreviewed: true })).toEqual({ ok: true });
    expect(await answersOf(preview.session.id)).toEqual([]);
    expect(await saveFollowUpAnswer(me, { sessionId: preview.session.id, position: 1, answer: "Too late" }, { db: db!, now: at(661) })).toEqual({ ok: false, error: "over" });
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
    expect(EXPORT_VERSION).toBe(33);
    expect(data.exportVersion).toBe(33);
    expect(data.mockSessions).toHaveLength(1);
    expect(data.mockSessions[0]).toMatchObject({ roleSlug: "data-analyst", length: "quick", focus: "mix", summary: "You answer in order and in plain words." });
    expect(data.mockSessions[0].answers).toEqual([{ position: 1, answer: ANSWER, whatWorked: "Clear start on 1.", addNextTime: "Add one example.", followUp: null }]);

    expect(await clearOldMockAnswers(db!, new Date(t0.getTime() + 29 * DAY))).toBeGreaterThanOrEqual(0);
    expect(await answersOf(session.id)).toHaveLength(1);
    expect(await clearOldMockAnswers(db!, new Date(t0.getTime() + 31 * DAY))).toBeGreaterThanOrEqual(1);
    expect(await answersOf(session.id)).toEqual([]);
    expect(await sessionOf(session.id)).toMatchObject({ feedback: { summary: "You answer in order and in plain words." } });
    expect((await exportAccountData(me, db!))!.mockSessions[0].answers).toEqual([]);

    await db!.delete(schema.users).where(eq(schema.users.id, me));
    expect(await sessionOf(session.id)).toBeUndefined();
  });

  it("sets a round up for one job in the person's own My jobs: its skills first, its name kept, never someone else's job", async () => {
    const me = await person();
    const skillId = mockQuestions.find((q) => q.kind === "open" && q.roleSlugs.includes("devops-engineer") && !q.roleSlugs.includes("data-analyst"))!.skillId;
    const [post] = await db!
      .insert(schema.jobPosts)
      .values({ ats: "lever", boardToken: run, externalId: `${run}-job`, url: "https://jobs.lever.co/example/2", title: "Platform analyst", company: "Example Cloud", requiredSkillIds: [skillId] })
      .returning({ id: schema.jobPosts.id });
    const [save] = await db!.insert(schema.jobSaves).values({ userId: me, jobPostId: post.id, savedAt: new Date() }).returning({ id: schema.jobSaves.id });
    const job = { kind: "post", postId: post.id } as const;

    const page = await mockPageFor(me, null, { db: db!, job });
    expect(page.job).toMatchObject({ ref: job, company: "Example Cloud", title: "Platform analyst", open: [], only: [], skipped: [] });
    expect((await mockPageFor(me, null, { db: db! })).job).toBeNull();

    const out = await startMockInterview(me, { roleSlug: "data-analyst", length: "quick", focus: "job", job }, { db: db! });
    if (!out.ok) throw new Error(out.error);
    expect(out.session.job).toEqual({ company: "Example Cloud", title: "Platform analyst" });
    expect(mockQuestions.find((q) => q.id === out.session.questions[0].id)!.skillId).toBe(skillId);
    expect(await sessionOf(out.session.id)).toMatchObject({ focus: "job", roleSlug: "data-analyst", jobSaveId: save.id });
    expect((await runningInterview(me, { db: db! }))?.job).toEqual({ company: "Example Cloud", title: "Platform analyst" });

    // Someone else's job, or a job round that names none, starts nothing.
    const other = await person();
    expect(await startMockInterview(other, { roleSlug: "data-analyst", length: "quick", focus: "job", job }, { db: db! })).toEqual({ ok: false, error: "no_job" });
    expect(await startMockInterview(other, { roleSlug: "data-analyst", length: "quick", focus: "job" }, { db: db! })).toEqual({ ok: false, error: "invalid" });
    expect((await mockPageFor(other, null, { db: db!, job })).job).toBeNull();

    // Deleting the job keeps the round and its feedback, without the job's name.
    await db!.delete(schema.jobSaves).where(eq(schema.jobSaves.id, save.id));
    expect((await sessionOf(out.session.id)).jobSaveId).toBeNull();
    const ended = await endMockInterview(me, { sessionId: out.session.id, answers: [{ position: 1, answer: ANSWER }] }, { db: db!, client: client().client });
    expect(ended.ok && ended.result.job).toBeNull();
    await db!.delete(schema.jobPosts).where(eq(schema.jobPosts.id, post.id));
  });
});
