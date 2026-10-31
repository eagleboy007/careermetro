import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { PageLoading } from "@/components/app/page-loading";
import { JunctionComposer, JunctionRulesGate } from "@/components/junction/composer";
import { FeedList, FeedTabs } from "@/components/junction/feed";
import { JunctionRail } from "@/components/junction/rail";
import { currentAccount } from "@/lib/auth/server";
import { composerFor, feedFor, junctionRail } from "@/lib/junction/feed";
import { needsJunctionRules } from "@/lib/junction/store";
import { junctionEnabled } from "@/lib/preview";
import { JUNCTION_FEEDS, type JunctionFeed } from "@/lib/schemas/constants";
import { composerActions, feedActions, postActions, railActions } from "./wire";

export const metadata: Metadata = { title: "Junction · CareerMetro", robots: { index: false, follow: false } };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Junction, the community board (docs/plans/junction-plan.md, FR-61): the composer (or the house rules until they are
 * accepted), the feed tabs with 20 posts a page and "Show more", and the rail. Signed in only and not indexed; the
 * not-found page while JUNCTION_ENABLED is off, as the proxy also answers.
 */
async function JunctionScreen({ searchParams }: PageProps<"/junction">) {
  const params = await searchParams;
  await connection();
  if (!junctionEnabled()) notFound();
  const account = await currentAccount();
  if (!account) notFound();
  const feed: JunctionFeed = JUNCTION_FEEDS.includes(params.feed as JunctionFeed) ? (params.feed as JunctionFeed) : "top";
  const interestId = feed === "interests" && typeof params.interest === "string" && UUID.test(params.interest) ? params.interest : undefined;
  const now = new Date();
  const [result, composer, rail, gate] = await Promise.all([
    feedFor(account.id, { feed, interestId }, { now }),
    composerFor(account.id),
    junctionRail(account.id, { now }),
    needsJunctionRules(account.id),
  ]);
  const page = result.ok ? result.page : { posts: [], nextCursor: null };
  const needs = result.ok ? result.needs : null;
  return (
    <div className="grid min-w-0 gap-5 min-[1000px]:grid-cols-[minmax(0,1fr)_320px]">
      <div className="flex min-w-0 flex-col gap-4">
        <header className="flex flex-col gap-1">
          <h1 className="text-[1.7rem] font-semibold">Junction</h1>
          <p className="text-[0.9rem] text-muted">Questions, ideas, wins and free resources from people on the same roads.</p>
        </header>
        {gate ? <JunctionRulesGate onAccept={composerActions.acceptRules} /> : <JunctionComposer data={composer} actions={composerActions} />}
        <FeedTabs feed={feed} interests={composer.interests} interestId={interestId ?? null} />
        {feed === "top" && <p className="text-[0.8rem] text-muted">Votes, comments and reshares from the last 7 days.</p>}
        {!result.ok ? (
          <p role="alert" className="text-[0.9rem]">
            Junction isn&rsquo;t available on your account right now.
          </p>
        ) : needs === "route" ? (
          <p className="rounded-[18px] border border-dashed border-line-strong px-4 py-6 text-center text-[0.9rem] text-muted">
            Add your resume to see posts from people aiming for the same role.{" "}
            <Link href="/today" className="font-semibold text-ink underline underline-offset-2">
              Go to Today
            </Link>
          </p>
        ) : needs === "interests" ? (
          <p className="rounded-[18px] border border-dashed border-line-strong px-4 py-6 text-center text-[0.9rem] text-muted">
            Add an interest in Your interests to see posts tagged with it.
          </p>
        ) : (
          <FeedList key={`${feed}-${interestId ?? ""}`} feed={feed} interestId={interestId} page={page} now={now.toISOString()} actions={postActions} more={feedActions.more} />
        )}
      </div>
      <JunctionRail data={rail} actions={railActions} />
    </div>
  );
}

export default function JunctionPage(props: PageProps<"/junction">) {
  return (
    <Suspense fallback={<PageLoading />}>
      <JunctionScreen {...props} />
    </Suspense>
  );
}
