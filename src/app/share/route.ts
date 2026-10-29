import { NextResponse } from "next/server";
import { currentAccount } from "@/lib/auth/server";
import { errorFields, logEvent } from "@/lib/log";
import { signedInPreviewEnabled } from "@/lib/preview";
import { holdSharedJob, SHARE_COOKIE, SHARE_HOLD_MS } from "@/lib/my-jobs/share";
import { JOB_TEXT_MAX, MY_JOB_URL_MAX, shareHold } from "@/lib/schemas";
import { clientIp } from "@/lib/session";
import { addressKey, LIMITS, takeShared } from "@/lib/shared-limit";

/** The largest form worth reading: the longest text and title (up to 4 bytes a character, percent-encoded) and a link. */
const MAX_BODY_BYTES = (JOB_TEXT_MAX * 2 + MY_JOB_URL_MAX) * 12 + 4 * 1024;

/**
 * Whether the browser itself sent the share (the share sheet: Sec-Fetch-Site "none") or one of our own pages did.
 * Only then does the box check the job at once; a form another site posted only fills the box and waits for a tap
 * (T141), so no page can spend someone's job checks.
 */
const fromPhoneOrUs = (request: Request) => ["none", "same-origin"].includes(request.headers.get("sec-fetch-site") ?? "");

/** Where the person lands: My jobs with "Add a job you found" filled, or a short word on why it isn't. */
const landing = (request: Request, shared: string) =>
  new URL(`/departures?tab=mine&shared=${shared}${fromPhoneOrUs(request) ? "&check=1" : ""}`, request.url);
const to = (request: Request, shared: string) => NextResponse.redirect(landing(request, shared), 303);

/**
 * The phone's share sheet (C21, manifest share_target; docs/plans/application-tracker-plan.md section 5). Android posts
 * the shared title, text and url here as a form; we hold them for up to an hour and send the person to My jobs, where
 * "Add a job you found" opens filled in. Signed out, Departures sends them through sign-in first and the hold waits.
 * POST only, so the job text never sits in an address, a log or the browser history. It fetches nothing: a company job
 * board's link is read later by the usual add path, and any other link is only kept.
 *
 * Another site could post a form here too. That only fills the person's own add box, which saves nothing until they
 * press Save and checks nothing until they tap (fromPhoneOrUs); the hold opens only in the browser that holds its
 * cookie, and each address may share 20 an hour.
 */
export async function POST(request: Request) {
  // Where the signed-in app is off, there is no My jobs to land in.
  if (!signedInPreviewEnabled()) return new Response(null, { status: 404 });
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) return to(request, "failed");
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return to(request, "failed");
  }
  const field = (name: string) => {
    const v = form.get(name);
    return typeof v === "string" ? v : undefined;
  };
  const job = shareHold.parse({ title: field("title"), text: field("text"), url: field("url") });
  if (!job.text && !job.url) return to(request, "empty");
  if (!(await takeShared(LIMITS.sharesPerIp, addressKey(clientIp(request))))) return to(request, "limit");
  try {
    const account = await currentAccount();
    const id = await holdSharedJob(job, account?.id ?? null);
    // Counts only: never the text or the link.
    logEvent("info", "job_shared", { route: "/share", signedIn: account !== null, withLink: job.url !== "", withText: job.text !== "" });
    const response = to(request, id);
    response.cookies.set(SHARE_COOKIE, id, {
      httpOnly: true,
      sameSite: "lax",
      secure: new URL(request.url).protocol === "https:",
      path: "/",
      maxAge: SHARE_HOLD_MS / 1000,
    });
    return response;
  } catch (error) {
    // Database errors carry query parameters; errorFields keeps only the name and code, never the message.
    logEvent("error", "job_share_failed", { route: "/share", ...errorFields(error) });
    return to(request, "failed");
  }
}

/** A share is always a POST: a GET would put the job text in the address. */
export function GET() {
  return new Response("Share a job to CareerMetro from your phone's share sheet.", { status: 405, headers: { allow: "POST", "content-type": "text/plain; charset=utf-8" } });
}
