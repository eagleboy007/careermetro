import { profile as profileSchema } from "@/lib/schemas";
import { confirmProfile } from "@/lib/resume/store";
import { isSameOrigin, readSessionId } from "@/lib/session";

/** Saves the profile the user checked and corrected (FR-6). */
export async function PUT(request: Request, { params }: RouteContext<"/api/resume/[id]/profile">) {
  if (!isSameOrigin(request)) return Response.json({ ok: false, error: "Please save from the CareerMetro website." }, { status: 403 });
  const sessionId = await readSessionId();
  const { id } = await params;
  const parsed = profileSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ ok: false, error: "Some fields are missing. Check each entry and try again." }, { status: 400 });

  const version = sessionId ? await confirmProfile(id, sessionId, parsed.data) : null;
  if (version === null) return Response.json({ ok: false, error: "We couldn't find this resume. It may have expired." }, { status: 404 });
  return Response.json({ ok: true, version });
}
