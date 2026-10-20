"use server";

import { refresh } from "next/cache";
import { currentAccount } from "@/lib/auth/server";
import { eliteMessage, setElite, setEliteBadge } from "@/lib/elite/store";
import { errorFields, logEvent } from "@/lib/log";

/*
 * Elite's switches (FR-50): /elite, Settings > Your plan and the plan card on the person's own profile. Each checks
 * the account itself; the store checks the input and the daily limit, and writes only the person's own row. No billing:
 * nothing here takes a card or a payment. Each returns null when it worked, or the words to show.
 */

const SIGN_IN = "Please sign in again.";
const FAILED = "That didn't work. Please try again.";

async function run(name: string, change: (userId: string) => ReturnType<typeof setElite>): Promise<string | null> {
  const account = await currentAccount();
  if (!account) return SIGN_IN;
  try {
    const result = await change(account.id);
    if (!result.ok) return eliteMessage(result.error);
  } catch (error) {
    logEvent("error", name, errorFields(error));
    return FAILED;
  }
  // The avatar menu, the profile and Practice read the plan too.
  refresh();
  return null;
}

/** "Turn on Elite, free in the beta" (true) or "Turn off" (false). */
export async function switchElite(on: unknown): Promise<string | null> {
  return run("elite_switch_failed", (userId) => setElite(userId, on));
}

/** "Show the Elite badge on my profile". A Free person gets "Turn on Elite to use this." */
export async function switchEliteBadge(shown: unknown): Promise<string | null> {
  return run("elite_badge_failed", (userId) => setEliteBadge(userId, shown));
}
