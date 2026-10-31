import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { PageLoading } from "@/components/app/page-loading";
import { MineList } from "@/components/junction/feed";
import { MineTabs, RemovalNotices } from "@/components/junction/mine";
import { currentAccount } from "@/lib/auth/server";
import { ownPostsPage, pinsOf, savedPostsPage } from "@/lib/junction/feed";
import { removalNoticesFor } from "@/lib/junction/moderation";
import type { MineTab } from "@/lib/junction/types";
import { junctionEnabled } from "@/lib/preview";
import { mineActions, postActions } from "../wire";

export const metadata: Metadata = { title: "Your posts · Junction · CareerMetro", robots: { index: false, follow: false } };

/**
 * Your Junction (plan section 4, /junction/mine): notices on your hidden posts and comments with their appeal, then
 * Your posts (every post you haven't deleted, held and hidden ones too, with Pin to profile) or Saved. Your own content
 * only.
 */
async function MineScreen({ searchParams }: PageProps<"/junction/mine">) {
  const params = await searchParams;
  await connection();
  if (!junctionEnabled()) notFound();
  const account = await currentAccount();
  if (!account) notFound();
  const tab: MineTab = params.tab === "saved" ? "saved" : "posts";
  const now = new Date();
  const [list, notices, pins] = await Promise.all([
    tab === "saved" ? savedPostsPage(account.id, undefined) : ownPostsPage(account.id, undefined),
    removalNoticesFor(account.id, undefined, now),
    pinsOf(account.id),
  ]);
  return (
    <div className="mx-auto flex w-full max-w-[760px] min-w-0 flex-col gap-4">
      <Link href="/junction" className="inline-flex min-h-11 items-center gap-1.5 self-start text-[0.86rem] font-semibold text-ink hover:text-muted">
        <ArrowLeft size={16} strokeWidth={1.75} aria-hidden="true" />
        Junction
      </Link>
      <h1 className="text-[1.7rem] font-semibold">Your Junction</h1>
      <RemovalNotices notices={notices} onAppeal={mineActions.appeal} />
      <MineTabs tab={tab} />
      {tab === "posts" && <p className="text-[0.82rem] text-muted">Pin up to 3 posts to show them on your profile under On Junction.</p>}
      {list.ok ? (
        <MineList key={tab} tab={tab} page={list.page} now={now.toISOString()} actions={postActions} more={mineActions.more} pins={pins} />
      ) : (
        <p role="alert" className="text-[0.9rem]">
          Junction isn&rsquo;t available on your account right now.
        </p>
      )}
    </div>
  );
}

export default function MinePage(props: PageProps<"/junction/mine">) {
  return (
    <Suspense fallback={<PageLoading />}>
      <MineScreen {...props} />
    </Suspense>
  );
}
