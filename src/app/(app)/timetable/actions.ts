"use server";

import { currentAccount } from "@/lib/auth/server";
import { errorFields, logEvent } from "@/lib/log";
import type { EventRsvpState, EventSuggestionInput } from "@/lib/schemas";
import { setEventsDigest } from "@/lib/timetable/digest-store";
import { setEventPrep, setEventRsvp, TIMETABLE_MESSAGES } from "@/lib/timetable/store";
import { EVENT_SUGGESTION_MESSAGES, suggestEvent } from "@/lib/timetable/suggest-store";

/*
 * The Timetable's actions (docs/plans/timetable-plan.md sections 4 to 6): Save, I'm going, the prep task, the
 * Monday digest switch and Suggest an event. The account is checked here; the store checks the input with Zod (and that an event is live),
 * and writes only the person's own row.
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

/**
 * "Send me this week's events" on or off (Timetable PR 5), from /timetable or Settings > Notifications. Changes only the
 * person's own switch and sends nothing. Null when it worked, or the words to show.
 */
export async function eventsDigestAction(on: boolean): Promise<string | null> {
  const account = await currentAccount();
  if (!account) return SIGN_IN;
  try {
    const result = await setEventsDigest(account.id, { on });
    return result.ok ? null : TIMETABLE_MESSAGES.invalid;
  } catch (error) {
    logEvent("error", "events_digest_switch_failed", errorFields(error));
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

/**
 * "Suggest an event" (Timetable PR 6): the form as typed. The store checks it with Zod, counts the try and keeps it as
 * pending, for no one else to see until a grievance officer is named. Null when it worked, or the words to show. The
 * log names the failure only: never the link or anything typed.
 */
export async function suggestEventAction(form: EventSuggestionInput): Promise<string | null> {
  const account = await currentAccount();
  if (!account) return SIGN_IN;
  try {
    const result = await suggestEvent(account.id, form);
    return result.ok ? null : EVENT_SUGGESTION_MESSAGES[result.error];
  } catch (error) {
    logEvent("error", "event_suggest_failed", errorFields(error));
    return TIMETABLE_MESSAGES.invalid;
  }
}
