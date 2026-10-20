import { createSampleResume } from "@/lib/resume/sample";
import { clientHash, clientIp, ensureOwner, isSameOrigin } from "@/lib/session";
import { errorFields, logEvent } from "@/lib/log";

const fail = (status: number, error: string) => Response.json({ ok: false, error }, { status });

/**
 * "Try a sample resume" (v44 gap item 3): makes the checked-in sample the person's resume and responds with its id,
 * like an upload after its parse. No body, no file and no model call.
 */
export async function POST(request: Request) {
  if (!isSameOrigin(request)) return fail(403, "Please try the sample from the CareerMetro website.");
  const owner = await ensureOwner();
  let result;
  try {
    result = await createSampleResume({ owner, clientHash: clientHash(clientIp(request)) });
  } catch (error) {
    logEvent("error", "sample_resume_failed", { route: "/api/resume/sample", ...errorFields(error) });
    return fail(500, "Something went wrong opening the sample. Please try again.");
  }
  if (!result.ok) return fail(result.status, result.message);
  return Response.json({ ok: true, resumeId: result.resumeId });
}
