import { roleProfiles } from "@/content";
import { createJobCheck, JOB_CHECK_LIMITS, type CreateJobCheckResult } from "@/lib/jobs/store";
import { jobCheckRequest, JOB_TEXT_MAX } from "@/lib/schemas";
import { isSameOrigin, readOwner } from "@/lib/session";
import { errorFields, logEvent } from "@/lib/log";

// Reading a posting takes one model call of roughly 5 to 30 seconds; parseJobPosting gives up after 100 seconds.
export const maxDuration = 120;

/** The largest body worth reading: the longest posting (up to 4 bytes a character), its labels and JSON quoting. */
const MAX_BODY_BYTES = JOB_TEXT_MAX * 4 + 4 * 1024;

const fail = (status: number, error: string) => Response.json({ ok: false, error }, { status });
const TOO_LONG = `This posting is too long. Paste up to ${JOB_TEXT_MAX.toLocaleString("en-IN")} characters.`;
const NOT_FOUND = "We couldn't find this resume. It may have expired.";

const FAILURES: Record<Exclude<CreateJobCheckResult, { ok: true }>["reason"], [number, string]> = {
  not_found: [404, NOT_FOUND],
  not_confirmed: [409, "First check your resume and press Looks right."],
  limit: [429, `You've checked ${JOB_CHECK_LIMITS.perOwnerPerDay} jobs today, the most for one day. Nothing was saved. Please try again tomorrow.`],
  budget: [503, "We've reached today's capacity for job checks. Nothing was saved. Please try again tomorrow."],
  busy: [503, "Another check is still running. Please try again in a minute."],
  unavailable: [503, "We couldn't read the posting just now. Nothing was saved. Please try again in a few minutes."],
  refused: [422, "We couldn't read this posting. Check that you pasted a job posting, then try again."],
  malformed: [503, "We couldn't read the posting just now. Nothing was saved. Please try again."],
  no_skills: [422, "We couldn't find any skills in this posting. Paste the part that lists what the job asks for."],
};

/**
 * "Check against a job" (role-suggest-plan.md part B): reads the skills a pasted posting asks for and saves them for
 * this resume and target role. Body: { resumeId, roleSlug, company, title, text }. The posting text is never stored,
 * logged or sent back.
 */
export async function POST(request: Request) {
  if (!isSameOrigin(request)) return fail(403, "Please check a job from the CareerMetro website.");
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) return fail(413, TOO_LONG);
  const body = await request.text().catch(() => "");
  if (body.length > MAX_BODY_BYTES) return fail(413, TOO_LONG);
  let json: unknown = null;
  try {
    json = JSON.parse(body);
  } catch {}
  const parsed = jobCheckRequest.safeParse(json);
  if (!parsed.success) {
    // The schema's own plain words for the company, title and text; anything else gets one general line. Never the input.
    const issue = parsed.error.issues[0];
    const own = issue && ["company", "title", "text"].includes(String(issue.path[0])) && issue.code !== "invalid_type";
    return fail(400, own ? issue.message : "Add the company, the job title and the posting text.");
  }
  if (!roleProfiles.some((r) => r.slug === parsed.data.roleSlug)) return fail(404, "We couldn't find this role.");

  const owner = await readOwner();
  if (!owner) return fail(404, NOT_FOUND);
  try {
    const result = await createJobCheck(parsed.data, owner);
    if (result.ok) {
      logEvent("info", "job_check_saved", { route: "/api/job-checks", role: parsed.data.roleSlug, reused: result.reused });
      return Response.json({ ok: true, id: result.id, reused: result.reused });
    }
    logEvent("warn", "job_check_refused", { route: "/api/job-checks", role: parsed.data.roleSlug, reason: result.reason });
    const [status, message] = FAILURES[result.reason];
    return fail(status, message);
  } catch (error) {
    // Database errors carry query parameters; errorFields keeps only the name and code, never the message.
    logEvent("error", "job_check_failed", { route: "/api/job-checks", ...errorFields(error) });
    return fail(500, "Something went wrong checking this job. Please try again.");
  }
}
