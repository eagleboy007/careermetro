import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { PageLoading } from "@/components/app/page-loading";
import { MetroMap } from "@/components/map/metro-map";
import { addCertificate } from "../today/actions";
import { chooseDestination } from "./actions";
import { currentAccount } from "@/lib/auth/server";
import { currentAnalysis } from "@/lib/gaps/current";
import { exampleLifeLine, exampleMapLine } from "@/lib/map/fixtures";
import { lifeLineFor, mapLineFor } from "@/lib/map/store";
import { isSampleResumeId } from "@/lib/resume/sample";

export const metadata: Metadata = { title: "Map · CareerMetro", robots: { index: false } };

async function MapScreen({ searchParams }: PageProps<"/map">) {
  const state = (await searchParams).state;
  await connection();
  const account = await currentAccount();
  if (!account) {
    // Example mode (no sign-in on this deployment): ?state=no_resume shows the locked map.
    return (
      <div className="flex flex-col gap-4">
        <Banner>Preview with example data. Your own line appears here once you add your resume.</Banner>
        {state === "no_resume" ? <MetroMap line={null} /> : <MetroMap line={exampleMapLine} life={exampleLifeLine} />}
      </div>
    );
  }
  // Signed in: the line comes from the person's own gaps and path; a certificate added on a prove pitstop meets its goal.
  // The current analysis is read once and handed to both lines (docs/plans/perf-pass.md).
  const analysis = await currentAnalysis(account.id);
  const [line, life, sample] = await Promise.all([
    mapLineFor(account.id, undefined, undefined, analysis),
    lifeLineFor(account.id, new Date(), undefined, analysis),
    analysis ? isSampleResumeId(analysis.resumeId) : false,
  ]);
  return (
    <div className="flex flex-col gap-4">
      {line && <Banner>Your line comes from your gaps and your path, and your Life line from your resume. Other people on it appear once profiles can be found.</Banner>}
      <MetroMap line={line} life={life} sample={sample} onAddCertificate={addCertificate} onChooseDestination={chooseDestination} />
    </div>
  );
}

function Banner({ children }: { children: React.ReactNode }) {
  return <p className="rounded-md bg-surface-2 px-3.5 py-2 text-[0.8rem] text-muted">{children}</p>;
}

export default function MapPage(props: PageProps<"/map">) {
  return (
    <Suspense fallback={<PageLoading />}>
      <MapScreen {...props} />
    </Suspense>
  );
}
