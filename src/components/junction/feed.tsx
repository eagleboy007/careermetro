"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import type { FeedActions, MineActions, MineTab, PostActions } from "@/lib/junction/types";
import type { JunctionFeed } from "@/lib/schemas/constants";
import type { FeedPage, PostCardView } from "@/lib/schemas/junction";
import { PostCard } from "./post-card";
import { ghost } from "./styles";

export const FEED_TABS: { key: JunctionFeed; label: string }[] = [
  { key: "top", label: "Top this week" },
  { key: "new", label: "New" },
  { key: "route", label: "My route" },
  { key: "following", label: "Following" },
  { key: "interests", label: "My interests" },
];

/** What each tab says when it has nothing to show. */
export const EMPTY_TEXT: Record<JunctionFeed, string> = {
  top: "Nothing from the last 7 days yet. Ask the first question.",
  new: "No posts yet. Ask the first question.",
  route: "No posts on your route yet. Ask the first question.",
  following: "Nothing from your connections yet. Posts and reshares by people you are connected to show here.",
  interests: "No posts on your interests yet. Post one, or add more interests.",
};

/**
 * The feed tabs (plan section 1): links, so each tab has its own address and works before the page's script loads. The
 * open tab says so (aria-current). My interests adds a chip row that narrows it to one interest.
 */
export function FeedTabs({ feed, interests, interestId }: { feed: JunctionFeed; interests?: { id: string; name: string }[]; interestId?: string | null }) {
  return (
    <div className="flex flex-col gap-2">
      <nav aria-label="Junction feeds" className="-mx-1 flex gap-1 overflow-x-auto border-b border-line px-1">
        {FEED_TABS.map((t) => (
          <Link
            key={t.key}
            href={t.key === "top" ? "/junction" : `/junction?feed=${t.key}`}
            aria-current={t.key === feed ? "page" : undefined}
            className="inline-flex min-h-11 shrink-0 items-center border-b-2 border-transparent px-3 text-[0.86rem] font-medium text-muted hover:text-ink aria-[current=page]:border-ink aria-[current=page]:font-semibold aria-[current=page]:text-ink"
          >
            {t.label}
          </Link>
        ))}
      </nav>
      {feed === "interests" && interests && interests.length > 0 && (
        <nav aria-label="Filter by interest" className="flex flex-wrap gap-1.5">
          <Link href="/junction?feed=interests" aria-current={!interestId ? "page" : undefined} className={`${ghost} aria-[current=page]:border-line-strong aria-[current=page]:bg-surface-2 aria-[current=page]:font-semibold`}>
            All my interests
          </Link>
          {interests.map((t) => (
            <Link
              key={t.id}
              href={`/junction?feed=interests&interest=${t.id}`}
              aria-current={interestId === t.id ? "page" : undefined}
              className={`${ghost} aria-[current=page]:border-line-strong aria-[current=page]:bg-surface-2 aria-[current=page]:font-semibold`}
            >
              {t.name}
            </Link>
          ))}
        </nav>
      )}
    </div>
  );
}

/**
 * A list of posts, 20 at a time, with "Show more" fetching the next keyset page. Focus moves to the first new post, so
 * a keyboard user carries on from where the list grew. Without `more` (the /design gallery) only the first page shows.
 */
export function PostList({
  page,
  now,
  more,
  actions,
  empty,
  pins,
}: {
  page: FeedPage;
  now: string;
  more?: (cursor: string) => Promise<FeedPage | null>;
  actions?: PostActions;
  empty: string;
  pins?: Record<string, number>;
}) {
  const [posts, setPosts] = useState<PostCardView[]>(page.posts);
  const [cursor, setCursor] = useState(page.nextCursor);
  const [error, setError] = useState<string | null>(null);
  const [focusAt, setFocusAt] = useState<{ index: number; n: number } | null>(null);
  const [pending, start] = useTransition();
  const list = useRef<HTMLOListElement>(null);
  // A refresh after a post, a vote or a delete sends a new first page: start again from it.
  const [seen, setSeen] = useState(page);
  if (seen !== page) {
    setSeen(page);
    setPosts(page.posts);
    setCursor(page.nextCursor);
  }
  useEffect(() => {
    if (!focusAt) return;
    // The new post's title link (a list item's first link is the author's profile).
    list.current?.children[focusAt.index]?.querySelector<HTMLElement>("h3 a")?.focus();
  }, [focusAt]);
  if (!posts.length) return <p className="rounded-[18px] border border-dashed border-line-strong px-4 py-6 text-center text-[0.9rem] text-muted">{empty}</p>;
  return (
    <div className="flex flex-col gap-3">
      <ol ref={list} aria-label="Posts" className="flex flex-col gap-3">
        {posts.map((p) => (
          <li key={p.id}>
            <PostCard post={p} now={now} actions={actions} pins={pins} />
          </li>
        ))}
      </ol>
      {error && (
        <p role="alert" className="text-[0.84rem] font-medium text-ink">
          {error}
        </p>
      )}
      {cursor && more && (
        <button
          type="button"
          className={`${ghost} self-center`}
          aria-disabled={pending}
          onClick={() =>
            !pending &&
            start(async () => {
              const next = await more(cursor).catch(() => null);
              if (!next) return setError("Couldn't load more. Please try again.");
              setError(null);
              const known = new Set(posts.map((p) => p.id));
              const fresh = next.posts.filter((p) => !known.has(p.id));
              setFocusAt((f) => ({ index: posts.length, n: (f?.n ?? 0) + 1 }));
              setPosts([...posts, ...fresh]);
              setCursor(next.nextCursor);
            })
          }
        >
          Show more
        </button>
      )}
    </div>
  );
}

/** A feed tab's list, with "Show more" bound to the tab and interest. */
export function FeedList({ feed, interestId, page, now, actions, more }: { feed: JunctionFeed; interestId?: string; page: FeedPage; now: string; actions?: PostActions; more?: FeedActions["more"] }) {
  return <PostList page={page} now={now} actions={actions} empty={EMPTY_TEXT[feed]} more={more ? (cursor) => more({ feed, interestId, cursor }) : undefined} />;
}

/** Your posts or Saved on /junction/mine, with "Show more" bound to the tab. */
export function MineList({ tab, page, now, actions, more, pins }: { tab: MineTab; page: FeedPage; now: string; actions?: PostActions; more?: MineActions["more"]; pins?: Record<string, number> }) {
  return (
    <PostList
      page={page}
      now={now}
      actions={actions}
      pins={tab === "posts" ? pins : undefined}
      empty={tab === "saved" ? "Nothing saved yet. Save a post to find it here." : "You haven't posted yet."}
      more={more ? (cursor) => more(tab, cursor) : undefined}
    />
  );
}
