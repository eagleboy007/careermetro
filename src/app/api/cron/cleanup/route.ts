import { deleteExpiredAnonymousResumes } from "@/lib/resume/ingest";

/** Daily job (vercel.json): deletes anonymous resumes and their profiles after 24 hours (FR-2). */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  // Vercel Cron sends this header when CRON_SECRET is set in the project.
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ ok: false }, { status: 401 });
  }
  const deleted = await deleteExpiredAnonymousResumes();
  return Response.json({ ok: true, deleted });
}
