import { ingestResume } from "@/lib/resume/ingest";
import { MAX_RESUME_BYTES } from "@/lib/resume/extract";
import { clientHash, clientIp, ensureOwner, isSameOrigin } from "@/lib/session";
import { errorFields, logEvent } from "@/lib/log";

// Reading a resume takes one model call of roughly 10 to 40 seconds; parseResume gives up after 100 seconds.
export const maxDuration = 120;

/** `code` lets the form offer the right next step, such as the builder once today's reading budget is spent ("busy"). */
const fail = (status: number, error: string, code?: string) => Response.json({ ok: false, error, ...(code ? { code } : {}) }, { status });

/** Upload a resume as a file or pasted text (FR-4). Responds with the id of the parsed, unconfirmed resume. */
export async function POST(request: Request) {
  const startedAt = Date.now();
  if (!isSameOrigin(request)) return fail(403, "Please upload from the CareerMetro website.");

  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > MAX_RESUME_BYTES + 64 * 1024) return fail(413, "This file is larger than 4 MB. Please upload a smaller file.");

  const form = await request.formData().catch(() => null);
  if (!form) return fail(400, "Please choose a file or paste your resume.");
  if (form.get("consent") !== "yes") return fail(400, "Please agree to how we use your resume before uploading.");

  const file = form.get("file");
  const text = form.get("text");
  let bytes: Uint8Array;
  let as: "text" | undefined;
  if (file instanceof File && file.size > 0) {
    if (file.size > MAX_RESUME_BYTES) return fail(413, "This file is larger than 4 MB. Please upload a smaller file.");
    bytes = new Uint8Array(await file.arrayBuffer());
  } else if (typeof text === "string" && text.trim()) {
    bytes = new TextEncoder().encode(text);
    as = "text";
  } else {
    return fail(400, "Please choose a file or paste your resume.");
  }

  const owner = await ensureOwner();
  let result;
  try {
    result = await ingestResume({ bytes, as, owner, clientHash: clientHash(clientIp(request)), startedAt });
  } catch (error) {
    // Database errors carry query parameters, which can hold profile text quoted from the resume.
    // errorFields keeps only the error's name and code, never its message.
    logEvent("error", "resume_upload_failed", { route: "/api/resume", ms: Date.now() - startedAt, ...errorFields(error) });
    return fail(500, "Something went wrong reading your resume. Please try again.");
  }
  if (!result.ok) return fail(result.status, result.message, result.code);
  return Response.json({ ok: true, resumeId: result.resumeId });
}
