import { confirmKeyword, type ConfirmKeywordResult } from "@/lib/resume/screening-store";
import { confirmKeywordRequest } from "@/lib/schemas";
import { isSameOrigin, readOwner } from "@/lib/session";
import { errorFields, logEvent } from "@/lib/log";

/** The largest body worth reading: one skill id, its target and the profile version, with JSON quoting. */
const MAX_BODY_BYTES = 400;

const fail = (status: number, error: string) => Response.json({ ok: false, error }, { status });
const NOT_FOUND = "We couldn't find this resume. It may have expired.";

const FAILURES: Record<Extract<ConfirmKeywordResult, { ok: false }>["reason"], [number, string]> = {
  not_found: [404, NOT_FOUND],
  not_confirmed: [409, "Check your resume and press Looks right first."],
  unknown_skill: [400, "Send one skill."],
  not_asked: [409, "Only skills this role or job asks for can be added from here."],
  already: [409, "Your resume already names this skill."],
  conflict: [409, "Your profile changed since this page loaded. Reload the page and try again."],
  too_many: [429, "This resume has been saved many times. Upload it again to start fresh."],
};

/**
 * "I have this" (FR-34 screening check): adds one skill the person confirms they have to their confirmed profile,
 * listed only. Body: { skillId, target: { roleSlug } | { checkId }, version }. The skill stays a gap and a goal until proved. Never logs the resume or the skill.
 */
export async function POST(request: Request, { params }: RouteContext<"/api/resume/[id]/keywords">) {
  if (!isSameOrigin(request)) return fail(403, "Please confirm skills from the CareerMetro website.");
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) return fail(413, "Send one skill.");
  const body = await request.text().catch(() => "");
  if (body.length > MAX_BODY_BYTES) return fail(413, "Send one skill.");
  let json: unknown = null;
  try {
    json = JSON.parse(body);
  } catch {}
  const parsed = confirmKeywordRequest.safeParse(json);
  if (!parsed.success) return fail(400, "Send one skill.");

  const owner = await readOwner();
  if (!owner) return fail(404, NOT_FOUND);
  const { id } = await params;
  try {
    const result = await confirmKeyword(id, owner, parsed.data);
    if (result.ok) {
      logEvent("info", "screening_keyword_confirmed", { route: "/api/resume/[id]/keywords" });
      return Response.json({ ok: true, version: result.version });
    }
    logEvent("warn", "screening_keyword_refused", { route: "/api/resume/[id]/keywords", reason: result.reason });
    const [status, message] = FAILURES[result.reason];
    return Response.json({ ok: false, error: message, reason: result.reason }, { status });
  } catch (error) {
    // Database errors carry query parameters, which hold the profile; errorFields keeps only the name and code.
    logEvent("error", "screening_keyword_failed", { route: "/api/resume/[id]/keywords", ...errorFields(error) });
    return fail(500, "Something went wrong saving this skill. Please try again.");
  }
}
