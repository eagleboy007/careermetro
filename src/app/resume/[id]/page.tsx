import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ProfileEditor } from "@/components/resume/profile-editor";
import { ProgressRoute } from "@/components/route/progress-route";
import { Logo } from "@/components/ui/logo";
import { getResumeForSession } from "@/lib/resume/store";
import { readSessionId } from "@/lib/session";

export const metadata: Metadata = { title: "Check your resume · CareerMetro", robots: { index: false } };

async function Review({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sessionId = await readSessionId();
  const resume = sessionId ? await getResumeForSession(id, sessionId) : null;

  if (!resume) {
    return (
      <div className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-5">
        <p className="font-semibold">We couldn&apos;t find this resume.</p>
        <p className="text-sm text-muted">
          Resumes added without an account are deleted after 24 hours, and can only be opened in the browser that added them.
        </p>
        <Link href="/start" className="text-sm font-medium underline underline-offset-2">
          Add your resume again
        </Link>
      </div>
    );
  }
  return <ProfileEditor resumeId={resume.resumeId} initial={resume.profile} />;
}

export default function ResumePage({ params }: PageProps<"/resume/[id]">) {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 pb-20">
      <header className="border-b border-line py-5">
        <Link href="/" aria-label="CareerMetro home">
          <Logo />
        </Link>
      </header>
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
