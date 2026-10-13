"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useTransition } from "react";

/**
 * The place panel's heading, with "Show all of India" beside it for a state or city. That link goes away once India
 * shows, so instead of dropping keyboard focus to the page it moves focus to this heading when the new figures are in.
 * The heading also takes focus from "Skip the map".
 */
export function PanelHeading({ id, title, backHref }: { id: string; title: string; backHref: string | null }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const heading = useRef<HTMLHeadingElement>(null);
  const focusAfter = useRef(false);
  useEffect(() => {
    if (pending || !focusAfter.current) return;
    focusAfter.current = false;
    heading.current?.focus();
  }, [pending]);
  return (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
      <h3 id={id} ref={heading} tabIndex={-1} className="text-[1.05rem] font-semibold tracking-[-0.01em]">
        {title}
      </h3>
      {backHref && (
        <a
          href={backHref}
          aria-busy={pending || undefined}
          onClick={(e) => {
            // A new tab or window keeps the browser's own behaviour.
            if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
            e.preventDefault();
            focusAfter.current = true;
            start(() => router.push(backHref, { scroll: false }));
          }}
          className="ml-auto inline-flex min-h-11 items-center text-[0.82rem] font-[550] text-muted underline-offset-2 hover:text-ink hover:underline"
        >
          Show all of India
        </a>
      )}
    </div>
  );
}
