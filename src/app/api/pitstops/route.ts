import { addOwnPitstop } from "@/lib/pitstops/store";
import { isSameOrigin, readOwner } from "@/lib/session";
import { errorFields, logEvent } from "@/lib/log";
import { fail, readBody, refuse } from "./reply";

/**
 * "Add a pitstop" on the Map (FR-58): the signed-in person adds a pitstop of their own to one of their open goals,
 * { goalId, title, resourceId? }. It never changes gaps, readiness, the match or the train. The name is never logged:
 * logs hold the outcome code only.
 */
export async function POST(request: Request) {
  if (!isSameOrigin(request)) return fail(403, "Please change your map from the CareerMetro website.");
  const read = await readBody(request);
  if (read.tooLarge) return fail(413, "That request is too large.");
  const owner = await readOwner();
  if (owner?.userId === undefined) return fail(401, "Sign in to add pitstops of your own.");
  let result: Awaited<ReturnType<typeof addOwnPitstop>>;
  try {
    result = await addOwnPitstop(owner.userId, read.body);
  } catch (error) {
    logEvent("error", "own_pitstop_failed", { route: "/api/pitstops", action: "add", ...errorFields(error) });
    return fail(500, "Something went wrong adding this pitstop. Please try again.");
  }
  if (!result.ok) {
    logEvent("info", "own_pitstop_refused", { route: "/api/pitstops", action: "add", code: result.error });
    return refuse(result.error);
  }
  logEvent("info", "own_pitstop_changed", { route: "/api/pitstops", action: "add" });
  return Response.json({ ok: true, id: result.id });
}
