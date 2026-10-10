import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { MetroMap } from "@/components/map/metro-map";
import { currentAccount } from "@/lib/auth/server";
import { exampleLifeLine, exampleMapLine } from "@/lib/map/fixtures";
import { lifeLineFor, mapLineFor } from "@/lib/map/store";

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
  // Signed in: the line comes from the person's own gaps and path. Proof comes in a later step, so no goal is met yet.
  const [line, life] = await Promise.all([mapLineFor(account.id), lifeLineFor(account.id, new Date())]);
  return (
    <div className="flex flex-col gap-4">
      {line && <Banner>Your line comes from your gaps and your path, and your Life line from your resume. Other people on it appear once profiles can be found.</Banner>}
      <MetroMap line={line} life={life} />
    </div>
  );
}

function Banner({ children }: { children: React.ReactNode }) {
  return <p className="rounded-md bg-surface-2 px-3.5 py-2 text-[0.8rem] text-muted">{children}</p>;
}

export default function MapPage(props: PageProps<"/map">) {
  return (
    <Suspense>
      <MapScreen {...props} />
    </Suspense>
  );
}
