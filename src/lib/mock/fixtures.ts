import { mockQuestions, roleProfiles } from "@/content";
import type { MockPageView, MockSessionResult, MockSessionView, RolePrepView, TimedTestReview, TimedTestView } from "@/lib/schemas";
import { pickInterviewQuestions, resultOf, sessionViewOf } from "./interview";
import { bankViewFor, choicePool, mockRoles, pickTestQuestions, prepForJobs, reviewOf, roleFor, scorePicks, testViewOf } from "./rules";

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

/** /mock with example data: the bank for the role asked for (Data Analyst by default), Free or Elite, with a running test or round. */
export function exampleMockPage(askedRole: string | null, elite: boolean, test: TimedTestView | null = null, interview: MockSessionView | null = null): MockPageView {
  const roles = mockRoles(mockQuestions, roleProfiles, true);
  const role = roleFor(roleProfiles, askedRole, null);
  return { elite, role: roles.find((r) => r.slug === role.slug)!, roles, bank: bankViewFor(mockQuestions, role, elite), test, interview };
}

const analyst = roleFor(roleProfiles, "data-analyst", null);
const ids = pickTestQuestions(choicePool(mockQuestions, analyst, true), EXAMPLE_ID) ?? [];
/** Picks for the example: the right answer on most, a wrong one on two, none on the last. */
const picks = ids.map((id, i) => {
  const q = byId.get(id);
  if (q?.kind !== "choice" || i === ids.length - 1) return -1;
  return i === 2 || i === 7 ? (q.answer + 1) % q.options.length : q.answer;
});
const row = { id: EXAMPLE_ID, roleSlug: analyst.slug, questionIds: ids, picks, startedAt: STARTED, endedAt: null, right: null };

/** A Data Analyst test with 9 minutes left and the first four answered. */
export const exampleTimedTest: TimedTestView | null = testViewOf(
  { ...row, picks: picks.map((p, i) => (i < 4 ? p : -1)) },
  byId,
  analyst.title,
  new Date(STARTED.getTime() + 6 * 60_000),
);

/** The same test finished after 11 minutes 40 seconds. */
export const exampleTimedReview: TimedTestReview = reviewOf(
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

/** A quick Data Analyst round with 6 minutes left and the first two answered. */
export const exampleMockSession: MockSessionView | null = sessionViewOf(
  interviewRow,
  exampleAnswers.map((a) => ({ ...a, whatWorked: null, addNextTime: null })),
  byId,
  analyst.title,
  new Date(STARTED.getTime() + 4 * 60_000),
);

/** The same round ended with two of four answered, and feedback in words. */
export const exampleMockResult: MockSessionResult = resultOf(
  { ...interviewRow, endedAt: new Date(STARTED.getTime() + 7 * 60_000) },
  exampleAnswers,
  byId,
  analyst.title,
  "ready",
  "You explain in plain words and start in the right place. The thing to practise next is the step after: how you would check the result and keep it from going wrong again.",
);
