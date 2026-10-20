"use server";

import { refresh } from "next/cache";
import { currentAccount } from "@/lib/auth/server";
import { JOB_SEARCH_MESSAGES, setJobSearch, setNotice, type JobSearchResult } from "@/lib/job-search/store";
import { errorFields, logEvent } from "@/lib/log";

/*
 * "Looking for a job" and the notice period card (handoff 6, docs/plans/job-search-plan.md), from Departures, Arrivals,
 * Me and Settings. Each checks the account itself; the store checks the input, the date and the daily limit, and writes
 * only the person's own row. Nothing here logs the switch, the days or the date. Each returns null when it worked, or
 * the words to show.
 */

const SIGN_IN = "Please sign in again.";
const FAILED = "That didn't work. Please try again.";

async function run(name: string, change: (userId: string) => Promise<JobSearchResult>): Promise<string | null> {
  const account = await currentAccount();
  if (!account) return SIGN_IN;
  try {
    const result = await change(account.id);
    if (!result.ok) return JOB_SEARCH_MESSAGES[result.error];
  } catch (error) {
    logEvent("error", name, errorFields(error));
    return FAILED;
  }
  // Departures, Arrivals, Today, Me and the top bar read the switch too.
  refresh();
  return null;
}

/** "Looking for a job" on (true) or off (false). */
export async function switchJobSearch(on: unknown): Promise<string | null> {
  return run("job_search_switch_failed", (userId) => setJobSearch(userId, on));
}

/** The notice period card: `{ days, resignedOn }`, either null to clear it. */
export async function saveNotice(input: unknown): Promise<string | null> {
  return run("notice_save_failed", (userId) => setNotice(userId, input));
}
