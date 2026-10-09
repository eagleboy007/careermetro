import { rateAnalysis } from "@/lib/gaps/store";
import { isSameOrigin, readOwner } from "@/lib/session";

const fail = (status: number, error: string) => Response.json({ ok: false, error }, { status });

/** Saves the answer to "Are these gaps right?" (1 to 5), the beta's accuracy measure. */
export async function PUT(request: Request, { params }: RouteContext<"/api/gaps/[id]/rating">) {
  if (!isSameOrigin(request)) return fail(403, "Please rate from the CareerMetro website.");
  if (Number(request.headers.get("content-length") ?? 0) > 200) return fail(400, "Pick a number from 1 to 5.");
  const body = await request.text().catch(() => "");
  if (body.length > 200) return fail(400, "Pick a number from 1 to 5.");
  let rating: unknown = null;
  try {
    rating = (JSON.parse(body) as { rating?: unknown }).rating;
  } catch {}
  if (typeof rating !== "number" || !Number.isInteger(rating) || rating < 1 || rating > 5) return fail(400, "Pick a number from 1 to 5.");

  const owner = await readOwner();
  if (!owner) return fail(404, "We couldn't find these gaps. They may have expired.");
  const { id } = await params;
  try {
    if (await rateAnalysis(id, owner, rating)) return Response.json({ ok: true });
  } catch (error) {
    console.error("gap rating failed:", error instanceof Error ? error.name : typeof error);
    return fail(500, "Something went wrong saving your answer. Please try again.");
  }
  return fail(404, "We couldn't find these gaps. They may have expired.");
}
