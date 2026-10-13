import type { Metadata } from "next";
import { unstable_rethrow } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { PageLoading } from "@/components/app/page-loading";
import { MarketView, type MarketNearby } from "@/components/market/market-view";
import { currentAccount } from "@/lib/auth/server";
import { errorFields, logEvent } from "@/lib/log";
import { exampleMapLine } from "@/lib/map/fixtures";
import { mapLineFor } from "@/lib/map/store";
import { DEFAULT_MARKET_ROLE } from "@/lib/market/data";

export const metadata: Metadata = { title: "Market · CareerMetro", robots: { index: false } };

/**
 * Market (handoff C6). The figures are example data from src/content/market; the choices live in the address. The
 * person's own line gives the role it opens on and their Nearby lines; if it can't be read, the Market still shows,
 * without them (logged as market_line_failed, error fields only).
 */
async function MarketScreen({ searchParams }: PageProps<"/market">) {
  const params = await searchParams;
  await connection();
  const account = await currentAccount();
  let line = account ? null : exampleMapLine;
  if (account) {
    try {
      line = await mapLineFor(account.id);
    } catch (error) {
      unstable_rethrow(error);
      logEvent("error", "market_line_failed", errorFields(error));
    }
  }
  const nearby: MarketNearby = {
    nearby: line?.nearby ?? null,
    changeRoleHref: line?.resumeId ? `/resume/${line.resumeId}/role` : null,
    example: !account,
  };
  return <MarketView params={params} defaultRole={line?.role.slug ?? DEFAULT_MARKET_ROLE} nearby={nearby} today={new Date()} />;
}

export default function MarketPage(props: PageProps<"/market">) {
  return (
    <Suspense fallback={<PageLoading />}>
      <MarketScreen {...props} />
    </Suspense>
  );
}
