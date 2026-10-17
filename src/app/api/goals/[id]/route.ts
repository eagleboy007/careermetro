import { z } from "zod";
import { changeGoal, removeChoiceGoal } from "@/lib/goals/store";
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

const change = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("skip") }),
  z.strictObject({ action: z.literal("swap"), skillId: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/).max(80) }),
  z.strictObject({ action: z.literal("restore") }),
]);
const CHANGE_REFUSED = "This goal can't be changed that way. Refresh the page and try again.";

/**
 * "Not for me" on one of the signed-in person's goals from gaps (FR-48): `skip` a required goal, `swap` a "one of
 * these" goal to another skill of its group, or `restore` a skipped goal. The match and gaps never change. Logs only
 * the action and the outcome.
 */
export async function PATCH(request: Request, { params }: RouteContext<"/api/goals/[id]">) {
  if (!isSameOrigin(request)) return fail(403, "Please change your goals from the CareerMetro website.");
  if (Number(request.headers.get("content-length") ?? 0) > 200) return fail(413, "That request is too large.");
  const id = goalId.safeParse((await params).id);
  if (!id.success) return fail(404, NOT_FOUND);
  const owner = await readOwner();
  if (owner?.userId === undefined) return fail(401, "Sign in to change your goals.");
  let body: unknown;
  try {
    const text = await request.text();
    if (text.length > 200) return fail(413, "That request is too large.");
    body = JSON.parse(text);
  } catch {
    return fail(400, CHANGE_REFUSED);
  }
  const parsed = change.safeParse(body);
  if (!parsed.success) return fail(400, CHANGE_REFUSED);
  try {
    if (await changeGoal(owner.userId, id.data, parsed.data)) {
      logEvent("info", "goal_changed", { route: "/api/goals/[id]", action: parsed.data.action });
      return Response.json({ ok: true });
    }
  } catch (error) {
    logEvent("error", "goal_change_failed", { route: "/api/goals/[id]", action: parsed.data.action, ...errorFields(error) });
    return fail(500, "Something went wrong changing this goal. Please try again.");
  }
  return fail(409, CHANGE_REFUSED);
}
