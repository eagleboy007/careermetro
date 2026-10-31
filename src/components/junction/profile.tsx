"use client";

import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { useId, useState, useTransition } from "react";
import { Switch } from "@/components/ui/switch";
import type { ProfileActions } from "@/lib/junction/types";
import { JUNCTION_PINS_MAX } from "@/lib/schemas/constants";
import type { PostCardView } from "@/lib/schemas/junction";
import { PostCard } from "./post-card";
import { card, ICON } from "./styles";

const FAILED = "That didn't work. Please try again.";

/**
 * "On Junction" on a profile (plan section 4, PinnedPosts): up to 3 pinned posts and how many posts the viewer can
 * read in all. On your own Me it adds the "Junction posts" switch (off hides the section from everyone else) and the
 * way to Your posts, where you pin.
 */
export function PinnedPosts({
  name,
  posts,
  total,
  now,
  own = false,
  shown = true,
  actions,
}: {
  /** The owner's first name, for "Priya's posts". */
  name: string;
  posts: PostCardView[];
  total: number;
  now: string;
  own?: boolean;
  /** Your own switch's state (own only). */
  shown?: boolean;
  actions?: ProfileActions;
}) {
  const headingId = useId();
  const [on, setOn] = useState(shown);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <section aria-labelledby={headingId} className={card}>
      <h2 id={headingId} className="text-[1.08rem] font-semibold">
        On Junction
      </h2>
      <p className="text-[0.84rem] text-muted">
        {total === 0 ? (own ? "You haven't posted on Junction yet." : `${name} hasn't posted on Junction yet.`) : `${total} ${total === 1 ? "post" : "posts"} on Junction.`}
        {own && posts.length === 0 && total > 0 ? ` Pin up to ${JUNCTION_PINS_MAX} of yours from Your posts.` : ""}
      </p>
      {posts.length > 0 && (
        <ul aria-label={own ? "Your pinned posts" : `${name}'s pinned posts`} className="flex flex-col gap-2">
          {posts.map((p) => (
            <li key={p.id}>
              <PostCard post={p} now={now} compact />
            </li>
          ))}
        </ul>
      )}
      {own && (
        <>
          <Link href="/junction/mine" className="inline-flex min-h-11 items-center gap-1 self-start text-[0.84rem] font-semibold text-ink hover:text-muted">
            Your posts and pins
            <ArrowRight {...ICON} />
          </Link>
          <Switch
            checked={on}
            hint={on ? "People who can open your profile see this section." : "Hidden from everyone who opens your profile. Your posts stay on Junction."}
            onChange={(next) => {
              // Not disabled while saving, so focus stays on the switch; a second press waits.
              if (pending) return;
              setOn(next);
              if (!actions) return;
              start(async () => {
                const error = await actions.showPosts(next).catch(() => FAILED);
                if (error) {
                  setOn(!next);
                  setMessage(error);
                } else setMessage(next ? "Your Junction posts show on your profile." : "Your Junction posts no longer show on your profile.");
              });
            }}
          >
            Show Junction posts on my profile
          </Switch>
          <p role="status" className="text-[0.8rem] text-muted">
            {message}
          </p>
        </>
      )}
    </section>
  );
}
