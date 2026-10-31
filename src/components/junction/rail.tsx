"use client";

import { ArrowRight, Shield } from "lucide-react";
import Link from "next/link";
import { useId } from "react";
import { InterestsEditor, useToast } from "@/components/me/me-editors";
import type { RailActions } from "@/lib/junction/types";
import { card, ICON, label } from "./styles";

export type RailProps = {
  yours: { posts: number; upvotes: number; reshares: number };
  interests: string[];
  routeTags: { id: string; name: string; count: number }[];
  routeLabel: string | null;
};

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * The rail beside the feed (plan section 4, JunctionRail): Your posts with their upvotes and reshares; Your interests,
 * which edits the same rows as Me through the same store and caps; On your route this week, the most used interest tags
 * on route posts; and the house rules with the way to the Grievances page.
 */
export function JunctionRail({ data, actions }: { data: RailProps; actions?: RailActions }) {
  const [toast, say] = useToast();
  const id = useId();
  return (
    <aside aria-label="Junction" className="flex min-w-0 flex-col gap-3">
      <section aria-labelledby={`${id}-yours`} className={card}>
        <h2 id={`${id}-yours`} className="text-[1rem] font-semibold">
          Your posts
        </h2>
        <p className="text-[0.86rem]">
          {plural(data.yours.posts, "post", "posts")} · {plural(data.yours.upvotes, "upvote", "upvotes")} · {plural(data.yours.reshares, "reshare", "reshares")}
        </p>
        <Link href="/junction/mine" className="inline-flex min-h-11 items-center gap-1 self-start text-[0.84rem] font-semibold text-ink hover:text-muted">
          See your posts, saved posts and notices
          <ArrowRight {...ICON} />
        </Link>
      </section>
      <section aria-labelledby={`${id}-interests`} className={card}>
        <h2 id={`${id}-interests`} className="text-[1rem] font-semibold">
          Your interests
        </h2>
        <p className="text-[0.78rem] text-muted">The same list as on your profile. My interests shows posts tagged with them.</p>
        <InterestsEditor interests={data.interests} onAdd={actions?.addInterest} onRemove={actions?.removeInterest} say={say} />
      </section>
      {data.routeLabel && (
        <section aria-labelledby={`${id}-route`} className={card}>
          <h2 id={`${id}-route`} className="text-[1rem] font-semibold">
            On your route this week
          </h2>
          <p className={label}>{data.routeLabel}</p>
          {data.routeTags.length ? (
            <ul className="flex flex-col">
              {data.routeTags.map((t) => (
                <li key={t.id}>
                  <Link href={`/junction?feed=interests&interest=${t.id}`} className="flex min-h-11 items-center justify-between gap-2 text-[0.86rem] hover:underline">
                    <span className="min-w-0 break-words">{t.name}</span>
                    <span className="text-muted">{plural(t.count, "post", "posts")}</span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[0.84rem] text-muted">No tagged posts on your route this week yet.</p>
          )}
        </section>
      )}
      <section aria-labelledby={`${id}-rules`} className={card}>
        <h2 id={`${id}-rules`} className="flex items-center gap-2 text-[1rem] font-semibold">
          <Shield {...ICON} />
          House rules
        </h2>
        <p className="text-[0.84rem]">Be kind, keep people&rsquo;s details out, and share only what you know is true. No money or OTP requests, no spam.</p>
        <p className="text-[0.8rem] text-muted">
          Reports are acknowledged at once and acted on within the times on the{" "}
          <Link href="/grievances" className="font-semibold text-ink underline underline-offset-2">
            Grievances page
          </Link>
          .
        </p>
      </section>
      {toast}
    </aside>
  );
}
