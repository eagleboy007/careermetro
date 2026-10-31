import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { PageLoading } from "@/components/app/page-loading";
import { CommentBox, CommentList } from "@/components/junction/comments";
import { PostCard } from "@/components/junction/post-card";
import { currentAccount } from "@/lib/auth/server";
import { commentsFor, pinsOf, postById } from "@/lib/junction/feed";
import { junctionEnabled } from "@/lib/preview";
import { commentActions, postActions } from "../../wire";

// A generic title: a post's title stays out of tab titles, history sync and any analytics that read titles.
export const metadata: Metadata = { title: "Post · Junction · CareerMetro", robots: { index: false, follow: false } };

/**
 * One post with its comments (plan section 4, /junction/p/[id]): Upvote, Reshare, Save, Report on the post and on each
 * comment, Edit for 30 minutes and Delete on your own. A post the viewer may not see (deleted, hidden from them, behind
 * a block either way, by a suspended or deleting account) is the not-found page, the same for each reason.
 */
async function PostScreen({ params }: { params: PageProps<"/junction/p/[id]">["params"] }) {
  const { id } = await params;
  await connection();
  if (!junctionEnabled()) notFound();
  const account = await currentAccount();
  if (!account) notFound();
  const post = await postById(account.id, id);
  if (!post) notFound();
  const [comments, pins] = await Promise.all([commentsFor(account.id, post.id), post.author.isYou ? pinsOf(account.id) : Promise.resolve(undefined)]);
  const now = new Date().toISOString();
  return (
    <div className="mx-auto flex w-full max-w-[760px] min-w-0 flex-col gap-4">
      <Link href="/junction" className="inline-flex min-h-11 items-center gap-1.5 self-start text-[0.86rem] font-semibold text-ink hover:text-muted">
        <ArrowLeft size={16} strokeWidth={1.75} aria-hidden="true" />
        Junction
      </Link>
      <h1 className="sr-only">A post on Junction</h1>
      <PostCard post={post} now={now} actions={postActions} detail pins={pins} />
      <section aria-labelledby="comments-h" className="flex min-w-0 flex-col gap-3 rounded-[18px] border border-line bg-surface p-4">
        <h2 id="comments-h" className="text-[1.08rem] font-semibold">
          Comments
        </h2>
        <CommentList comments={comments} now={now} actions={commentActions} />
        <CommentBox postId={post.id} actions={commentActions} closed={post.status === "visible" ? undefined : "Comments are closed while this post is held or hidden."} />
      </section>
    </div>
  );
}

// Cache Components needs one param to check the route at build time; every real post is read at request time.
export function generateStaticParams() {
  return [{ id: "00000000-0000-4000-8000-000000000000" }];
}

export default function PostPage({ params }: PageProps<"/junction/p/[id]">) {
  return (
    <Suspense fallback={<PageLoading />}>
      <PostScreen params={params} />
    </Suspense>
  );
}
