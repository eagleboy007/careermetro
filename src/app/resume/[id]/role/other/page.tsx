import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { StandInForm } from "@/components/gaps/stand-in-form";
import { ResumeNotFound } from "@/components/resume/resume-not-found";
import { ProgressRoute } from "@/components/route/progress-route";
import { SiteHeader } from "@/components/site/site-header";
import { getResumeForOwner } from "@/lib/resume/store";
import { readOwner } from "@/lib/session";

export const metadata: Metadata = { title: "My role isn't listed · CareerMetro", robots: { index: false } };

async function Form({ params }: { params: Promise<{ id: string }> }) {
  // Per-request data: the resume lookup reads the clock and the session cookie.
  await connection();
  const { id } = await params;
  const owner = await readOwner();
  const resume = owner ? await getResumeForOwner(id, owner) : null;
  if (!resume) return <ResumeNotFound />;
  if (!resume.confirmed) {
    return (
      <p className="rounded-lg border border-line bg-surface p-5 text-sm">
        First check your resume and press <strong>Looks right</strong>.{" "}
        <Link href={`/resume/${id}`} className="font-medium underline underline-offset-2">
          Check your resume
        </Link>
      </p>
    );
  }
  // The title typed in the role search arrives in the browser through sessionStorage, never in the address.
  return <StandInForm resumeId={id} />;
}

/**
 * "My role isn't listed" (role-suggest-plan.md part B, point 4): paste a posting for the role, and it stands in as the
 * target until we add the role. Its job title is counted, with nothing about the person, so we know which roles to add.
 */
export default function OtherRolePage({ params }: PageProps<"/resume/[id]/role/other">) {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 pb-20">
      <SiteHeader />
      <ProgressRoute current="Gaps" />
      <section className="flex flex-col gap-3">
        <h1 className="text-4xl font-semibold leading-[1.05]">Check against a job instead</h1>
        <p className="text-muted">
          Your role isn&apos;t in our list yet. Paste a job posting for it and we&apos;ll show what it asks for as your gaps, until we add the role.
          We keep the company, the job title and the skills it lists, never the posting itself. We also count the job title, with nothing about
          you, so we know which roles to add.
        </p>
      </section>
      <Suspense fallback={<p className="text-sm text-muted">Loading…</p>}>
        <Form params={params} />
      </Suspense>
      <p className="text-sm text-muted">
        <Suspense fallback={null}>
          <BackLink params={params} />
        </Suspense>
      </p>
    </main>
  );
}

async function BackLink({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <Link href={`/resume/${id}/role`} className="underline underline-offset-2 hover:text-ink">
      Back to the role list
    </Link>
  );
}
