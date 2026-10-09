import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { RolePicker } from "@/components/gaps/role-picker";
import { ResumeNotFound } from "@/components/resume/resume-not-found";
import { ProgressRoute } from "@/components/route/progress-route";
import { SiteHeader } from "@/components/site/site-header";
import { getResumeForOwner } from "@/lib/resume/store";
import { roleViews } from "@/lib/role-view";
import { readOwner } from "@/lib/session";

export const metadata: Metadata = { title: "Pick a role · CareerMetro", robots: { index: false } };

const options = roleViews.map((r) => ({ slug: r.slug, title: r.title, experience: r.experience, topSkills: r.required.slice(0, 3).map((s) => s.name) }));

async function Picker({ params }: { params: Promise<{ id: string }> }) {
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
  return <RolePicker resumeId={id} roles={options} />;
}

export default function RolePage({ params }: PageProps<"/resume/[id]/role">) {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 pb-20">
      <SiteHeader />
      <ProgressRoute current="Gaps" />
      <section className="flex flex-col gap-3">
        <h1 className="text-4xl font-semibold leading-[1.05]">Which role are you aiming for?</h1>
        <p className="text-muted">We&apos;ll compare your resume with what employers ask for in that role.</p>
      </section>
      <Suspense fallback={<p className="text-sm text-muted">Loading roles…</p>}>
        <Picker params={params} />
      </Suspense>
    </div>
  );
}
