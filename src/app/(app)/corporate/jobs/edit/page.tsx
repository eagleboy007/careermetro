import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { PageLoading } from "@/components/app/page-loading";
import { JobFormScreen } from "../job-form-screen";

export const metadata: Metadata = { title: "Edit job · CareerMetro", robots: { index: false } };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/*
 * The job is named in the query (`/corporate/jobs/edit?id=…`), not a path segment: the signed-in shell's loading frame
 * reads the path, which a segment unknown at build time would leave unresolved while prerendering.
 */
async function EditJob({ searchParams }: PageProps<"/corporate/jobs/edit">) {
  const id = (await searchParams).id;
  if (typeof id !== "string" || !UUID.test(id)) notFound();
  return <JobFormScreen jobId={id} />;
}

/** Edit a job (the same form as Post a job), from Jobs in Corporate. */
export default function EditJobPage(props: PageProps<"/corporate/jobs/edit">) {
  return (
    <Suspense fallback={<PageLoading />}>
      <EditJob {...props} />
    </Suspense>
  );
}
