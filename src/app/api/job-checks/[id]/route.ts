import { deleteJobCheck } from "@/lib/jobs/store";
import { isSameOrigin, readOwner } from "@/lib/session";
import { errorFields, logEvent } from "@/lib/log";

const fail = (status: number, error: string) => Response.json({ ok: false, error }, { status });
const NOT_FOUND = "We couldn't find this job check. It may have been removed.";

/**
 * "Remove this check": deletes one of the owner's saved job checks. Goals added from it stay; they only lose the
 * job's tag. No body.
 */
export async function DELETE(request: Request, { params }: RouteContext<"/api/job-checks/[id]">) {
  if (!isSameOrigin(request)) return fail(403, "Please remove checks from the CareerMetro website.");
  if (Number(request.headers.get("content-length") ?? 0) > 100) return fail(413, "Send no body.");
  const owner = await readOwner();
  if (!owner) return fail(404, NOT_FOUND);
  const { id } = await params;
  try {
    if (await deleteJobCheck(id, owner)) {
      logEvent("info", "job_check_removed", { route: "/api/job-checks/[id]" });
      return Response.json({ ok: true });
    }
  } catch (error) {
    logEvent("error", "job_check_remove_failed", { route: "/api/job-checks/[id]", ...errorFields(error) });
    return fail(500, "Something went wrong removing this check. Please try again.");
  }
  return fail(404, NOT_FOUND);
}
