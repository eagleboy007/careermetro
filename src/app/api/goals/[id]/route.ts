import { z } from "zod";
import { removeChoiceGoal } from "@/lib/goals/store";
import { isSameOrigin, readOwner } from "@/lib/session";
import { errorFields, logEvent } from "@/lib/log";

const fail = (status: number, error: string) => Response.json({ ok: false, error }, { status });
const NOT_FOUND = "We couldn't find this goal. It may have been removed already.";
const goalId = z.uuid();

/**
 * "Remove from my goals": the signed-in person drops one of their own "Your choice" goals. Goals from gaps can't be
 * removed here. No body.
 */
export async function DELETE(request: Request, { params }: RouteContext<"/api/goals/[id]">) {
  if (!isSameOrigin(request)) return fail(403, "Please change your goals from the CareerMetro website.");
  if (Number(request.headers.get("content-length") ?? 0) > 100) return fail(413, "Send no body.");
  const id = goalId.safeParse((await params).id);
  if (!id.success) return fail(404, NOT_FOUND);
  const owner = await readOwner();
  if (owner?.userId === undefined) return fail(401, "Sign in to change your goals.");
  try {
    if (await removeChoiceGoal(owner.userId, id.data)) {
      logEvent("info", "choice_goal_removed", { route: "/api/goals/[id]" });
      return Response.json({ ok: true });
    }
  } catch (error) {
    logEvent("error", "choice_goal_remove_failed", { route: "/api/goals/[id]", ...errorFields(error) });
    return fail(500, "Something went wrong removing this goal. Please try again.");
  }
  return fail(404, NOT_FOUND);
}
