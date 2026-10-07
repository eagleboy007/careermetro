import { profile as profileSchema } from "@/lib/schemas";
import { confirmProfile } from "@/lib/resume/store";
import { isSameOrigin, readSessionId } from "@/lib/session";

/** A corrected profile is a few KB; anything far larger is not one. */
const MAX_BODY_BYTES = 64 * 1024;

const fail = (status: number, error: string) => Response.json({ ok: false, error }, { status });

/** Saves the profile the user checked and corrected (FR-6). */
export async function PUT(request: Request, { params }: RouteContext<"/api/resume/[id]/profile">) {
  if (!isSameOrigin(request)) return fail(403, "Please save from the CareerMetro website.");
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) return fail(413, "This profile is too long to save.");
  const body = await request.text().catch(() => "");
  if (body.length > MAX_BODY_BYTES) return fail(413, "This profile is too long to save.");

  let json: unknown = null;
  try {
    json = JSON.parse(body);
  } catch {}
  const parsed = profileSchema.safeParse(json);
  if (!parsed.success) {
    const where = parsed.error.issues.some((i) => ["start", "end", "lastUsed"].includes(String(i.path.at(-1))))
      ? "Check the dates: use YYYY or YYYY-MM, like 2022-06."
      : "Some fields are empty. Fill them in or remove the entry.";
    return fail(400, where);
  }

  const sessionId = await readSessionId();
  if (!sessionId) return fail(404, "We couldn't find this resume. It may have expired.");
  const { id } = await params;
  let result;
  try {
    result = await confirmProfile(id, sessionId, parsed.data);
  } catch (error) {
    // Database errors carry query parameters, which hold the profile. Log only the name and code.
    const code = error instanceof Error ? (error.cause as { code?: string } | undefined)?.code : undefined;
    console.error("profile save failed:", error instanceof Error ? error.name : typeof error, code ?? "");
    return fail(500, "Something went wrong saving your profile. Please try again.");
  }
  if (result.ok) return Response.json({ ok: true, version: result.version });
  if (result.reason === "conflict") return fail(409, "This profile was saved from another tab. Reload the page to see the latest.");
  if (result.reason === "too_many") return fail(429, "This resume has been saved many times. Upload it again to start fresh.");
  return fail(404, "We couldn't find this resume. It may have expired.");
}
