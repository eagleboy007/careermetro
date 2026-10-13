import type { Metadata } from "next";
import { Suspense } from "react";
import { PageLoading } from "@/components/app/page-loading";
import { JobFormScreen } from "../job-form-screen";

export const metadata: Metadata = { title: "Post a job · CareerMetro", robots: { index: false } };

/** Post a job (handoff 12g, `/corporate/jobs/new`), opened from Jobs in Corporate. */
export default function NewJobPage() {
  return (
    <Suspense fallback={<PageLoading />}>
      <JobFormScreen jobId={null} />
    </Suspense>
  );
}
