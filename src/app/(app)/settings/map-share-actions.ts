"use server";

import { refresh } from "next/cache";
import { currentAccount } from "@/lib/auth/server";
import { errorFields, logEvent } from "@/lib/log";
import { MAP_SHARE_MESSAGES, setShowOnMap } from "@/lib/map/riders";

/*
 * "Show my pitstop on the map" (On your line, C13, docs/plans/on-your-line-plan.md), from Settings > Privacy and Me.
 * Signed in only; the store checks the input (Zod) and the day's 20 changes, and writes only the person's own row. Logs
 * carry the event name only: never the person, their goals or anyone else's. Returns null when it worked, or the words
 * to show.
 */

const SIGN_IN = "Please sign in again.";
const FAILED = "That didn't work. Please try again.";

export async function switchShowOnMap(on: unknown): Promise<string | null> {
  const account = await currentAccount();
  if (!account) return SIGN_IN;
  try {
    const result = await setShowOnMap(account.id, on);
    if (!result.ok) {
      if (result.error === "limit") logEvent("warn", "map_share_limit");
      return MAP_SHARE_MESSAGES[result.error];
    }
    logEvent("info", result.on ? "map_share_on" : "map_share_off");
  } catch (error) {
    logEvent("error", "map_share_failed", errorFields(error));
    return FAILED;
  }
  // Settings, Me, the Map and Today read the switch.
  refresh();
  return null;
}
