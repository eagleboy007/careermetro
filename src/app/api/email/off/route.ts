import { NextResponse } from "next/server";
import { errorFields, logEvent } from "@/lib/log";
import { turnOffWeeklyEmail } from "@/lib/my-jobs/weekly-store";

/**
 * "Turn it off" for the weekly My jobs email (C22), with no sign-in. The email's link and its List-Unsubscribe header
 * point here with the person's off token (`?t=`).
 * - GET changes nothing (mail scanners follow links): it sends the browser to the page that asks, /email/off.
 * - POST turns the email off and replaces the token: the page's button, or a mail app's one-click unsubscribe
 *   (RFC 8058). An unknown token gets the same answer, so nothing says whether it existed. The token is never logged.
 */
export function GET(request: Request) {
  const t = new URL(request.url).searchParams.get("t") ?? "";
  return NextResponse.redirect(new URL(`/email/off?t=${encodeURIComponent(t)}`, request.url), 303);
}

export async function POST(request: Request) {
  const t = new URL(request.url).searchParams.get("t") ?? "";
  try {
    await turnOffWeeklyEmail(t);
  } catch (error) {
    logEvent("error", "weekly_email_off_failed", errorFields(error));
    return NextResponse.redirect(new URL(`/email/off?t=${encodeURIComponent(t)}&failed=1`, request.url), 303);
  }
  // A mail app's one-click post reads only the status; a person's browser lands on the confirmation.
  return NextResponse.redirect(new URL("/email/off?done=1", request.url), 303);
}
