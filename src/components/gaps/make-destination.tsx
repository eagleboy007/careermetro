"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";

/**
 * "Make this your destination?" at the foot of a role's Gaps page (handoff section 7, C25, Project manager approved on
 * Milin's behalf, 2026-10-31; docs/plans/change-destination-plan.md). Opening a Gaps page, from Match or anywhere else,
 * never switches the destination: only the button does. When the role is already the destination (`choosable` false),
 * the card says so instead and has no button. `onChoose` is the server action; without it (example data on /design)
 * nothing is saved.
 */
export function MakeDestination({
  analysisId,
  roleTitle,
  currentTitle,
  choosable,
  onChoose,
}: {
  analysisId: string;
  roleTitle: string;
  /** The person's destination now, or null when it can't be named. */
  currentTitle: string | null;
  choosable: boolean;
  onChoose?: (input: { analysisId: string }) => Promise<string | null>;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const id = useId();
  // One status line from the first render, so the success words are announced (T178); after the save's refresh the
  // button is gone, so focus moves here instead of falling to the page.
  const statusRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (done && !choosable) statusRef.current?.focus();
  }, [done, choosable]);
  const status = (
    <p ref={statusRef} tabIndex={-1} role="status" className="text-sm outline-none empty:hidden">
      {done && !choosable && (
        <>
          {roleTitle} is now your destination.{" "}
          <Link href="/map" className="font-medium text-ink underline underline-offset-2">
            Open your Map
          </Link>
        </>
      )}
    </p>
  );

  if (!choosable) {
    return (
      <section aria-labelledby={id} className="flex flex-col items-start gap-2 rounded-lg border border-line bg-surface p-4">
        <h2 id={id} className="font-sans text-lg font-semibold tracking-normal">
          {roleTitle} is your destination
        </h2>
        <p className="text-sm text-muted">Today, your goals and your Map follow it.</p>
        {status}
      </section>
    );
  }

  const press = () => {
    if (pending) return;
    setError("");
    if (!onChoose) {
      setError("This is example data, so nothing is saved.");
      return;
    }
    start(async () => {
      const words = await onChoose({ analysisId });
      if (words) setError(words);
      else setDone(true);
    });
  };

  return (
    <section aria-labelledby={id} className="flex flex-col items-start gap-3 rounded-lg border border-line bg-surface p-4">
      <h2 id={id} className="font-sans text-lg font-semibold tracking-normal">
        Make this your destination?
      </h2>
      <p className="text-sm text-muted">
        {roleTitle} becomes your next destination{currentTitle ? ` in place of ${currentTitle}` : ""}, and Today, your goals and your Map follow it. Your
        current line becomes an earlier line on the Map, and nothing you proved is lost.
      </p>
      <Button type="button" busy={pending} onClick={press}>
        Make this my destination
      </Button>
      <p className="text-xs text-muted">Looking from Match never switches on its own.</p>
      {error && (
        <p role="alert" className="text-sm">
          {error}
        </p>
      )}
      {status}
    </section>
  );
}
