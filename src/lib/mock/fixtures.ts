import { mockQuestions, roleProfiles } from "@/content";
import type { MockFollowUpAsked, MockPageView, MockSessionResult, MockSessionView, RolePrepView, TimedTestReview, TimedTestView } from "@/lib/schemas";
import { pickInterviewQuestions, resultOf, sessionViewOf } from "./interview";
import { bankViewFor, choicePool, followUpsOf, mockRoles, pickTestQuestions, prepForJobs, reviewOf, roleFor, scorePicks, testViewOf, unreviewedAllowed } from "./rules";

/*
 * Example data for /mock with no sign-in, and for /design: the real bank for a role, a running test and its review.
 * Built from the bank with the same rules as the store, so it never drifts from the content. Nothing here is saved.
 */

const byId = new Map(mockQuestions.map((q) => [q.id, q]));
const STARTED = new Date("2026-10-20T05:30:00Z");
const EXAMPLE_ID = "00000000-0000-4000-8000-000000000012";

/** Interview prep for example Departures roles (for /design), Free or Elite, from the real bank. */
export const exampleDeparturesPrep = (jobs: readonly { id: string; roleSlug: string | null }[], elite: boolean): Record<string, RolePrepView | null> =>
  prepForJobs(jobs, mockQuestions, roleProfiles, elite);

/**
 * /mock with example data: the bank for the role asked for (Data Analyst by default), Free or Elite, with a running
 * test or round. `allowUnreviewed` defaults to `unreviewedAllowed()`, so a production deployment shows no content still
 * waiting for review; tests pass it explicitly.
 */
export function exampleMockPage(
  askedRole: string | null,
  elite: boolean,
  test: TimedTestView | null = null,
  interview: MockSessionView | null = null,
  allowUnreviewed = unreviewedAllowed(),
): MockPageView {
  const roles = mockRoles(mockQuestions, roleProfiles, allowUnreviewed);
  const role = roleFor(roleProfiles, askedRole, null);
  return { elite, role: roles.find((r) => r.slug === role.slug)!, roles, bank: bankViewFor(mockQuestions, role, elite, allowUnreviewed), test, interview };
}

const analyst = roleFor(roleProfiles, "data-analyst", null);
const ids = pickTestQuestions(choicePool(mockQuestions, analyst, unreviewedAllowed()), EXAMPLE_ID) ?? [];
/** Picks for the example: the right answer on most, a wrong one on two, none on the last. */
const picks = ids.map((id, i) => {
  const q = byId.get(id);
  if (q?.kind !== "choice" || i === ids.length - 1) return -1;
  return i === 2 || i === 7 ? (q.answer + 1) % q.options.length : q.answer;
});
const row = { id: EXAMPLE_ID, roleSlug: analyst.slug, questionIds: ids, picks, startedAt: STARTED, endedAt: null, right: null };

/**
 * A Data Analyst test with 9 minutes left and the first four answered. Null where there aren't enough checked questions
 * for a test (drafts are hidden there, for example in a build with no VERCEL_ENV).
 */
export const exampleTimedTest: TimedTestView | null = ids.length === 0 ? null : testViewOf(
  { ...row, picks: picks.map((p, i) => (i < 4 ? p : -1)) },
  byId,
  analyst.title,
  new Date(STARTED.getTime() + 6 * 60_000),
);

/** The same test finished after 11 minutes 40 seconds; null like the test above. */
export const exampleTimedReview: TimedTestReview | null = ids.length === 0 ? null : reviewOf(
  { ...row, endedAt: new Date(STARTED.getTime() + 700_000), right: scorePicks(ids, picks, byId) },
  byId,
  analyst.title,
);

const INTERVIEW_ID = "00000000-0000-4000-8000-000000000038";
const interviewRow = {
  id: INTERVIEW_ID,
  roleSlug: analyst.slug,
  length: "quick" as const,
  focus: "mix" as const,
  questionIds: pickInterviewQuestions(mockQuestions, analyst, "mix", "quick", INTERVIEW_ID) ?? [],
  startedAt: STARTED,
  endedAt: null,
};
const exampleAnswers = [
  { position: 1, answer: "I would write down each change with the person who asked for it, show what it moves out of the sprint, and agree with them which change waits.", whatWorked: "You make the cost of each change visible before saying yes, which is what a team wants.", addNextTime: "Close with how you would stop it happening again, such as a short weekly check on requirements." },
  { position: 2, answer: "I would keep the raw data on one sheet and build the report from a pivot table, so next month I only paste the new rows and refresh.", whatWorked: "Separating the raw data from the report is the right first step.", addNextTime: "Say how you would check the refreshed numbers, for example against last month's total." },
];

// The first question's first follow-up from the bank (an about-you question, which has follow-ups waiting for review).
const firstQuestion = byId.get(interviewRow.questionIds[0] ?? "");
const firstFollowUp = firstQuestion ? (followUpsOf(firstQuestion, unreviewedAllowed())[0] ?? null) : null;

/** The follow-up the interviewer asks after the example round's first answer (for /design), if the bank has one. */
export const exampleMockFollowUp: MockFollowUpAsked | null = firstQuestion && firstFollowUp ? { position: 1, topic: firstQuestion.topic, text: firstFollowUp.text } : null;

/** A quick Data Analyst round with 6 minutes left and the first two answered. */
export const exampleMockSession: MockSessionView | null = sessionViewOf(
  interviewRow,
  exampleAnswers.map((a) => ({ ...a, whatWorked: null, addNextTime: null })),
  byId,
  analyst.title,
  new Date(STARTED.getTime() + 4 * 60_000),
);

/** The same round ended with two of four answered, the first with its follow-up answered, and feedback in words. */
export const exampleMockResult: MockSessionResult = resultOf(
  { ...interviewRow, endedAt: new Date(STARTED.getTime() + 7 * 60_000) },
  exampleAnswers.map((a) =>
    a.position === 1 && firstFollowUp
      ? { ...a, followUpId: firstFollowUp.id, followUpAnswer: "I would agree a cut-off day each sprint for changes, and anything later goes into the next one unless the product owner says it can't wait." }
      : a,
  ),
  byId,
  analyst.title,
  "ready",
  "You explain in plain words and start in the right place. The thing to practise next is the step after: how you would check the result and keep it from going wrong again.",
);
