import { describe, expect, it } from "vitest";
import { mockQuestions, roleProfiles } from "@/content";
import {
  ABOUT_SKILLS,
  ANSWER_GRACE_MS,
  bankHrefFor,
  feedbackProblems,
  feedbackShowable,
  matchFeedback,
  MOCK_FEEDBACK_TEXT,
  pickInterviewQuestions,
  resultOf,
  sessionClosed,
  sessionDeadline,
  sessionEndOf,
  sessionRunning,
  sessionViewOf,
} from "./interview";
import { roleFor } from "./rules";

// The mock interview's rules (FR-50 part 3): questions picked by code from the bank, times, and the checks on the
// model's feedback. No database, no model.
const byId = new Map(mockQuestions.map((q) => [q.id, q]));
const analyst = roleFor(roleProfiles, "data-analyst", null);
const devops = roleFor(roleProfiles, "devops-engineer", null);
const SEED = "00000000-0000-4000-8000-000000000001";
const skillOf = (id: string) => byId.get(id)!.skillId;

describe("pickInterviewQuestions", () => {
  it("picks 4 for Quick and 8 for Full, all open bank questions, none twice, the same for the same seed", () => {
    const quick = pickInterviewQuestions(mockQuestions, analyst, "mix", "quick", SEED)!;
    const full = pickInterviewQuestions(mockQuestions, analyst, "mix", "full", SEED)!;
    expect(quick).toHaveLength(4);
    expect(full).toHaveLength(8);
    for (const ids of [quick, full]) {
      expect(new Set(ids).size).toBe(ids.length);
      expect(ids.every((id) => byId.get(id)?.kind === "open")).toBe(true);
    }
    expect(pickInterviewQuestions(mockQuestions, analyst, "mix", "quick", SEED)).toEqual(quick);
    const others = new Set(Array.from({ length: 6 }, (_, i) => pickInterviewQuestions(mockQuestions, analyst, "mix", "full", `seed-${i}`)!.join()));
    expect(others.size).toBeGreaterThan(1);
  });

  it("opens a mix with an about-you question, then the role's technical ones across its skills", () => {
    const ids = pickInterviewQuestions(mockQuestions, analyst, "mix", "full", SEED)!;
    expect(ABOUT_SKILLS.has(skillOf(ids[0]))).toBe(true);
    expect(ids.slice(0, 2).every((id) => ABOUT_SKILLS.has(skillOf(id)))).toBe(true);
    const technical = ids.slice(2);
    expect(technical.every((id) => !ABOUT_SKILLS.has(skillOf(id)) && byId.get(id)!.roleSlugs.includes("data-analyst"))).toBe(true);
    expect(new Set(technical.map(skillOf)).size).toBeGreaterThan(3);
  });

  it("keeps Technical to the role's tool questions and About you to the about-you ones, for any role", () => {
    const technical = pickInterviewQuestions(mockQuestions, analyst, "technical", "full", SEED)!;
    expect(technical.every((id) => !ABOUT_SKILLS.has(skillOf(id)))).toBe(true);
    // DevOps has no about-you questions of its own; they fit every role.
    const about = pickInterviewQuestions(mockQuestions, devops, "about", "full", SEED)!;
    expect(about).toHaveLength(8);
    expect(about.every((id) => ABOUT_SKILLS.has(skillOf(id)))).toBe(true);
  });

  it("asks about the person's open goals first for Your gaps, then fills from the role", () => {
    const ids = pickInterviewQuestions(mockQuestions, analyst, "gaps", "full", SEED, ["sql"])!;
    expect(ids).toHaveLength(8);
    expect(ids.slice(0, 5).every((id) => skillOf(id) === "sql")).toBe(true);
    expect(ids.slice(5).every((id) => skillOf(id) !== "sql")).toBe(true);
    // No goals with bank questions: a round from the role.
    expect(pickInterviewQuestions(mockQuestions, analyst, "gaps", "quick", SEED, [])).toHaveLength(4);
  });

  it("gives a role with few questions what it has, and nothing when the bank has none", () => {
    const tiny = { slug: "tiny-role", title: "Tiny", skills: [{ skillId: "sql" }] };
    const bank = mockQuestions.filter((q) => q.kind === "open" && q.skillId === "sql").map((q) => ({ ...q, roleSlugs: ["tiny-role"] }));
    expect(pickInterviewQuestions(bank, tiny, "technical", "full", SEED)).toHaveLength(5);
    expect(pickInterviewQuestions([], tiny, "mix", "quick", SEED)).toBeNull();
  });
});

describe("session times", () => {
  const startedAt = new Date("2026-10-20T05:30:00Z");
  const at = (s: number) => new Date(startedAt.getTime() + s * 1000);

  it("runs 10 minutes for Quick and 20 for Full, and takes answers for a minute more", () => {
    expect(sessionDeadline(startedAt, "quick")).toEqual(at(600));
    expect(sessionDeadline(startedAt, "full")).toEqual(at(1200));
    const quick = { startedAt, endedAt: null, length: "quick" as const };
    expect(sessionRunning(quick, at(600))).toBe(true);
    expect(sessionRunning(quick, at(601))).toBe(false);
    expect(sessionClosed(quick, at(600 + ANSWER_GRACE_MS / 1000))).toBe(false);
    expect(sessionClosed(quick, at(601 + ANSWER_GRACE_MS / 1000))).toBe(true);
    expect(sessionClosed({ ...quick, endedAt: at(30) }, at(31))).toBe(true);
    expect(sessionEndOf(quick, at(300))).toEqual(at(300));
    expect(sessionEndOf(quick, at(900))).toEqual(at(600));
  });

  it("builds the running view with saved answers, and the result with each question's words", () => {
    const ids = pickInterviewQuestions(mockQuestions, analyst, "mix", "quick", SEED)!;
    const row = { id: SEED, roleSlug: "data-analyst", length: "quick" as const, focus: "mix" as const, questionIds: ids, startedAt, endedAt: null };
    const view = sessionViewOf(row, [{ position: 2, answer: "My answer", whatWorked: null, addNextTime: null }], byId, "Data Analyst", at(60))!;
    expect(view.answers).toEqual(["", "My answer", "", ""]);
    expect(view.secondsLeft).toBe(540);
    expect(view.questions.map((q) => q.position)).toEqual([1, 2, 3, 4]);
    expect(JSON.stringify(view)).not.toContain("strongCovers");
    expect(sessionViewOf({ ...row, questionIds: ["no-such-question"] }, [], byId, "Data Analyst", at(60))).toBeNull();

    const answers = [{ position: 2, answer: "My answer", whatWorked: "Clear.", addNextTime: "An example." }];
    const ready = resultOf(row, answers, byId, "Data Analyst", "ready", "In words.");
    expect(ready).toMatchObject({ answered: 1, total: 4, feedback: "ready", summary: "In words." });
    expect(ready.items[1]).toMatchObject({ answer: "My answer", whatWorked: "Clear.", addNextTime: "An example." });
    expect(ready.items[0]).toMatchObject({ answer: null, whatWorked: null, bankHref: bankHrefFor("data-analyst") });
    expect(resultOf(row, answers, byId, "Data Analyst", "unavailable_today", "ignored").summary).toBeNull();
    expect(bankHrefFor("data-analyst")).toBe("/mock?tab=bank&role=data-analyst");
    expect(MOCK_FEEDBACK_TEXT.unavailable_today).toMatch(/isn't available today/);
  });
});

describe("feedback checks", () => {
  const words = (n: number) => Array.from({ length: n }, () => "word").join(" ");
  const ok = { summary: "You explain clearly.", questions: [{ position: 1, whatWorked: "Plain words.", addNextTime: "Name event 4625." }] };

  it("finds score words, score shapes, ready, made-up numbers, long parts and exclamation marks", () => {
    expect(feedbackProblems(ok, "event 4625 failed logon")).toEqual({ scoreWords: [], ready: [], numbers: [], tooLong: [], exclamations: 0 });
    expect(feedbackProblems(ok, "").numbers).toEqual(["4625"]);
    const bad = {
      summary: "I would rate this 7/10! You are nearly job ready.",
      questions: [{ position: 2, whatWorked: "Your score is high.", addNextTime: words(41) }],
    };
    const p = feedbackProblems(bad, "");
    expect(p.scoreWords).toEqual(expect.arrayContaining(["score", "7/10"]));
    expect(p.ready).toEqual(["ready"]);
    expect(p.numbers).toEqual(["7", "10"]);
    expect(p.tooLong).toEqual(["2.addNextTime"]);
    expect(p.exclamations).toBe(1);
    expect(feedbackProblems({ ...ok, summary: words(81) }, "").tooLong).toEqual(["summary"]);
    expect(feedbackProblems({ ...ok, summary: "That is four out of five." }, "").scoreWords).toHaveLength(1);
  });

  it("lets ordinary words through: 24/7, production-grade, already, a failed job", () => {
    const fine = { summary: "Monitoring runs 24/7 on a production-grade setup you already know.", questions: [{ position: 1, whatWorked: "You named the failed job.", addNextTime: "Say what you check first." }] };
    expect(feedbackShowable(fine)).toBe(true);
    expect(feedbackShowable({ ...fine, summary: "You are not ready yet." })).toBe(false);
    expect(feedbackShowable({ ...fine, summary: "A strong rating overall." })).toBe(false);
  });

  it("matches the feedback to the answered positions, exactly once each", () => {
    const f = { summary: "s", questions: [{ position: 3, whatWorked: "a", addNextTime: "b" }, { position: 1, whatWorked: "c", addNextTime: "d" }] };
    expect(matchFeedback(f, [1, 3])?.questions.map((q) => q.position)).toEqual([1, 3]);
    expect(matchFeedback(f, [1])).toBeNull();
    expect(matchFeedback(f, [1, 2, 3])).toBeNull();
    expect(matchFeedback({ ...f, questions: [f.questions[1], f.questions[1]] }, [1, 3])).toBeNull();
  });
});
