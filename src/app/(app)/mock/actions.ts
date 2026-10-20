"use server";

import { currentAccount } from "@/lib/auth/server";
import { errorFields, logEvent } from "@/lib/log";
import { TIMED_TEST_MESSAGES } from "@/lib/mock/rules";
import { finishTimedTest, pickTimedTest, startTimedTest } from "@/lib/mock/store";
import type { TimedTestFinishResult, TimedTestPickResult, TimedTestStartResult } from "@/lib/schemas";

/*
 * The timed test's actions (FR-50 part 2, handoff 12l). Each checks the account itself; the store checks the input,
 * Elite, the daily limit, the 15 minutes and that the test is the person's own. No model. Nothing typed is logged:
 * errors log their name and code only.
 */

const SIGN_IN = "Please sign in again.";
const FAILED = "That didn't work. Please try again.";

/** "Start the test" for a role. */
export async function startTimedTestAction(roleSlug: unknown): Promise<TimedTestStartResult> {
  const account = await currentAccount();
  if (!account) return { ok: false, message: SIGN_IN };
  try {
    const out = await startTimedTest(account.id, { roleSlug });
    return out.ok ? out : { ok: false, message: TIMED_TEST_MESSAGES[out.error] };
  } catch (error) {
    logEvent("error", "timed_test_start_failed", errorFields(error));
    return { ok: false, message: FAILED };
  }
}

/** One pick, saved as it is made. `over` tells the screen the time is up, so it shows the review. */
export async function pickTimedTestAction(testId: unknown, questionId: unknown, pick: unknown): Promise<TimedTestPickResult> {
  const account = await currentAccount();
  if (!account) return { ok: false, message: SIGN_IN, over: false };
  try {
    const out = await pickTimedTest(account.id, { testId, questionId, pick });
    return out.ok ? out : { ok: false, message: TIMED_TEST_MESSAGES[out.error], over: out.error === "over" };
  } catch (error) {
    logEvent("error", "timed_test_pick_failed", errorFields(error));
    return { ok: false, message: FAILED, over: false };
  }
}

/** "Finish test", or the timer running out: the review of every question. */
export async function finishTimedTestAction(testId: unknown): Promise<TimedTestFinishResult> {
  const account = await currentAccount();
  if (!account) return { ok: false, message: SIGN_IN };
  try {
    const out = await finishTimedTest(account.id, { testId });
    return out.ok ? out : { ok: false, message: TIMED_TEST_MESSAGES[out.error] };
  } catch (error) {
    logEvent("error", "timed_test_finish_failed", errorFields(error));
    return { ok: false, message: FAILED };
  }
}
