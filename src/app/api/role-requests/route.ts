import { countRoleRequest } from "@/lib/jobs/role-requests";
import { errorFields, logEvent } from "@/lib/log";
import { roleRequestBody } from "@/lib/schemas";
import { isSameOrigin, readOwner } from "@/lib/session";

/** A title and its JSON quoting; anything bigger isn't a role title. */
const MAX_BODY_BYTES = 1024;

const fail = (status: number, error: string) => Response.json({ ok: false, error }, { status });

/**
 * A search of the role list that found nothing (role-suggest-plan.md part B): counts the typed title in role_requests,
 * with nothing about the person. Body: { title }. The answer is the same whether it was counted, already counted today
 * or over the person's daily limit, so the limits can't be probed. The title is never logged.
 */
export async function POST(request: Request) {
  if (!isSameOrigin(request)) return fail(403, "Please search roles from the CareerMetro website.");
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) return fail(413, "That is too long for a role title.");
  const body = await request.text().catch(() => "");
  if (body.length > MAX_BODY_BYTES) return fail(413, "That is too long for a role title.");
  let json: unknown = null;
  try {
    json = JSON.parse(body);
  } catch {}
  const parsed = roleRequestBody.safeParse(json);
  if (!parsed.success) return fail(400, "Type a role title.");
  const owner = await readOwner();
  if (!owner) return fail(404, "We couldn't find your session. Upload your resume first.");
  try {
    const outcome = await countRoleRequest(parsed.data.title, owner);
    logEvent("info", "role_request", { route: "/api/role-requests", outcome });
  } catch (error) {
    logEvent("error", "role_request_failed", { route: "/api/role-requests", ...errorFields(error) });
  }
  return Response.json({ ok: true });
}
