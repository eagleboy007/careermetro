import { z } from "zod";
import { editOwnPitstop, removeOwnPitstop } from "@/lib/pitstops/store";
import { isSameOrigin, readOwner } from "@/lib/session";
import { errorFields, logEvent } from "@/lib/log";
import { fail, readBody, refuse } from "../reply";

const stepId = z.uuid();

/**
 * Edit one of the signed-in person's own pitstops on the Map (FR-58): a new name and the course, { title, resourceId }.
 * Someone else's pitstop, or a step of the path itself, is not found. Logs hold the outcome code only, never the name.
 */
export async function PATCH(request: Request, { params }: RouteContext<"/api/pitstops/[id]">) {
  if (!isSameOrigin(request)) return fail(403, "Please change your map from the CareerMetro website.");
  const read = await readBody(request);
  if (read.tooLarge) return fail(413, "That request is too large.");
  const id = stepId.safeParse((await params).id);
  if (!id.success) return refuse("not_found");
  const owner = await readOwner();
  if (owner?.userId === undefined) return fail(401, "Sign in to change your pitstops.");
  let result: Awaited<ReturnType<typeof editOwnPitstop>>;
  try {
    result = await editOwnPitstop(owner.userId, id.data, read.body);
  } catch (error) {
    logEvent("error", "own_pitstop_failed", { route: "/api/pitstops/[id]", action: "edit", ...errorFields(error) });
    return fail(500, "Something went wrong saving this pitstop. Please try again.");
  }
  if (!result.ok) {
    logEvent("info", "own_pitstop_refused", { route: "/api/pitstops/[id]", action: "edit", code: result.error });
    return refuse(result.error);
  }
  logEvent("info", "own_pitstop_changed", { route: "/api/pitstops/[id]", action: "edit" });
  return Response.json({ ok: true });
}

/** Remove one of the signed-in person's own pitstops. No body. */
export async function DELETE(request: Request, { params }: RouteContext<"/api/pitstops/[id]">) {
  if (!isSameOrigin(request)) return fail(403, "Please change your map from the CareerMetro website.");
  if (Number(request.headers.get("content-length") ?? 0) > 100) return fail(413, "Send no body.");
  const id = stepId.safeParse((await params).id);
  if (!id.success) return refuse("not_found");
  const owner = await readOwner();
  if (owner?.userId === undefined) return fail(401, "Sign in to change your pitstops.");
  let result: Awaited<ReturnType<typeof removeOwnPitstop>>;
  try {
    result = await removeOwnPitstop(owner.userId, id.data);
  } catch (error) {
    logEvent("error", "own_pitstop_failed", { route: "/api/pitstops/[id]", action: "remove", ...errorFields(error) });
    return fail(500, "Something went wrong removing this pitstop. Please try again.");
  }
  if (!result.ok) {
    logEvent("info", "own_pitstop_refused", { route: "/api/pitstops/[id]", action: "remove", code: result.error });
    return refuse(result.error);
  }
  logEvent("info", "own_pitstop_changed", { route: "/api/pitstops/[id]", action: "remove" });
  return Response.json({ ok: true });
}
