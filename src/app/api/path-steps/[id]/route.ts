import { markStepDone } from "@/lib/path/store";
import { isSameOrigin, readSessionId } from "@/lib/session";

const fail = (status: number, error: string) => Response.json({ ok: false, error }, { status });
const NOT_FOUND = "We couldn't find this step. Your path may have expired.";

/** FR-18: marks one of this session's path steps done ({ "done": true }) or not done ({ "done": false }). */
export async function PUT(request: Request, { params }: RouteContext<"/api/path-steps/[id]">) {
  if (!isSameOrigin(request)) return fail(403, "Please update your path from the CareerMetro website.");
  const body = await request.text().catch(() => "");
  if (body.length > 100) return fail(400, "Send done as true or false.");
  let done: unknown = null;
  try {
    done = (JSON.parse(body) as { done?: unknown }).done;
  } catch {}
  if (typeof done !== "boolean") return fail(400, "Send done as true or false.");

  const sessionId = await readSessionId();
  if (!sessionId) return fail(404, NOT_FOUND);
  const { id } = await params;
  try {
    if (await markStepDone(id, sessionId, done)) return Response.json({ ok: true });
  } catch (error) {
    console.error("mark step done failed:", error instanceof Error ? error.name : typeof error);
    return fail(500, "Something went wrong saving that. Please try again.");
  }
  return fail(404, NOT_FOUND);
}
