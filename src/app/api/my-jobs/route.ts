import { currentAccount } from "@/lib/auth/server";
import { JOB_CHECK_LIMITS } from "@/lib/jobs/store";
import { addJob, MY_JOB_MESSAGES, type AddJobResult } from "@/lib/my-jobs/store";
import { addJobRequest, JOB_TEXT_MAX, MY_JOB_URL_MAX } from "@/lib/schemas";
import { isSameOrigin } from "@/lib/session";
import { errorFields, logEvent } from "@/lib/log";

// Reading a posting takes one model call of roughly 5 to 30 seconds (parseJobPosting gives up after 100), plus at most
// 15 seconds reading a company job board's posting first.
export const maxDuration = 120;

/** The largest body worth reading: the longest description (up to 4 bytes a character), a link and JSON quoting. */
const MAX_BODY_BYTES = JOB_TEXT_MAX * 4 + MY_JOB_URL_MAX + 4 * 1024;

const fail = (status: number, error: string) => Response.json({ ok: false, error }, { status });
const TOO_LONG = `This description is too long. Paste up to ${JOB_TEXT_MAX.toLocaleString("en-IN")} characters.`;
const NO_RESUME = "Confirm your resume first. Then add the jobs you're applying to.";

const FAILURES: Record<Exclude<AddJobResult, { ok: true }>["reason"], [number, string]> = {
  invalid: [400, "Paste the job description, or a link from a company job board."],
  no_analysis: [409, NO_RESUME],
  not_found: [409, NO_RESUME],
  not_confirmed: [409, NO_RESUME],
  board_not_found: [404, "That posting isn't on the company's job board any more. Paste the description instead."],
  board_unreadable: [502, "We couldn't read that posting from the company's job board just now. Paste the description instead."],
  full: [409, MY_JOB_MESSAGES.full],
  limit: [429, `You've checked ${JOB_CHECK_LIMITS.perOwnerPerDay} jobs today, the most for one day. Nothing was saved. Please try again tomorrow.`],
  sample_limit: [429, "You've checked a lot of jobs today. Nothing was saved. Please try again tomorrow."],
  budget: [503, "We've reached today's capacity for job checks. Nothing was saved. Please try again tomorrow."],
  busy: [503, "Another check is still running. Please try again in a minute."],
  unavailable: [503, "We couldn't read the description just now. Nothing was saved. Please try again in a few minutes."],
  refused: [422, "We couldn't read this description. Check that you pasted a job description, then try again."],
  malformed: [503, "We couldn't read the description just now. Nothing was saved. Please try again."],
  no_skills: [422, "We couldn't find any skills in this description. Paste the part that lists what the job asks for."],
};

/**
 * "Add a job you found" (docs/plans/application-tracker-plan.md): checks a pasted description, or the posting a company
 * job board's link points to, against the person's current resume and target role, and answers with the job as read
 * for "Check these, then save". Body: { resumeId, text, url }. Signed in only. The description and link are the
 * person's own and never logged: logs carry the source and the outcome only.
 */
export async function POST(request: Request) {
  if (!isSameOrigin(request)) return fail(403, "Please add a job from the CareerMetro website.");
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) return fail(413, TOO_LONG);
  const body = await request.text().catch(() => "");
  if (body.length > MAX_BODY_BYTES) return fail(413, TOO_LONG);
  let json: unknown = null;
  try {
    json = JSON.parse(body);
  } catch {}
  const parsed = addJobRequest.safeParse(json);
  if (!parsed.success) {
    // The schema's own plain words for the text and link; anything else gets one general line. Never the input.
    const issue = parsed.error.issues[0];
    const own = issue && ["text", "url"].includes(String(issue.path[0])) && issue.code !== "invalid_type";
    return fail(400, own ? issue.message : FAILURES.invalid[1]);
  }
  const account = await currentAccount();
  if (!account) return fail(401, "Please sign in again.");
  const source = parsed.data.text ? "pasted" : "board";
  try {
    const result = await addJob(account.id, parsed.data);
    if (result.ok) {
      logEvent("info", "my_job_added", { route: "/api/my-jobs", source, kind: result.kind });
      return Response.json(result.kind === "post" ? { ok: true, kind: "post", postId: result.postId } : { ok: true, kind: "check", job: result.job });
    }
    logEvent("warn", "my_job_refused", { route: "/api/my-jobs", source, reason: result.reason });
    const [status, message] = FAILURES[result.reason];
    return fail(status, message);
  } catch (error) {
    // Database errors carry query parameters; errorFields keeps only the name and code, never the message.
    logEvent("error", "my_job_failed", { route: "/api/my-jobs", ...errorFields(error) });
    return fail(500, "Something went wrong adding this job. Please try again.");
  }
}
