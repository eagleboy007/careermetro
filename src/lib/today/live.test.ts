import { readFileSync } from "node:fs";
import { and, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as schema from "@/db/schema";
import { roleProfiles, skills } from "@/content";
import { GAP_LIMITS } from "@/lib/gaps/store";
import { pairOf } from "@/lib/network/rules";
import { getPathForOwner, PATH_LIMITS } from "@/lib/path/store";
import { ingestResume } from "@/lib/resume/ingest";
import type { ParseClient } from "@/lib/resume/parse";
import { confirmProfile } from "@/lib/resume/store";
import { answerSignal, tickTask, todayRideFor } from "@/lib/ride/store";
import type { MockChoiceQuestion, Profile } from "@/lib/schemas";
import { LINE_MIN_PEOPLE, lineInitials, onYourLineFor } from "./live";

vi.mock("server-only", () => ({}));

// Today's live cards against a real Postgres with migrations applied, like the other store tests. Every person here is
// made up.
const url = process.env.TEST_DATABASE_URL;
const sqlClient = url ? postgres(url, { max: 4, onnotice: () => {} }) : null;
const db = sqlClient ? drizzle(sqlClient, { schema }) : null;
const DAY = 86_400_000;

const bytes = new TextEncoder().encode(readFileSync("fixtures/resumes/priya-sharma.txt", "utf8"));
const parsed: Profile = {
  headline: "Data Analyst",
  totalYearsExperience: 3,
  roles: [],
  skills: [{ name: "SQL", lastUsed: null, evidence: [] }],
  education: [],
  certifications: [],
};
const client = {
  beta: {
    messages: {
      create: vi.fn().mockResolvedValue({
        model: "claude-opus-5-5",
        stop_reason: "end_turn",
        usage: { input_tokens: 3000, output_tokens: 1000 },
        content: [{ type: "text", text: JSON.stringify(parsed) }],
      }),
    },
  },
} as unknown as ParseClient;

/** One reviewed question for every skill, so whichever goal the line starts with has one. */
const bank: MockChoiceQuestion[] = skills.map((s) => ({
  id: `t-${s.id}`.slice(0, 80),
  kind: "choice",
  roleSlugs: ["data-analyst"],
  skillId: s.id,
  topic: "Topic",
  question: `Which of these is right for ${s.name}?`,
  options: ["First", "Second", "Third"],
  answer: 2,
  explanation: "The third one is right.",
  level: "L1",
  reviewed: true,
}));

describe.skipIf(!db)("Today's live cards (database)", () => {
  const now = new Date("2026-10-20T12:00:00Z");
  const run = `live-${Date.now()}`;
  const userIds: string[] = [];
  // Skills of this file only, so other test files' people never land on these lines.
  const lineSkill = `t-line-${Date.now()}`;
  const fewSkill = `t-few-${Date.now()}`;
  const role = roleProfiles[0];
  const limits = { explain: GAP_LIMITS.explainedPerOwnerPerDay, word: PATH_LIMITS.wordedPerOwnerPerDay };
  let n = 0;

  beforeAll(async () => {
    await db!
      .insert(schema.skills)
      .values([...skills.map(({ id, name, category }) => ({ id, name, category })), { id: lineSkill, name: "Line skill", category: "test" }, { id: fewSkill, name: "Few skill", category: "test" }])
      .onConflictDoNothing();
    vi.stubEnv("PARSE_DAILY_BUDGET_USD", "1000000");
    GAP_LIMITS.explainedPerOwnerPerDay = 0;
    PATH_LIMITS.wordedPerOwnerPerDay = 0;
  });
  afterAll(async () => {
    vi.unstubAllEnvs();
    GAP_LIMITS.explainedPerOwnerPerDay = limits.explain;
    PATH_LIMITS.wordedPerOwnerPerDay = limits.word;
    if (userIds.length) await db!.delete(schema.users).where(inArray(schema.users.id, userIds));
    await db!.delete(schema.skills).where(inArray(schema.skills.id, [lineSkill, fewSkill]));
    await sqlClient!.end();
  });

  async function user(name: string | null, p: Partial<typeof schema.users.$inferInsert> = {}) {
    const [row] = await db!
      .insert(schema.users)
      .values({ email: `${run}-${n++}@example.test`, name, ...p })
      .returning({ id: schema.users.id });
    userIds.push(row.id);
    return row.id;
  }

  describe("signal check", () => {
    async function lineFor(name: string) {
      const userId = await user(name);
      const owner = { userId };
      const r = await ingestResume({ bytes, as: "text", owner, clientHash: `h-${run}-${n}` }, { db: db!, client });
      if (!r.ok) throw new Error(r.code);
      await confirmProfile(r.resumeId, owner, parsed, db!);
      const path = await getPathForOwner(r.resumeId, owner, role, 5, { db: db! });
      if (!path.ok) throw new Error(path.reason);
      return userId;
    }
    const ticks = async (userId: string) =>
      (await db!.select({ day: schema.rideDays.day, taskIds: schema.rideDays.taskIds }).from(schema.rideDays).where(eq(schema.rideDays.userId, userId))).flatMap((d) =>
        d.taskIds.map((id) => `${d.day} ${id}`),
      );

    it("asks one question for today's goal, checks the answer on the server and ticks the day's signal task once", async () => {
      const userId = await lineFor("Signal Rider");
      const today = await todayRideFor(userId, now, db!, "", { bank });
      expect(today?.signal).not.toBeNull();
      const signal = today!.signal!;
      expect(signal).toMatchObject({ day: "2026-10-20", done: false, live: { answer: null } });
      expect(signal.live.id).toBe(`t-${today!.current!.skillId}`.slice(0, 80));
      // The question isn't one of the ride's own tasks: Today adds the signal task.
      expect(today!.ride.tasks.some((t) => t.signal)).toBe(false);

      // A stale question, a key that isn't an option, or someone with no line: nothing is ticked.
      expect(await answerSignal(userId, "t-another", "A", now, db!, { bank })).toBe("stale");
      expect(await answerSignal(userId, signal.live.id, "D", now, db!, { bank })).toBeNull();
      expect(await answerSignal(userId, signal.live.id, 2, now, db!, { bank })).toBeNull();
      expect(await answerSignal(await user("No Line"), signal.live.id, "A", now, db!, { bank })).toBeNull();
      expect(await ticks(userId)).toEqual([]);

      // Any answer ticks it; the right one comes back with why. Asking again ticks nothing more.
      expect(await answerSignal(userId, signal.live.id, "A", now, db!, { bank })).toEqual({ correctKey: "C", explanation: "The third one is right." });
      expect(await answerSignal(userId, signal.live.id, "C", now, db!, { bank })).toEqual({ correctKey: "C", explanation: "The third one is right." });
      expect(await ticks(userId)).toEqual(["2026-10-20 signal:2026-10-20"]);
      const after = await todayRideFor(userId, now, db!, "", { bank });
      expect(after!.signal).toMatchObject({ done: true, live: { answer: { correctKey: "C" } } });
      expect(after!.streak).toEqual({ days: 1, todayCounted: true });
      // It can't be ticked or unticked by hand.
      expect(await tickTask(userId, "signal:2026-10-20", false, now, db!)).toBe(false);
      expect(await tickTask(userId, "signal:2026-10-21", true, now, db!)).toBe(false);

      // The next day is a new task, not yet answered.
      const tomorrow = await todayRideFor(userId, new Date(now.getTime() + DAY), db!, "", { bank });
      expect(tomorrow!.signal).toMatchObject({ day: "2026-10-21", done: false, live: { answer: null } });
    });

    it("asks nothing when the bank has no reviewed question for today's goal or the next (production)", async () => {
      const userId = await lineFor("Quiet Rider");
      const drafts = bank.map((q) => ({ ...q, reviewed: false }));
      const today = await todayRideFor(userId, now, db!, "", { bank: drafts, allowUnreviewed: false });
      expect(today!.signal).toBeNull();
      expect(await answerSignal(userId, bank[0].id, "A", now, db!, { bank: drafts, allowUnreviewed: false })).toBe("stale");
      expect(await ticks(userId)).toEqual([]);
    });

    it("puts an event prep task on the ride on its India day: tickable, a ride day, and never the train (Timetable PR 3)", async () => {
      const userId = await lineFor("Event Rider");
      const before = (await todayRideFor(userId, now, db!, "", { bank }))!;
      const skillId = before.current!.skillId;
      // 18:30 to 20:30 IST on 20 October; a made-up organiser.
      const [ev] = await db!
        .insert(schema.events)
        .values({
          source: "feed",
          sourceKey: `${run}-event`,
          sourceUrl: "https://events.example.org/pune/evening",
          title: "Evening practice night",
          organiser: "Example Data Circle",
          kind: "meetup",
          startsAt: new Date("2026-10-20T13:00:00Z"),
          endsAt: new Date("2026-10-20T15:00:00Z"),
          city: "Pune",
          cost: "Free",
          status: "live",
        })
        .returning({ id: schema.events.id });
      try {
        await db!.insert(schema.eventRsvps).values({ userId, eventId: ev.id, state: "going", goalSkillId: skillId });
        const id = `event:${ev.id}`;
        const day = (await todayRideFor(userId, now, db!, "", { bank }))!;
        expect(day.ride.tasks[0]).toMatchObject({ id, title: "Go to Evening practice night", minutes: 120, done: false, locked: false, eventUrl: "https://events.example.org/pune/evening" });
        expect(day.ride).toMatchObject({ pitstop: before.ride.pitstop, weekTasksDone: before.ride.weekTasksDone });

        expect(await tickTask(userId, id, true, now, db!)).toBe(true);
        expect(await ticks(userId)).toEqual([`2026-10-20 ${id}`]);
        const ticked = (await todayRideFor(userId, now, db!, "", { bank }))!;
        expect(ticked.streak.todayCounted).toBe(true);
        expect(ticked.ride.tasks[0]).toMatchObject({ id, done: true });
        expect(ticked.ride).toMatchObject({ pitstop: before.ride.pitstop, weekTasksDone: before.ride.weekTasksDone, goalName: before.ride.goalName });
        expect(await tickTask(userId, id, false, now, db!)).toBe(true);

        // Not on another day, and not once the person goes back to Save.
        const tomorrow = new Date(now.getTime() + DAY);
        expect((await todayRideFor(userId, tomorrow, db!, "", { bank }))!.ride.tasks.some((t) => t.eventUrl)).toBe(false);
        expect(await tickTask(userId, id, true, tomorrow, db!)).toBe(false);
        await db!.update(schema.eventRsvps).set({ state: "saved", goalSkillId: null }).where(eq(schema.eventRsvps.userId, userId));
        expect((await todayRideFor(userId, now, db!, "", { bank }))!.ride.tasks.some((t) => t.eventUrl)).toBe(false);
      } finally {
        await db!.delete(schema.events).where(eq(schema.events.id, ev.id));
      }
    });
  });

  describe("on your line", () => {
    type Who = {
      name?: string | null;
      settings?: Partial<typeof schema.userSettings.$inferInsert> | null;
      status?: "active" | "met" | "skipped";
      skill?: string;
      createdAt?: Date;
      user?: Partial<typeof schema.users.$inferInsert>;
    };
    const open = { peopleCanFind: true, profileVisibility: "signed_in", gapsVisibleTo: "profile" } as const;
    // Goals are stamped with the time they are written (the column default), not the fixed `now` above, so the
    // first-day week is read from the test's real clock.
    const wall = new Date();
    async function rider({ name = "Rider Person", settings = open, status = "active", skill = lineSkill, createdAt, user: u = {} }: Who = {}) {
      const id = await user(name, u);
      if (settings) await db!.insert(schema.userSettings).values({ userId: id, ...settings });
      await db!.insert(schema.userGoals).values({ userId: id, skillId: skill, status, position: 0, ...(createdAt ? { createdAt } : {}) });
      return id;
    }

    it("counts only people who chose to be found, whose profile and gaps the viewer may see, with no block either way", async () => {
      const viewer = await rider({ name: "Viewer Person" });
      await rider({ name: "Arjun Mehta" });
      await rider({ name: "Sana Kapoor" });
      await rider({ name: "Ravi Verma" });
      const friend = await rider({ name: "Deepa Iyer", settings: { peopleCanFind: true, profileVisibility: "connections", gapsVisibleTo: "connections" } });
      await db!.insert(schema.connections).values({ ...pairOf(viewer, friend), how: "worked_together" });
      // Not counted: not findable, no settings, Only you, gaps for nobody, gaps for connections only, a line profile
      // without a connection, blocked either way, suspended, deleting, no name, a goal met or skipped.
      await rider({ settings: { ...open, peopleCanFind: false } });
      await rider({ settings: null });
      await rider({ settings: { ...open, profileVisibility: "only_me" } });
      await rider({ settings: { ...open, gapsVisibleTo: "nobody" } });
      await rider({ settings: { ...open, gapsVisibleTo: "connections" } });
      await rider({ settings: { ...open, profileVisibility: "line" } });
      const blocked = await rider();
      await db!.insert(schema.blocks).values({ blockerId: viewer, blockedId: blocked });
      const blocker = await rider();
      await db!.insert(schema.blocks).values({ blockerId: blocker, blockedId: viewer });
      await rider({ user: { suspendedAt: now } });
      await rider({ user: { deletionRequestedAt: now } });
      await rider({ name: null });
      await rider({ name: "  " });
      await rider({ status: "met" });
      await rider({ status: "skipped" });

      const line = await onYourLineFor(viewer, { skillId: lineSkill, name: "Line skill" }, { now: wall, db: db! });
      // Connections first, then the newest on the goal; four faces at most.
      expect(line).toEqual({ goalName: "Line skill", count: 4, initials: ["DI", expect.any(String), expect.any(String), expect.any(String)], tip: null });
      expect(new Set(line!.initials.slice(1))).toEqual(new Set(["AM", "SK", "RV"]));

      // Removing the connection takes Deepa out; a block ends it too.
      await db!.delete(schema.connections).where(and(eq(schema.connections.userLow, pairOf(viewer, friend).userLow), eq(schema.connections.userHigh, pairOf(viewer, friend).userHigh)));
      expect((await onYourLineFor(viewer, { skillId: lineSkill, name: "Line skill" }, { now: wall, db: db! }))?.count).toBe(3);
      // From the side of someone who blocked the viewer, the viewer is left out, and the person the viewer blocked counts:
      // Arjun, Sana, Ravi and that person.
      expect((await onYourLineFor(blocker, { skillId: lineSkill, name: "Line skill" }, { now: wall, db: db! }))?.count).toBe(4);
    });

    it("hides the card below three people, and on the first day counts only people who took the goal on this week", async () => {
      const viewer = await rider({ name: "Few Viewer", skill: fewSkill });
      await rider({ name: "Asha Rao", skill: fewSkill });
      await rider({ name: "Kiran Das", skill: fewSkill });
      expect(LINE_MIN_PEOPLE).toBe(3);
      expect(await onYourLineFor(viewer, { skillId: fewSkill, name: "Few skill" }, { now: wall, db: db! })).toBeNull();
      await rider({ name: "Old Timer", skill: fewSkill, createdAt: new Date(wall.getTime() - 10 * DAY) });
      expect((await onYourLineFor(viewer, { skillId: fewSkill, name: "Few skill" }, { now: wall, db: db! }))?.count).toBe(3);
      expect(await onYourLineFor(viewer, { skillId: fewSkill, name: "Few skill" }, { firstDay: true, now: wall, db: db! })).toBeNull();
    });
  });
});

describe("lineInitials", () => {
  it("takes the first letter of the first two words, letters only", () => {
    expect(lineInitials("Arjun Mehta")).toBe("AM");
    expect(lineInitials("  priya  ")).toBe("P");
    expect(lineInitials("(Ravi) Kumar Verma")).toBe("RK");
    expect(lineInitials("1234")).toBe("");
  });
});
