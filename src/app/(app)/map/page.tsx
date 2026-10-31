import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { PageLoading } from "@/components/app/page-loading";
import { MetroMap } from "@/components/map/metro-map";
import { addCertificate } from "../today/actions";
import { chooseDestination } from "./actions";
import { currentAccount } from "@/lib/auth/server";
import { currentAnalysis } from "@/lib/gaps/current";
import { errorFields, logEvent } from "@/lib/log";
import { exampleLifeLine, exampleMapLine, exampleRiders } from "@/lib/map/fixtures";
import { pitstopRidersFor } from "@/lib/map/riders";
import { lifeLineFor, mapLineFor } from "@/lib/map/store";
import type { PitstopRiders } from "@/lib/schemas";
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
        {state === "no_resume" ? <MetroMap line={null} /> : <MetroMap line={exampleMapLine} life={exampleLifeLine} riders={exampleRiders} />}
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
  // On your line (C13): people on the line's pitstops who show theirs on the map, read fresh on every load. A side part:
  // if it can't be read, the map draws without counts (logged by event name only). The sample resume's line is a made-up
  // person's, so it shows nobody.
  const riders = line && !sample
    ? await pitstopRidersFor(
        account.id,
        line.goals.map((g) => g.skillId),
      ).catch((error: unknown): PitstopRiders[] => {
        logEvent("error", "map_riders_failed", errorFields(error));
        return [];
      })
    : [];
  return (
    <div className="flex flex-col gap-4">
      {line && (
        <Banner>
          Your line comes from your gaps and your path, and your Life line from your resume. People on the same goal show as a count; your connections by name.
          Turn on Show my pitstop on the map to be counted.
        </Banner>
      )}
      <MetroMap line={line} life={life} sample={sample} onAddCertificate={addCertificate} onChooseDestination={chooseDestination} riders={riders} />
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
