import { addJobCheckGoal, type AddJobCheckGoalResult } from "@/lib/jobs/store";
import { jobCheckGoalRequest, MAX_CHOICE_GOALS } from "@/lib/schemas";
import { isSameOrigin, readOwner } from "@/lib/session";
import { errorFields, logEvent } from "@/lib/log";

/** The largest body worth reading: one skill id and its JSON quoting. */
const MAX_BODY_BYTES = 200;

const fail = (status: number, error: string) => Response.json({ ok: false, error }, { status });
const NOT_FOUND = "We couldn't find this job check. It may have been removed.";

const FAILURES: Record<Exclude<AddJobCheckGoalResult, { ok: true }>["reason"], [number, string]> = {
  not_found: [404, NOT_FOUND],
  not_this_job: [409, "Only skills this job adds can be added from here."],
  already: [409, "Already on your goals"],
  limit: [409, `You have ${MAX_CHOICE_GOALS} goals of your own. Remove one first.`],
};

/**
 * "Add as my goal" (role-suggest-plan.md part B): makes one skill of a saved job check's "Only for this job" group a
 * "Your choice" goal of the signed-in account. Body: { skillId }. It never changes the match, gaps or analysis.
 */
export async function POST(request: Request, { params }: RouteContext<"/api/job-checks/[id]/goals">) {
  if (!isSameOrigin(request)) return fail(403, "Please add goals from the CareerMetro website.");
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) return fail(413, "Send one skill.");
  const body = await request.text().catch(() => "");
  if (body.length > MAX_BODY_BYTES) return fail(413, "Send one skill.");
  let json: unknown = null;
  try {
    json = JSON.parse(body);
  } catch {}
  const parsed = jobCheckGoalRequest.safeParse(json);
  if (!parsed.success) return fail(400, "Send one skill.");

  // Goals belong to an account; an anonymous visitor, with a session or without one, signs in first.
  const owner = await readOwner();
  if (owner?.userId === undefined) return fail(401, "Sign in to keep goals.");
  const { id } = await params;
  try {
    const result = await addJobCheckGoal(id, parsed.data.skillId, owner.userId);
    if (result.ok) {
      logEvent("info", "job_check_goal_added", { route: "/api/job-checks/[id]/goals" });
      return Response.json({ ok: true, goalId: result.goalId });
    }
    logEvent("warn", "job_check_goal_refused", { route: "/api/job-checks/[id]/goals", reason: result.reason });
    const [status, message] = FAILURES[result.reason];
    return Response.json({ ok: false, error: message, reason: result.reason }, { status });
  } catch (error) {
    logEvent("error", "job_check_goal_failed", { route: "/api/job-checks/[id]/goals", ...errorFields(error) });
    return fail(500, "Something went wrong adding this goal. Please try again.");
  }
}
