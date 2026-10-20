import { resumeName } from "@/lib/account/name";
import { currentAccount } from "@/lib/auth/server";
import { errorFields, logEvent } from "@/lib/log";
import { buildResumeDocument, resumeFileName } from "@/lib/resume/export/document";
import { renderResumeDocx } from "@/lib/resume/export/docx";
import { renderResumePdf, UnprintableTextError } from "@/lib/resume/export/pdf";
import { getResumeForOwner } from "@/lib/resume/store";
import { resumeFormat } from "@/lib/schemas";
import { readOwner } from "@/lib/session";
import { LIMITS, takeShared } from "@/lib/shared-limit";

const CONTENT_TYPES = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
} as const;

// The download links are plain links, so a refusal opens as a page: plain words, not JSON.
const fail = (status: number, error: string) =>
  new Response(error, { status, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });

/**
 * FR-20: downloads the confirmed profile as a one-column resume, PDF or Word. Only the resume's owner gets it, and
 * only once they've confirmed it, so nothing they haven't checked goes into the file.
 */
export async function GET(request: Request, { params }: RouteContext<"/api/resume/[id]/export">) {
  const format = resumeFormat.safeParse(new URL(request.url).searchParams.get("format") ?? "pdf");
  if (!format.success) return fail(400, "Choose PDF or Word.");

  const owner = await readOwner();
  if (!owner) return fail(404, "We couldn't find this resume. It may have expired.");
  const { id } = await params;
  // Each try counts toward the owner's hourly downloads (Testing Run 5, T81): every file is a fresh render.
  const ownerKey = owner.userId ? `user:${owner.userId}` : `session:${owner.sessionId}`;
  if (!(await takeShared(LIMITS.resumeExportsPerOwnerHour, ownerKey))) {
    return fail(429, "You've downloaded your resume many times in the last hour. Please try again in a little while.");
  }
  try {
    const resume = await getResumeForOwner(id, owner);
    if (!resume) return fail(404, "We couldn't find this resume. It may have expired.");
    if (!resume.confirmed) return fail(409, "Confirm your resume first, then download it.");

    const doc = buildResumeDocument(resume.profile, resumeName(owner.userId ? await currentAccount() : null));
    const bytes = format.data === "pdf" ? await renderResumePdf(doc) : await renderResumeDocx(doc);
    logEvent("info", "resume_exported", { format: format.data });
    const file = resumeFileName(doc.name, format.data);
    return new Response(Buffer.from(bytes), {
      headers: {
        "content-type": CONTENT_TYPES[format.data],
        "content-disposition": `attachment; filename="${file}"`,
        // The person's resume: never kept by a browser cache or a shared proxy.
        "cache-control": "no-store, private",
      },
    });
  } catch (error) {
    if (error instanceof UnprintableTextError) {
      return fail(422, "Your resume has letters our PDF can't print yet, such as Hindi or Tamil script. Please download the Word file instead.");
    }
    // Errors can carry query parameters or file content; errorFields keeps only the name and code.
    logEvent("error", "resume_export_failed", { format: format.data, ...errorFields(error) });
    return fail(500, "Something went wrong making your file. Please try again.");
  }
}
