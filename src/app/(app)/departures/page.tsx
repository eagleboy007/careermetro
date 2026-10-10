import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { DeparturesView } from "@/components/departures/departures-view";
import { currentAccount } from "@/lib/auth/server";
import { exampleApplied, exampleJobs, exampleSaved } from "@/lib/departures/fixtures";
import { currentAnalysis } from "@/lib/today/state";

export const metadata: Metadata = { title: "Departures · CareerMetro", robots: { index: false } };

async function DeparturesScreen({ searchParams }: PageProps<"/departures">) {
  const state = (await searchParams).state;
  await connection();
  const account = await currentAccount();
  // Real roles need the job-post tables (dev/departures-plan.md). Until then everyone sees example roles, and a signed-in
  // person sees fit only once they have gaps.
  const hasResume = account ? (await currentAnalysis(account.id)) !== null : state !== "no_resume";
  return (
    <div className="flex flex-col gap-4">
      <p className="rounded-md bg-surface-2 px-3.5 py-2 text-[0.8rem] text-muted">
        Example roles for now. Real roles from public company job boards, and your own saved and applied lists, come next.
      </p>
      <DeparturesView jobs={exampleJobs} hasResume={hasResume} initialSaved={account ? [] : exampleSaved} initialApplied={account ? [] : exampleApplied} />
    </div>
  );
}

export default function DeparturesPage(props: PageProps<"/departures">) {
  return (
    <Suspense>
      <DeparturesScreen {...props} />
    </Suspense>
  );
}
