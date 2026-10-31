import { NextResponse } from "next/server";
import { errorFields, logEvent } from "@/lib/log";
import { turnOffWeeklyEmail } from "@/lib/my-jobs/weekly-store";
import { turnOffEventsDigest } from "@/lib/timetable/digest-store";

/**
 * "Turn it off" for the app's own emails, with no sign-in: the weekly My jobs email (C22) and, with `&k=events`, the
 * Monday events digest (Timetable PR 5). The email's link and its List-Unsubscribe header point here with the person's
 * off token (`?t=`); the two emails carry the same token, and `k` says which one to turn off.
 * - GET changes nothing (mail scanners follow links): it sends the browser to the page that asks, /email/off.
 * - POST turns that email off (and replaces the token when no other email still uses it): the page's button, or a mail
 *   app's one-click unsubscribe (RFC 8058). An unknown token gets the same answer, so nothing says whether it existed.
 *   The token is never logged.
 */
const kindOf = (url: URL) => (url.searchParams.get("k") === "events" ? "events" : "weekly");
const kindParam = (kind: "events" | "weekly") => (kind === "events" ? "&k=events" : "");

export function GET(request: Request) {
  const url = new URL(request.url);
  const t = url.searchParams.get("t") ?? "";
  return NextResponse.redirect(new URL(`/email/off?t=${encodeURIComponent(t)}${kindParam(kindOf(url))}`, request.url), 303);
}

export async function POST(request: Request) {
  const url = new URL(request.url);
  const t = url.searchParams.get("t") ?? "";
  const kind = kindOf(url);
  try {
    if (kind === "events") await turnOffEventsDigest(t);
    else await turnOffWeeklyEmail(t);
  } catch (error) {
    logEvent("error", kind === "events" ? "events_digest_off_failed" : "weekly_email_off_failed", errorFields(error));
    return NextResponse.redirect(new URL(`/email/off?t=${encodeURIComponent(t)}${kindParam(kind)}&failed=1`, request.url), 303);
  }
  // A mail app's one-click post reads only the status; a person's browser lands on the confirmation.
  return NextResponse.redirect(new URL(`/email/off?done=1${kindParam(kind)}`, request.url), 303);
}
