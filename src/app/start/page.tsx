import type { Metadata } from "next";
import { ProgressRoute } from "@/components/route/progress-route";
import { UploadForm } from "@/components/resume/upload-form";
import { SiteHeader } from "@/components/site/site-header";

// Private beta: reachable by link only, not indexed.
export const metadata: Metadata = { title: "Add your resume · CareerMetro", robots: { index: false } };

export default function StartPage() {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 pb-20">
      <SiteHeader />
      <ProgressRoute current="Resume" />
      <section className="flex flex-col gap-3">
        <h1 className="text-4xl font-semibold leading-[1.05]">Add your resume</h1>
        <p className="text-muted">
          We read your experience and skills, then you check what we found. Nothing is analysed until you confirm it.
        </p>
      </section>
      <UploadForm />
    </div>
  );
}
