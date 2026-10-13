"use server";

import { refresh } from "next/cache";
import { currentAccount } from "@/lib/auth/server";
import { askForTimes, cancelInterview, INTERVIEW_ERROR_TEXT, scheduleInterview, submitFeedback, type InterviewResult } from "@/lib/corporate/interviews-store";
import type { InterviewActions, SchedulerActions } from "@/lib/corporate/types";

/*
 * Interviews' server actions (dev/corporate-plan.md build step 6), for the candidate drawer, Corporate Messages and the
 * scheduler. Each checks who is signed in; the store validates with Zod and re-reads the person's live company role and
 * job team. Answers are words to show. Nothing here logs input, and feedback is the person's own words.
 */

const SIGN_IN = "Please sign in again.";
const words = (r: InterviewResult<object>): string | null => (r.ok ? null : (r.message ?? INTERVIEW_ERROR_TEXT[r.error]));

/** "Ask for times" in the application's chat. */
export const askTimesAction: InterviewActions["askTimes"] = async (applicationId) => {
  const account = await currentAccount();
  if (!account) return SIGN_IN;
  const message = words(await askForTimes(account.id, { applicationId }));
  if (!message) refresh();
  return message;
};

/** Books an interview on one of the candidate's offered times. */
export const scheduleAction: SchedulerActions["schedule"] = async (values) => {
  const account = await currentAccount();
  if (!account) return SIGN_IN;
  const message = words(await scheduleInterview(account.id, { ...values, round: "team" }));
  if (!message) refresh();
  return message;
};

/** Cancels an interview still ahead. */
export const cancelInterviewAction: InterviewActions["cancel"] = async (interviewId) => {
  const account = await currentAccount();
  if (!account) return SIGN_IN;
  const message = words(await cancelInterview(account.id, { interviewId }));
  if (!message) refresh();
  return message;
};

/** An interviewer's feedback, written by them. Writing again replaces it. */
export const feedbackAction: InterviewActions["feedback"] = async (interviewId, recommendation, text) => {
  const account = await currentAccount();
  if (!account) return SIGN_IN;
  const message = words(await submitFeedback(account.id, { interviewId, recommendation, text }));
  if (!message) refresh();
  return message;
};
