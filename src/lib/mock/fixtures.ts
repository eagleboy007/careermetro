import { mockQuestions, roleProfiles } from "@/content";
import type { MockPageView, TimedTestReview, TimedTestView } from "@/lib/schemas";
import { bankViewFor, choicePool, mockRoles, pickTestQuestions, reviewOf, roleFor, scorePicks, testViewOf } from "./rules";

/*
 * Example data for /mock with no sign-in, and for /design: the real bank for a role, a running test and its review.
 * Built from the bank with the same rules as the store, so it never drifts from the content. Nothing here is saved.
 */

const byId = new Map(mockQuestions.map((q) => [q.id, q]));
const STARTED = new Date("2026-10-20T05:30:00Z");
const EXAMPLE_ID = "00000000-0000-4000-8000-000000000012";

/** /mock with example data: the bank for the role asked for (Data Analyst by default), Free or Elite. */
export function exampleMockPage(askedRole: string | null, elite: boolean, test: TimedTestView | null = null): MockPageView {
  const roles = mockRoles(mockQuestions, roleProfiles, true);
  const role = roleFor(roleProfiles, askedRole, null);
  return { elite, role: roles.find((r) => r.slug === role.slug)!, roles, bank: bankViewFor(mockQuestions, role, elite), test };
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
