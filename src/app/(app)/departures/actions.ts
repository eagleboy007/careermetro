"use server";

import { currentAccount } from "@/lib/auth/server";
import { clearStage, DEPARTURE_MESSAGES, saveRole, setStage, type DepartureResult } from "@/lib/departures/store";
import { errorFields, logEvent } from "@/lib/log";

/*
 * Saved and Applied on Departures (docs/plans/departures-live-plan.md). Each checks the account itself; the store checks
 * the input with Zod, scopes every write to that account and counts it against the day's 200 changes. The screen
 * already shows the change, so nothing refreshes here. Nothing logs the post, the save or the stage. Each returns
 * null when it worked, or the words to show.
 */

const SIGN_IN = "Please sign in again.";
const FAILED = "That didn't work. Please try again.";

async function run(name: string, change: (userId: string) => Promise<DepartureResult>): Promise<string | null> {
  const account = await currentAccount();
  if (!account) return SIGN_IN;
  try {
    const result = await change(account.id);
    return result.ok ? null : DEPARTURE_MESSAGES[result.error];
  } catch (error) {
    logEvent("error", name, errorFields(error));
    return FAILED;
  }
}

/** The bookmark: true saves the role, false takes it off Saved. */
export async function saveDepartureAction(postId: string, saved: boolean): Promise<string | null> {
  return run("departure_save_failed", (userId) => saveRole(userId, { postId, saved }));
}

/** The tracker: 1 Applied to 4 Offer. 0 is "I didn't apply", which clears it. */
export async function stageDepartureAction(postId: string, stage: number): Promise<string | null> {
  return run("departure_stage_failed", (userId) => (stage === 0 ? clearStage(userId, { postId }) : setStage(userId, { postId, stage })));
}
