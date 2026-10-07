import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { ProfileEditor } from "@/components/resume/profile-editor";
import { ResumeNotFound } from "@/components/resume/resume-not-found";
import { ProgressRoute } from "@/components/route/progress-route";
import { SiteHeader } from "@/components/site/site-header";
import { getResumeForSession } from "@/lib/resume/store";
import { readSessionId } from "@/lib/session";

export const metadata: Metadata = { title: "Check your resume · CareerMetro", robots: { index: false } };

async function Review({ params }: { params: Promise<{ id: string }> }) {
  // Per-request data: the resume lookup reads the clock and the session cookie.
  await connection();
  const { id } = await params;
  const sessionId = await readSessionId();
  const resume = sessionId ? await getResumeForSession(id, sessionId) : null;

  if (!resume) return <ResumeNotFound />;
  return (
    <div className="flex flex-col gap-6">
      {resume.confirmed && (
        <p className="rounded-lg border border-line bg-surface p-4 text-sm">
          You&apos;ve already confirmed this resume.{" "}
          <Link href={`/resume/${resume.resumeId}/role`} className="font-medium underline underline-offset-2">
            Pick a role
          </Link>{" "}
          or change anything below and confirm again.
        </p>
      )}
      <ProfileEditor resumeId={resume.resumeId} initial={resume.profile} />
    </div>
  );
}

export default function ResumePage({ params }: PageProps<"/resume/[id]">) {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 pb-20">
      <SiteHeader />
      <ProgressRoute current="Resume" />
      <section className="flex flex-col gap-3">
        <h1 className="text-4xl font-semibold leading-[1.05]">Check what we found</h1>
        <p className="text-muted">Fix anything we got wrong and remove anything that isn&apos;t yours. Then confirm.</p>
      </section>
      <Suspense fallback={<p className="text-sm text-muted">Loading your profile…</p>}>
        <Review params={params} />
      </Suspense>
    </div>
  );
}
