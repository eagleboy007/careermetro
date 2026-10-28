import { describe, expect, it } from "vitest";
import {
  MOCK_ANSWER_MAX_CHARS,
  MOCK_FEEDBACK_PER_DAY,
  MOCK_FOLLOW_UP_MIN_WORDS,
  MOCK_FOLLOW_UPS_PER_ROUND,
  MOCK_LENGTH_MINUTES,
  MOCK_LENGTH_QUESTIONS,
  MOCK_SESSIONS_PER_DAY,
  mockInterviewAnswerInput,
  mockInterviewEndInput,
  mockInterviewFeedback,
  mockInterviewStartInput,
  mockSessionResult,
  mockSessionView,
  saveFollowUpAnswerInput,
} from "./index";

// The mock interview's inputs, the model's output and what the screen gets (FR-50 part 3).
const SESSION = "00000000-0000-4000-8000-000000000038";

describe("mock interview schemas", () => {
  it("keeps the lengths and limits the plan sets", () => {
    expect(MOCK_LENGTH_QUESTIONS).toEqual({ quick: 4, full: 8 });
    expect(MOCK_LENGTH_MINUTES).toEqual({ quick: 10, full: 20 });
    expect([MOCK_SESSIONS_PER_DAY, MOCK_FEEDBACK_PER_DAY, MOCK_ANSWER_MAX_CHARS]).toEqual([5, 5, 4000]);
  });

  it("starts only with a role slug, a length and a focus it knows", () => {
    expect(mockInterviewStartInput.safeParse({ roleSlug: "data-analyst", length: "quick", focus: "mix" }).success).toBe(true);
    expect(mockInterviewStartInput.safeParse({ roleSlug: "data-analyst", length: "long", focus: "mix" }).success).toBe(false);
    expect(mockInterviewStartInput.safeParse({ roleSlug: "data-analyst", length: "full", focus: "salary" }).success).toBe(false);
    expect(mockInterviewStartInput.safeParse({ roleSlug: "Data Analyst", length: "full", focus: "gaps" }).success).toBe(false);
    expect(mockInterviewStartInput.safeParse({ roleSlug: "data-analyst", length: "full", focus: "gaps", extra: 1 }).success).toBe(false);
  });

  it("names the job in My jobs for a round on this job's skills, and only then", () => {
    const job = { kind: "check", checkId: SESSION };
    expect(mockInterviewStartInput.safeParse({ roleSlug: "data-analyst", length: "quick", focus: "job", job }).success).toBe(true);
    expect(mockInterviewStartInput.safeParse({ roleSlug: "data-analyst", length: "quick", focus: "job" }).success).toBe(false);
    expect(mockInterviewStartInput.safeParse({ roleSlug: "data-analyst", length: "quick", focus: "mix", job }).success).toBe(false);
    expect(mockInterviewStartInput.safeParse({ roleSlug: "data-analyst", length: "quick", focus: "job", job: { kind: "check", checkId: "x" } }).success).toBe(false);
  });

  it("takes an answer of up to 4,000 characters after trimming, at positions 1 to 8; empty is a skip", () => {
    const ok = mockInterviewAnswerInput.safeParse({ sessionId: SESSION, position: 1, answer: "  I would start with the data.  " });
    expect(ok.success && ok.data.answer).toBe("I would start with the data.");
    expect(mockInterviewAnswerInput.safeParse({ sessionId: SESSION, position: 2, answer: "" }).success).toBe(true);
    expect(mockInterviewAnswerInput.safeParse({ sessionId: SESSION, position: 1, answer: "x".repeat(4001) }).success).toBe(false);
    expect(mockInterviewAnswerInput.safeParse({ sessionId: SESSION, position: 0, answer: "a" }).success).toBe(false);
    expect(mockInterviewAnswerInput.safeParse({ sessionId: SESSION, position: 9, answer: "a" }).success).toBe(false);
    expect(mockInterviewAnswerInput.safeParse({ sessionId: "not-a-uuid", position: 1, answer: "a" }).success).toBe(false);
    expect(mockInterviewEndInput.safeParse({ sessionId: SESSION, answers: [] }).success).toBe(true);
    expect(mockInterviewEndInput.safeParse({ sessionId: SESSION, answers: Array.from({ length: 9 }, () => ({ position: 1, answer: "a" })) }).success).toBe(false);
  });

  it("reads the model's feedback in words, and refuses empty words", () => {
    const good = { summary: "You start in the right place.", questions: [{ position: 1, whatWorked: "Plain words.", addNextTime: "One example." }] };
    expect(mockInterviewFeedback.safeParse(good).success).toBe(true);
    expect(mockInterviewFeedback.safeParse({ ...good, summary: " " }).success).toBe(false);
    expect(mockInterviewFeedback.safeParse({ ...good, questions: [] }).success).toBe(false);
    expect(mockInterviewFeedback.safeParse({ summary: "x" }).success).toBe(false);
  });

  it("describes a running session and a result without any score field", () => {
    const view = {
      id: SESSION,
      roleSlug: "data-analyst",
      roleTitle: "Data Analyst",
      length: "quick",
      focus: "mix",
      job: null,
      questions: [{ position: 1, id: "sql-1", topic: "SQL", question: "Explain a join." }],
      answers: [""],
      secondsLeft: 600,
    };
    expect(mockSessionView.safeParse(view).success).toBe(true);
    expect(mockSessionView.safeParse({ ...view, focus: "job", job: { company: "Zephyr Payments", title: "SOC analyst" } }).success).toBe(true);
    expect(mockSessionView.safeParse({ ...view, job: undefined }).success).toBe(false);
    const result = {
      id: SESSION,
      roleTitle: "Data Analyst",
      job: null,
      length: "quick",
      answered: 1,
      total: 1,
      feedback: "ready",
      summary: "Clear and in order.",
      items: [
        { position: 1, id: "sql-1", topic: "SQL", question: "Explain a join.", answer: "A join...", whatWorked: "Order.", addNextTime: "An example.", followUp: null, bankHref: "/mock?tab=bank" },
      ],
    };
    expect(mockSessionResult.safeParse(result).success).toBe(true);
    const withFollowUp = { ...result, items: [{ ...result.items[0], followUp: { question: "Which join keeps every customer?", answer: "A left join." } }] };
    expect(mockSessionResult.safeParse(withFollowUp).success).toBe(true);
    expect(mockSessionResult.safeParse({ ...result, items: [{ ...result.items[0], followUp: { question: "Which join?", answer: null } }] }).success).toBe(true);
    expect(mockSessionResult.safeParse({ ...result, items: [{ ...result.items[0], followUp: { question: "Which join?", answer: "x", score: 1 } }] }).success).toBe(false);
    expect(mockSessionResult.safeParse({ ...result, items: [{ ...result.items[0], followUp: undefined }] }).success).toBe(false);
    expect(mockSessionResult.safeParse({ ...result, score: 7 }).success).toBe(false);
    expect(mockSessionResult.safeParse({ ...result, feedback: "graded" }).success).toBe(false);
  });

  it("takes a follow-up reply of 1 to 4,000 characters after trimming, and an open follow-up's draft with the end", () => {
    expect([MOCK_FOLLOW_UP_MIN_WORDS, MOCK_FOLLOW_UPS_PER_ROUND]).toEqual([20, { quick: 2, full: 4 }]);
    const ok = saveFollowUpAnswerInput.safeParse({ sessionId: SESSION, position: 2, answer: "  A known scanner hits many accounts.  " });
    expect(ok.success && ok.data.answer).toBe("A known scanner hits many accounts.");
    expect(saveFollowUpAnswerInput.safeParse({ sessionId: SESSION, position: 2, answer: "   " }).success).toBe(false);
    expect(saveFollowUpAnswerInput.safeParse({ sessionId: SESSION, position: 2, answer: "x".repeat(4001) }).success).toBe(false);
    expect(saveFollowUpAnswerInput.safeParse({ sessionId: SESSION, position: 9, answer: "a" }).success).toBe(false);
    expect(saveFollowUpAnswerInput.safeParse({ sessionId: SESSION, position: 1, answer: "a", followUpId: "x" }).success).toBe(false);
    expect(mockInterviewEndInput.safeParse({ sessionId: SESSION, answers: [], followUps: [{ position: 1, answer: "My reply" }] }).success).toBe(true);
    expect(mockInterviewEndInput.safeParse({ sessionId: SESSION, answers: [], followUps: [{ position: 1, answer: "x".repeat(4001) }] }).success).toBe(false);
  });
});
