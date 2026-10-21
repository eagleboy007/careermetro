import type { Metadata } from "next";
import { unstable_rethrow } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { PageLoading } from "@/components/app/page-loading";
import { MarketView, type MarketNearby } from "@/components/market/market-view";
import { MARKET_DATA, marketStates } from "@/content/market";
import { currentAccount } from "@/lib/auth/server";
import { errorFields, logEvent } from "@/lib/log";
import { exampleMapLine } from "@/lib/map/fixtures";
import { mapLineFor } from "@/lib/map/store";
import { DEFAULT_MARKET_ROLE, exampleMarketData, marketData, marketRoles } from "@/lib/market/data";
import { liveNothing } from "@/lib/market/fixtures";
import { liveMarket } from "@/lib/market/live";
import { liveMarketInputs, MARKET_PAGE_LIMIT_MS } from "@/lib/market/live-store";
import type { MarketData } from "@/lib/market/query";
import { failureReason, withinLimit } from "@/lib/time-limit";

export const metadata: Metadata = { title: "Market · CareerMetro", robots: { index: false } };

/**
 * Live counts (MARKET_DATA = "live", docs/plans/market-trends-plan.md), read per request like Departures: the feed
 * changes them once a day, and nothing here is cached across requests. If they can't be read, the screen says so and
 * shows no figure (only Nearby lines) rather than fail (logged as market_live_failed, error fields and a reason). Posts of a role the Market no
 * longer offers are left out and logged as a count.
 * T122: the reads carry their own statement and lock limits, and the page gives up on them after MARKET_PAGE_LIMIT_MS
 * whatever they wait on (a pooled connection too), so the screen always finishes; `reason` says which limit it was.
 */
async function liveFigures(now: Date): Promise<MarketData> {
  const opts = { now, roles: marketRoles.map((r) => r.slug), states: marketStates };
  try {
    const { market, dropped } = liveMarket(await withinLimit(liveMarketInputs({ now }), MARKET_PAGE_LIMIT_MS), opts);
    if (dropped) logEvent("info", "market_live_unknown_roles", { posts: dropped });
    return market;
  } catch (error) {
    unstable_rethrow(error);
    logEvent("error", "market_live_failed", { ...errorFields(error), reason: failureReason(error) });
    return liveMarket(liveNothing, { ...opts, failed: true }).market;
  }
}

/**
 * Market (handoff C6). Signed in, the figures are live counts from public company job boards; signed out (the preview
 * without sign-in), the example table, labelled EXAMPLE DATA, as the example line is. The choices live in the address.
 * The person's own line gives the role it opens on and their Nearby lines; if it can't be read, the Market still
 * shows, without them (logged as market_line_failed, error fields and which limit, if any). It gets the same time limit
 * as the live counts (T122), so a slow read can't hold the screen either.
 */
async function MarketScreen({ searchParams }: PageProps<"/market">) {
  const params = await searchParams;
  await connection();
  const now = new Date();
  const account = await currentAccount();
  const figures = account && MARKET_DATA === "live" ? liveFigures(now) : Promise.resolve(account ? marketData : exampleMarketData);
  let line = account ? null : exampleMapLine;
  if (account) {
    try {
      line = await withinLimit(mapLineFor(account.id), MARKET_PAGE_LIMIT_MS);
    } catch (error) {
      unstable_rethrow(error);
      logEvent("error", "market_line_failed", { ...errorFields(error), reason: failureReason(error) });
    }
  }
  const market = await figures;
  const nearby: MarketNearby = {
    nearby: line?.nearby ?? null,
    changeRoleHref: line?.resumeId ? `/resume/${line.resumeId}/role` : null,
    example: !account,
  };
  return <MarketView params={params} defaultRole={line?.role.slug ?? DEFAULT_MARKET_ROLE} nearby={nearby} today={now} market={market} />;
}

export default function MarketPage(props: PageProps<"/market">) {
  return (
    <Suspense fallback={<PageLoading />}>
      <MarketScreen {...props} />
    </Suspense>
  );
}
