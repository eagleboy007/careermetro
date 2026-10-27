import { describe, expect, it } from "vitest";
import { mockQuestions, roleProfiles } from "@/content";
import { rolePrepView, type MockChoiceQuestion, type MockQuestion } from "@/lib/schemas";
import {
  bankViewFor,
  choicePool,
  deadlineOf,
  emptyPicks,
  endOf,
  followUpsOf,
  followUpStateFor,
  freeOpenIds,
  hash32,
  isOver,
  mockRoles,
  NO_PICK,
  pickTestQuestions,
  prepForJobs,
  reviewOf,
  roleFor,
  rolePrepFor,
  scorePicks,
  testViewOf,
  TIMED_TEST_MESSAGES,
  unreviewedAllowed,
  withPick,
} from "./rules";

// Interview prep rules (FR-50 part 2) over a made-up bank: no model anywhere, the same answer every time.
const analyst = { slug: "data-analyst", title: "Data Analyst", skills: [{ skillId: "sql" }, { skillId: "excel" }, { skillId: "communication" }] };
const writer = { slug: "tech-writer", title: "Technical Writer", skills: [{ skillId: "communication" }] };
const roles = [writer, analyst];

const openQ = (skillId: string, n: number, topic: string, roleSlugs = ["data-analyst"]): MockQuestion => ({
  id: `${skillId}-${n}`,
  kind: "open",
  roleSlugs,
  skillId,
  topic,
  question: `Open question ${n} on ${skillId}`,
  strongCovers: `What a strong answer to ${n} covers`,
  level: "L1",
});
const choiceQ = (skillId: string, n: number, reviewed = true): MockChoiceQuestion => ({
  id: `${skillId}-mc-${n}`,
  kind: "choice",
  roleSlugs: ["data-analyst"],
  skillId,
  topic: skillId.toUpperCase(),
  question: `Choice question ${n} on ${skillId}`,
  options: ["A", "B", "C", "D"],
  answer: n % 4,
  explanation: `Why ${n % 4} is right`,
  level: "L1",
  reviewed,
});

const bank: MockQuestion[] = [
  openQ("communication", 1, "Communication", ["data-analyst", "tech-writer"]),
  openQ("communication", 2, "Communication", ["data-analyst", "tech-writer"]),
  openQ("sql", 1, "SQL"),
  openQ("sql", 2, "SQL"),
  openQ("sql", 3, "SQL"),
  openQ("excel", 1, "Excel"),
  openQ("excel", 2, "Excel"),
  ...[1, 2, 3, 4, 5, 6, 7, 8].map((n) => choiceQ("sql", n)),
  ...[1, 2, 3, 4, 5].map((n) => choiceQ("excel", n)),
  choiceQ("excel", 6, false),
];
const byId = new Map(bank.map((q) => [q.id, q]));

describe("which role /mock opens on", () => {
  it("is the one asked for, else the target role, else Data Analyst", () => {
    expect(roleFor(roles, "tech-writer", "data-analyst").slug).toBe("tech-writer");
    expect(roleFor(roles, "no-such-role", "tech-writer").slug).toBe("tech-writer");
    expect(roleFor(roles, null, null).slug).toBe("data-analyst");
    expect(roleFor([writer], null, null).slug).toBe("tech-writer");
  });

  it("says which roles have enough questions for a test, counting unreviewed ones only where allowed", () => {
    expect(mockRoles(bank, roles, false)).toEqual([
      { slug: "tech-writer", title: "Technical Writer", hasTest: false, followUps: "none" },
      { slug: "data-analyst", title: "Data Analyst", hasTest: true, followUps: "none" },
    ]);
    expect(choicePool(bank, analyst, false)).toHaveLength(13);
    expect(choicePool(bank, analyst, true)).toHaveLength(14);
    expect(mockRoles(bank.filter((q) => q.id !== "sql-mc-8" && q.id !== "sql-mc-7"), roles, false)[1].hasTest).toBe(false);
  });

  it("uses unreviewed questions on preview, development, local dev and tests only (T86)", () => {
    expect(unreviewedAllowed({ VERCEL_ENV: "production" })).toBe(false);
    expect(unreviewedAllowed({ VERCEL_ENV: "production", NODE_ENV: "development" })).toBe(false);
    expect(unreviewedAllowed({ VERCEL_ENV: "preview", NODE_ENV: "production" })).toBe(true);
    expect(unreviewedAllowed({ VERCEL_ENV: "development" })).toBe(true);
    expect(unreviewedAllowed({ NODE_ENV: "development" })).toBe(true);
    expect(unreviewedAllowed({ NODE_ENV: "test" })).toBe(true);
    expect(unreviewedAllowed({ NODE_ENV: "production" })).toBe(false);
    expect(unreviewedAllowed({ VERCEL_ENV: "other", NODE_ENV: "development" })).toBe(false);
    expect(unreviewedAllowed({})).toBe(false);
  });
});

describe("the question bank", () => {
  it("lists the role's open questions in its skill order, never the multiple-choice ones", () => {
    const view = bankViewFor(bank, analyst, true);
    expect(view.items.map((q) => q.id)).toEqual(["sql-1", "sql-2", "sql-3", "excel-1", "excel-2", "communication-1", "communication-2"]);
    expect(view.topics).toEqual(["SQL", "Excel", "Communication"]);
    expect(bankViewFor(bank, writer, true).items.map((q) => q.id)).toEqual(["communication-1", "communication-2"]);
  });

  it("opens everything on Elite, with a link into Practice for each question", () => {
    const view = bankViewFor(bank, analyst, true);
    expect(view.items.every((q) => q.open)).toBe(true);
    expect(view.items[0]).toEqual({
      open: true,
      id: "sql-1",
      topic: "SQL",
      question: "Open question 1 on sql",
      strongCovers: "What a strong answer to 1 covers",
      followUps: [],
      practiceHref: "/practice?q=sql-1",
    });
  });

  it("opens one main-language question of the free five, so the rest go to other required skills (T129)", () => {
    const engineer = roleProfiles.find((r) => r.slug === "software-engineer")!;
    const languages = new Set(engineer.skills.filter((s) => s.oneOf === "main-language").map((s) => s.skillId));
    const skill = new Map(mockQuestions.map((q) => [q.id, q.skillId]));
    const open = bankViewFor(mockQuestions, engineer, false).items.filter((q) => q.open);
    expect(open).toHaveLength(5);
    expect(open.filter((q) => languages.has(skill.get(q.id)!))).toHaveLength(1);
  });

  it("opens 5 on Free, one of each topic first, and sends nothing of the locked ones' notes", () => {
    const view = bankViewFor(bank, analyst, false);
    const open = view.items.filter((q) => q.open).map((q) => q.id);
    // The first of each topic (SQL, Excel, Communication), then the next ones in order.
    expect(open).toEqual(["sql-1", "sql-2", "sql-3", "excel-1", "communication-1"]);
    expect([...freeOpenIds(view.items.map((q) => byId.get(q.id)!))]).toEqual(["sql-1", "excel-1", "communication-1", "sql-2", "sql-3"]);
    const locked = view.items.filter((q) => !q.open);
    expect(locked).toHaveLength(2);
    expect(JSON.stringify(locked)).not.toContain("strong answer");
    expect(JSON.stringify(locked)).not.toContain("/practice");
  });

  it("opens all of a role with 5 or fewer questions on Free", () => {
    expect(bankViewFor(bank, writer, false).items.every((q) => q.open)).toBe(true);
  });
});

describe("follow-ups in the bank (docs/plans/mock-followups-plan.md)", () => {
  const withFollowUps = (q: MockQuestion, reviewed: boolean): MockQuestion =>
    q.kind === "open"
      ? {
          ...q,
          followUps: [
            { id: `${q.id}-fu-1`, text: `Follow-up one on ${q.id}?`, skipIf: ["example"] },
            { id: `${q.id}-fu-2`, text: `Follow-up two on ${q.id}?`, skipIf: [] },
          ],
          followUpsReviewed: reviewed,
        }
      : q;
  const draft = bank.map((q) => (q.id === "sql-1" ? withFollowUps(q, false) : q));
  const checked = bank.map((q) => (q.id === "sql-1" ? withFollowUps(q, true) : q));

  it("asks reviewed follow-ups anywhere and unreviewed ones only where allowed, never for a choice question", () => {
    const q = draft.find((x) => x.id === "sql-1")!;
    expect(followUpsOf(q, true).map((f) => f.id)).toEqual(["sql-1-fu-1", "sql-1-fu-2"]);
    expect(followUpsOf(q, false)).toEqual([]);
    expect(followUpsOf(checked.find((x) => x.id === "sql-1")!, false)).toHaveLength(2);
    expect(followUpsOf(bank.find((x) => x.kind === "choice")!, true)).toEqual([]);
  });

  it("says whether a role's rounds can ask follow-ups: none, waiting for review, or checked", () => {
    expect(followUpStateFor(bank, analyst, true)).toBe("none");
    expect(followUpStateFor(draft, analyst, true)).toBe("draft");
    expect(followUpStateFor(draft, analyst, false)).toBe("none");
    expect(followUpStateFor(checked, analyst, false)).toBe("checked");
    // The writer's rounds never ask sql-1; an about-you question's follow-ups count for every role.
    expect(followUpStateFor(checked, writer, true)).toBe("none");
    const about = bank.map((q) => (q.id === "communication-1" ? withFollowUps(q, true) : q));
    expect(followUpStateFor(about, { slug: "devops", title: "DevOps", skills: [] }, false)).toBe("checked");
    expect(followUpStateFor([...checked.filter((q) => q.id !== "sql-2"), withFollowUps(bank.find((q) => q.id === "sql-2")!, false)], analyst, true)).toBe("draft");
  });

  it("lists an open question's follow-ups in the bank to study, and none for a locked one", () => {
    expect(bankViewFor(checked, analyst, true).items[0]).toMatchObject({ open: true, followUps: ["Follow-up one on sql-1?", "Follow-up two on sql-1?"] });
    expect(bankViewFor(draft, analyst, true, false).items[0]).toMatchObject({ followUps: [] });
    expect(bankViewFor(draft, analyst, true, true).items[0]).toMatchObject({ followUps: ["Follow-up one on sql-1?", "Follow-up two on sql-1?"] });
    const lockedBank = checked.map((q) => (q.id === "communication-2" ? withFollowUps(q, true) : q));
    const locked = bankViewFor(lockedBank, analyst, false).items.find((i) => i.id === "communication-2")!;
    expect(locked.open).toBe(false);
    expect(JSON.stringify(locked)).not.toContain("Follow-up");
  });
});

describe("interview prep for a Departures role", () => {
  // Two more questions, so the analyst has four the bank opens only on Elite: sql-4, excel-2, excel-3, communication-2.
  const prepBank = [...bank, openQ("sql", 4, "SQL"), openQ("excel", 3, "Excel")];

  it("is the bank's first Free question, then four it opens only on Elite, all open on Elite", () => {
    const prep = rolePrepFor(prepBank, analyst, true)!;
    expect(rolePrepView.safeParse(prep).success).toBe(true);
    expect(prep.questions.map((q) => q.id)).toEqual(["sql-1", "sql-4", "excel-2", "excel-3", "communication-2"]);
    expect(prep.questions.every((q) => q.open)).toBe(true);
    expect(prep.questions[0]).toEqual({ open: true, id: "sql-1", question: "Open question 1 on sql" });
  });

  it("locks only questions the bank never opens on Free", () => {
    const free = new Set(bankViewFor(prepBank, analyst, false).items.filter((q) => q.open).map((q) => q.id));
    const locked = rolePrepFor(prepBank, analyst, false)!.questions.filter((q) => !q.open);
    expect(locked).toHaveLength(4);
    expect(locked.some((q) => free.has(q.id))).toBe(false);
  });

  it("opens only the first on Free and sends no text of the locked four", () => {
    const prep = rolePrepFor(prepBank, analyst, false)!;
    expect(rolePrepView.safeParse(prep).success).toBe(true);
    expect(prep.elite).toBe(false);
    expect(prep.questions.map((q) => q.open)).toEqual([true, false, false, false, false]);
    const locked = prep.questions.slice(1);
    expect(locked).toEqual([{ open: false, id: "sql-4" }, { open: false, id: "excel-2" }, { open: false, id: "excel-3" }, { open: false, id: "communication-2" }]);
    expect(JSON.stringify(locked)).not.toContain("question");
    // The schema refuses a locked question that carries its text.
    expect(rolePrepView.safeParse({ ...prep, questions: prep.questions.map((q) => ({ ...q, question: "Leaked question text" })) }).success).toBe(false);
  });

  it("is null for a role with fewer than four Elite-only questions, so the screen says it is coming", () => {
    // The plain bank leaves the analyst only two (excel-2, communication-2); the writer has none.
    expect(rolePrepFor(bank, analyst, true)).toBeNull();
    expect(rolePrepFor(bank, writer, true)).toBeNull();
  });

  it("maps each job to its role's prep, and a job with no bank role to null", () => {
    const prep = prepForJobs(
      [
        { id: "j1", roleSlug: "data-analyst" },
        { id: "j2", roleSlug: null },
        { id: "j3", roleSlug: "no-such-role" },
        { id: "j4", roleSlug: "tech-writer" },
      ],
      prepBank,
      roles,
      false,
    );
    expect(prep.j1?.questions[0].open).toBe(true);
    expect(prep.j2).toBeNull();
    expect(prep.j3).toBeNull();
    expect(prep.j4).toBeNull();
  });
});

describe("picking a timed test", () => {
  const pool = choicePool(bank, analyst, false);

  it("picks 12, the same for the same seed, and mixes the role's skills", () => {
    const a = pickTestQuestions(pool, "seed-1")!;
    expect(a).toHaveLength(12);
    expect(new Set(a).size).toBe(12);
    expect(pickTestQuestions(pool, "seed-1")).toEqual(a);
    // Taken in turns: the first two come from two different skills.
    expect(new Set(a.slice(0, 2).map((id) => byId.get(id)!.skillId)).size).toBe(2);
    expect(a.every((id) => byId.get(id)?.kind === "choice")).toBe(true);
    const seen = new Set<string>();
    for (let i = 0; i < 20; i++) seen.add(pickTestQuestions(pool, `seed-${i}`)!.join());
    expect(seen.size).toBeGreaterThan(1);
  });

  it("gives no test when the pool has fewer than 12", () => {
    expect(pickTestQuestions(pool.slice(0, 11), "seed-1")).toBeNull();
  });

  it("hashes the same way everywhere", () => {
    expect(hash32("")).toBe(0x811c9dc5);
    expect(hash32("a")).toBe(0xe40c292c);
  });
});

describe("the 15 minutes", () => {
  const start = new Date("2026-10-20T10:00:00Z");
  it("ends at 15 minutes, and a finished test takes nothing more", () => {
    expect(deadlineOf(start).toISOString()).toBe("2026-10-20T10:15:00.000Z");
    expect(isOver({ startedAt: start, endedAt: null }, new Date("2026-10-20T10:15:00Z"))).toBe(false);
    expect(isOver({ startedAt: start, endedAt: null }, new Date("2026-10-20T10:15:00.001Z"))).toBe(true);
    expect(isOver({ startedAt: start, endedAt: new Date("2026-10-20T10:05:00Z") }, new Date("2026-10-20T10:06:00Z"))).toBe(true);
  });

  it("ends a late finish at the deadline", () => {
    expect(endOf(start, new Date("2026-10-20T10:09:00Z")).toISOString()).toBe("2026-10-20T10:09:00.000Z");
    expect(endOf(start, new Date("2026-10-20T11:00:00Z")).toISOString()).toBe("2026-10-20T10:15:00.000Z");
  });
});

describe("scoring and the review", () => {
  const ids = ["sql-mc-1", "sql-mc-2", "excel-mc-3", "excel-mc-4"];

  it("counts a pick only when it is the right option of the question at that place", () => {
    expect(scorePicks(ids, [1, 2, 3, 0], byId)).toBe(4);
    expect(scorePicks(ids, [1, 2, 0, NO_PICK], byId)).toBe(2);
    expect(scorePicks(ids, emptyPicks(4), byId)).toBe(0);
    // An open question or one that left the bank never counts.
    expect(scorePicks(["sql-1", "gone-mc-1"], [0, 0], byId)).toBe(0);
  });

  it("changes one pick, only for the test's own questions and real options", () => {
    expect(withPick(ids, emptyPicks(4), byId, "excel-mc-3", 2)).toEqual([NO_PICK, NO_PICK, 2, NO_PICK]);
    expect(withPick(ids, [1, 2, 3, 0], byId, "sql-mc-1", 0)).toEqual([0, 2, 3, 0]);
    expect(withPick(ids, emptyPicks(4), byId, "sql-mc-5", 1)).toBeNull();
    expect(withPick(ids, emptyPicks(4), byId, "sql-mc-1", 4)).toBeNull();
    expect(withPick(ids, emptyPicks(4), byId, "sql-1", 0)).toBeNull();
  });

  const start = new Date("2026-10-20T10:00:00Z");
  const row = { id: "t1", roleSlug: "data-analyst", questionIds: ids, picks: [1, 0, NO_PICK, 0], startedAt: start, endedAt: null, right: null };

  it("shows a running test without the answers, with the time left", () => {
    const view = testViewOf(row, byId, "Data Analyst", new Date("2026-10-20T10:06:30Z"))!;
    expect(view.secondsLeft).toBe(510);
    expect(view.picks).toEqual([1, 0, null, 0]);
    expect(JSON.stringify(view)).not.toMatch(/answer|explanation|Why/);
    expect(testViewOf(row, byId, "Data Analyst", new Date("2026-10-20T11:00:00Z"))!.secondsLeft).toBe(0);
    expect(testViewOf({ ...row, questionIds: ["gone-mc-1", ...ids.slice(1)] }, byId, "Data Analyst", start)).toBeNull();
  });

  it("reviews every question with the pick, the right answer and why, and the count right", () => {
    const review = reviewOf({ ...row, endedAt: new Date("2026-10-20T10:11:40Z"), right: 2 }, byId, "Data Analyst");
    expect(review.right).toBe(2);
    expect(review.total).toBe(4);
    expect(review.secondsUsed).toBe(700);
    expect(review.items.map((q) => [q.pick, q.answer])).toEqual([
      [1, 1],
      [0, 2],
      [null, 3],
      [0, 0],
    ]);
    expect(review.items[1].explanation).toBe("Why 2 is right");
  });

  it("words each refusal, and tells a Free person to turn on Elite", () => {
    expect(TIMED_TEST_MESSAGES.not_elite).toBe("Turn on Elite to use this.");
    expect(TIMED_TEST_MESSAGES.no_test).toBe("Timed test for this role is coming.");
    expect(TIMED_TEST_MESSAGES.limit).toMatch(/10 tests today/);
  });
});
