"use server";

import { currentAccount } from "@/lib/auth/server";
import { errorFields, logEvent } from "@/lib/log";
import { ratePracticeAnswer, submitPracticeAnswer } from "@/lib/practice/store";
import type { PracticeAnswerResult, PracticeRateResult } from "@/lib/schemas";

/*
 * The Practice page's actions (handoff 12h). Each checks the account itself; the store validates the input with Zod
 * and keeps every read and write to the person's own rows. Server actions only run for requests from this site (Next
 * checks the Origin header against the host). The answer text is never logged: errors log their name and code only.
 */

const SIGN_IN = "Please sign in to practise.";

export async function submitPracticeAction(questionId: unknown, answer: unknown): Promise<PracticeAnswerResult> {
  const account = await currentAccount();
  if (!account) return { ok: false, message: SIGN_IN };
  try {
    return await submitPracticeAnswer(account.id, { questionId, answer });
  } catch (error) {
    logEvent("error", "practice_submit_failed", errorFields(error));
    return { ok: false, message: "Something went wrong saving that. Your answer is still here; try again." };
  }
}

export async function ratePracticeAction(answerId: unknown, confidence: unknown): Promise<PracticeRateResult> {
  const account = await currentAccount();
  if (!account) return { ok: false, message: SIGN_IN };
  try {
    return await ratePracticeAnswer(account.id, { answerId, confidence });
  } catch (error) {
    logEvent("error", "practice_rate_failed", errorFields(error));
    return { ok: false, message: "That didn't save. Please try again." };
  }
}
