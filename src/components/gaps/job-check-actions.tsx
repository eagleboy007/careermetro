"use client";

import { Check, Plus } from "lucide-react";
import Link from "next/link";
import { useEffect, useId, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { readApiReply } from "@/lib/api-reply";

const small =
  "inline-flex min-h-9 items-center gap-1.5 whitespace-nowrap rounded-full border border-line bg-surface px-3 py-1 text-[0.8rem] font-semibold text-ink hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-60";

/**
 * Where a skill of a job check's "Only for this job" group stands for this visitor: `add` shows "Add as my goal",
 * `on` says it is already on their goals, `sign-in` asks an anonymous visitor to sign in first.
 */
export type GoalState = "add" | "on" | "sign-in";

/**
 * "Add as my goal" for one "Only for this job" skill: adds it as a "Your choice" goal tagged with the job. It never
 * changes the match. `demo` saves nothing (for /design).
 */
export function AddGoal({
  checkId,
  skillId,
  skillName,
  state,
  signInHref,
  demo = false,
}: {
  checkId: string;
  skillId: string;
  skillName: string;
  state: GoalState;
  signInHref: string;
  demo?: boolean;
}) {
  const router = useRouter();
  const [sending, setSending] = useState(false);
  const [added, setAdded] = useState(false);
  const [error, setError] = useState("");
  const [, startRefresh] = useTransition();
  const done = useRef<HTMLSpanElement>(null);
  // Once added, the button is gone: focus moves to the words that replace it, so it never drops to the page.
  useEffect(() => {
    if (added) done.current?.focus();
  }, [added]);

  if (state === "sign-in") {
    return (
      <Link href={signInHref} className="whitespace-nowrap text-[0.8rem] font-semibold text-ink underline underline-offset-2">
        Sign in to keep goals
      </Link>
    );
  }
  if (state === "on" || added) {
    return (
      <span ref={done} tabIndex={-1} role="status" className="inline-flex items-center gap-1.5 whitespace-nowrap text-[0.8rem] font-semibold text-muted focus:outline-none">
        <Check size={14} strokeWidth={1.75} aria-hidden="true" />
        {added && error ? error : "On your goals"}
      </span>
    );
  }

  async function add() {
    setError("");
    if (demo) {
      setError("This is example data, so nothing is saved.");
      return;
    }
    setSending(true);
    try {
      const res = await fetch(`/api/job-checks/${checkId}/goals`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ skillId }),
      });
      const reply = await readApiReply(res);
      if (reply.ok || reply.reason === "already") {
        // "Already on your goals" reads the same as a fresh add once the page refreshes.
        setError(reply.ok ? "" : String(reply.error));
        setAdded(true);
        startRefresh(() => router.refresh());
        return;
      }
      setError(reply.error ?? "Something went wrong. Please try again.");
    } catch {
      setError("We couldn't reach CareerMetro. Check your connection and try again.");
    } finally {
      setSending(false);
    }
  }

  return (
    <span className="flex flex-col items-end gap-1">
      <button type="button" onClick={add} disabled={sending} aria-label={`Add as my goal: ${skillName}`} className={small}>
        <Plus size={14} strokeWidth={1.75} aria-hidden="true" />
        {sending ? "Adding…" : "Add as my goal"}
      </button>
      {error && (
        <span role="alert" className="text-right text-xs text-bad">
          {error}
        </span>
      )}
    </span>
  );
}

/**
 * "Remove this check", with a confirm step. Goals added from the check stay and only lose its tag. `demo` saves
 * nothing (for /design).
 */
export function RemoveCheck({ checkId, label, demo = false }: { checkId: string; label: string; demo?: boolean }) {
  const router = useRouter();
  const ids = useId();
  const [confirming, setConfirming] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [refreshing, startRefresh] = useTransition();
  const opener = useRef<HTMLButtonElement>(null);
  const confirmBox = useRef<HTMLDivElement>(null);
  const opened = useRef(false);
  useEffect(() => {
    if (confirming) confirmBox.current?.querySelector<HTMLElement>("button")?.focus();
    else if (opened.current) opener.current?.focus();
    opened.current = confirming;
  }, [confirming]);

  async function remove() {
    setError("");
    if (demo) {
      setError("This is example data, so nothing is removed.");
      return;
    }
    setSending(true);
    try {
      const reply = await readApiReply(await fetch(`/api/job-checks/${checkId}`, { method: "DELETE" }));
      if (!reply.ok) {
        setError(reply.error ?? "Something went wrong. Please try again.");
        return;
      }
      startRefresh(() => router.refresh());
    } catch {
      setError("We couldn't reach CareerMetro. Check your connection and try again.");
    } finally {
      setSending(false);
    }
  }

  if (!confirming) {
    return (
      <button ref={opener} type="button" onClick={() => setConfirming(true)} aria-label={`Remove this check: ${label}`} className={small}>
        Remove this check
      </button>
    );
  }
  const busy = sending || refreshing;
  return (
    <div ref={confirmBox} role="group" aria-labelledby={`${ids}-q`} className="flex flex-col gap-2 rounded-md border border-line bg-bg p-3 text-sm">
      <p id={`${ids}-q`}>Remove this check? Goals you added from it stay on your goals.</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={remove} disabled={busy} className={small}>
          {busy ? "Removing…" : "Yes, remove it"}
        </button>
        <button type="button" onClick={() => setConfirming(false)} disabled={busy} className={small}>
          Keep it
        </button>
      </div>
      {error && (
        <p role="alert" className="text-xs text-bad">
          {error}
        </p>
      )}
    </div>
  );
}
