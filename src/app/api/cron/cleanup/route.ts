import { deleteExpiredAnonymousResumes } from "@/lib/resume/ingest";
import { hasBearer } from "@/lib/secret";

/** Daily job (vercel.json): deletes anonymous resumes and their profiles after 24 hours (FR-2). */
export async function GET(request: Request) {
  // Vercel Cron sends this header when CRON_SECRET is set in the project.
  if (!hasBearer(request, process.env.CRON_SECRET)) {
    return Response.json({ ok: false }, { status: 401 });
  }
  const deleted = await deleteExpiredAnonymousResumes();
  return Response.json({ ok: true, deleted });
}
