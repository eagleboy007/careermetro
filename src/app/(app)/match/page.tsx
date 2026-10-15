import type { Metadata } from "next";
import { unstable_rethrow } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { PageLoading } from "@/components/app/page-loading";
import { MatchView } from "@/components/match/match-view";
import { currentAccount } from "@/lib/auth/server";
import { errorFields, logEvent } from "@/lib/log";
import { exampleMatch } from "@/lib/match/fixtures";
import { matchFor } from "@/lib/match/store";
import type { MatchList } from "@/lib/schemas";

export const metadata: Metadata = { title: "Match · CareerMetro", robots: { index: false } };

/**
 * Match (FR-24, handoff 12i). Signed in only: the signed-in layout and the proxy send everyone else away, and with no
 * sign-in on this deployment the page shows example data. The roles come from the person's own confirmed profile,
 * proof and path, read by their user id. No AI.
 */
async function MatchScreen({ searchParams }: PageProps<"/match">) {
  const state = (await searchParams).state;
  await connection();
  const account = await currentAccount();
  if (!account) {
    // Example mode (no sign-in on this deployment): ?state=no_resume shows the empty state.
    return (
      <div className="flex flex-col gap-4">
        <Banner>Preview with example data. Your own roles appear here once you add your resume.</Banner>
        <MatchView list={state === "no_resume" ? null : exampleMatch} />
      </div>
    );
  }
  let list: MatchList | null;
  try {
    list = await matchFor(account.id, account.weeklyHours);
  } catch (error) {
    unstable_rethrow(error);
    // Database and schema errors can carry values; errorFields keeps only the name and code.
    logEvent("error", "match_failed", errorFields(error));
    return (
      <p role="alert" className="rounded-lg border border-line bg-surface p-5 text-sm">
        We couldn&apos;t work out your matches just now. Please reload the page in a minute.
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-4">
      {list && <Banner>From your resume, your proved goals and your path. Looking here changes none of your goals.</Banner>}
      <MatchView list={list} />
    </div>
  );
}

function Banner({ children }: { children: React.ReactNode }) {
  return <p className="rounded-md bg-surface-2 px-3.5 py-2 text-[0.8rem] text-muted">{children}</p>;
}

export default function MatchPage(props: PageProps<"/match">) {
  return (
    <Suspense fallback={<PageLoading />}>
      <MatchScreen {...props} />
    </Suspense>
  );
}
