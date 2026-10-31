"use server";

import { currentAccount } from "@/lib/auth/server";
import { errorFields, logEvent } from "@/lib/log";
import type { EventRsvpState } from "@/lib/schemas";
import { setEventPrep, setEventRsvp, TIMETABLE_MESSAGES } from "@/lib/timetable/store";

/*
 * The Timetable's actions (docs/plans/timetable-plan.md section 4): Save, I'm going and the prep task. The account is
 * checked here; the store checks the input with Zod and that the event is live, and writes only the person's own row.
 * The screen already shows the change, so nothing refreshes. Nothing logs the event: the event name and error code only.
 */

const SIGN_IN = "Please sign in again.";

/** Save ("saved"), I'm going ("going") or neither (null). Null when it worked, or the words to show. */
export async function eventRsvpAction(eventId: string, state: EventRsvpState | null): Promise<string | null> {
  const account = await currentAccount();
  if (!account) return SIGN_IN;
  try {
    const result = await setEventRsvp(account.id, { eventId, state });
    return result.ok ? null : TIMETABLE_MESSAGES[result.error];
  } catch (error) {
    logEvent("error", "timetable_rsvp_failed", errorFields(error));
    return TIMETABLE_MESSAGES.invalid;
  }
}

/** "Add it as a prep task?": yes names the goal's skill, null takes the task off. Null when it worked, or the words to show. */
export async function eventPrepAction(eventId: string, goalSkillId: string | null): Promise<string | null> {
  const account = await currentAccount();
  if (!account) return SIGN_IN;
  try {
    const result = await setEventPrep(account.id, { eventId, goalSkillId });
    return result.ok ? null : TIMETABLE_MESSAGES[result.error];
  } catch (error) {
    logEvent("error", "timetable_prep_failed", errorFields(error));
    return TIMETABLE_MESSAGES.invalid;
  }
}
