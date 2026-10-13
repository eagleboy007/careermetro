"use client";

import { Check, Plus } from "lucide-react";
import Link from "next/link";
import { useEffect, useId, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { readApiReply } from "@/lib/api-reply";

/** A small action button. 44 px tall, the smallest tap target the app uses. */
export const smallButton =
  "inline-flex min-h-11 items-center gap-1.5 whitespace-nowrap rounded-full border border-line bg-surface px-3 py-1 text-[0.8rem] font-semibold text-ink hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-60";

/**
 * Where a skill of a job check's "Only for this job" group stands for this visitor: `add` shows "Add as my goal",
 * `on` says it is already on their goals, `sign-in` asks an anonymous visitor to sign in first.
 */
export type GoalState = "add" | "on" | "sign-in";

/**
 * Removes one of the person's own "Your choice" goals (the server refuses gap goals). Answers null once it is gone,
 * else the words to show. `demo` saves nothing (for /design).
 */
export async function removeGoal(goalId: string, demo = false): Promise<string | null> {
  if (demo) return "This is example data, so nothing is removed.";
  try {
    const reply = await readApiReply(await fetch(`/api/goals/${goalId}`, { method: "DELETE" }));
    return reply.ok ? null : (reply.error ?? "Something went wrong. Please try again.");
  } catch {
    return "We couldn't reach CareerMetro. Check your connection and try again.";
  }
}

/**
 * "Remove from my goals" for one "Your choice" goal, with its error under it. Calls `onRemoved` once the goal is
 * gone; the caller moves focus and refreshes.
 */
export function RemoveGoal({ goalId, name, onRemoved, demo = false }: { goalId: string; name: string; onRemoved: () => void; demo?: boolean }) {
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  async function remove() {
    setError("");
    setSending(true);
    const failed = await removeGoal(goalId, demo);
    setSending(false);
    if (failed) setError(failed);
    else onRemoved();
  }
  return (
    <span className="flex flex-col items-end gap-1">
      <button type="button" onClick={remove} disabled={sending} aria-label={`Remove from my goals: ${name}`} className={smallButton}>
        {sending ? "Removing…" : "Remove from my goals"}
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
 * "Add as my goal" for one "Only for this job" skill: adds it as a "Your choice" goal tagged with the job. Once it is
 * on the goals, "Remove from my goals" takes a "Your choice" goal off again (`goalId`); a goal from a gap only says
 * "On your goals". Neither changes the match. `demo` saves nothing (for /design).
 */
export function AddGoal({
  checkId,
  skillId,
  skillName,
  state,
  goalId = null,
  signInHref,
  demo = false,
}: {
  checkId: string;
  skillId: string;
  skillName: string;
  state: GoalState;
  /** The person's own "Your choice" goal for this skill, which they may remove. */
  goalId?: string | null;
  signInHref: string;
  demo?: boolean;
}) {
  const router = useRouter();
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  // What this visit changed, until the refreshed page says the same: null follows the page.
  const [local, setLocal] = useState<{ state: "add" | "on"; goalId: string | null } | null>(null);
  const [, startRefresh] = useTransition();
  const done = useRef<HTMLSpanElement>(null);
  const addButton = useRef<HTMLButtonElement>(null);
  const moved = useRef<"added" | "removed" | null>(null);
  const now = local ?? { state, goalId };
  // The button pressed is replaced, so focus moves to what replaces it and never drops to the page.
  useEffect(() => {
    if (moved.current === "added") done.current?.focus();
    if (moved.current === "removed") addButton.current?.focus();
    moved.current = null;
  }, [local]);

  if (now.state === "sign-in") {
    return (
      <Link href={signInHref} className="inline-flex min-h-11 items-center whitespace-nowrap text-[0.8rem] font-semibold text-ink underline underline-offset-2">
        Sign in to keep goals
      </Link>
    );
  }
  if (now.state === "on") {
    return (
      <span className="flex flex-wrap items-center justify-end gap-2">
        <span ref={done} tabIndex={-1} role="status" className="inline-flex items-center gap-1.5 whitespace-nowrap text-[0.8rem] font-semibold text-muted focus:outline-none">
          <Check size={14} strokeWidth={1.75} aria-hidden="true" />
          {note || "On your goals"}
        </span>
        {now.goalId && (
          <RemoveGoal
            goalId={now.goalId}
            name={skillName}
            demo={demo}
            onRemoved={() => {
              moved.current = "removed";
              setNote("");
              setLocal({ state: "add", goalId: null });
              startRefresh(() => router.refresh());
            }}
          />
        )}
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
        setNote(reply.ok ? "" : String(reply.error));
        moved.current = "added";
        setLocal({ state: "on", goalId: typeof reply.goalId === "string" ? reply.goalId : null });
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
      <button ref={addButton} type="button" onClick={add} disabled={sending} aria-label={`Add as my goal: ${skillName}`} className={smallButton}>
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
 * "Remove this check", with a confirm step. Goals added from the check stay and only lose its tag. Once it is gone,
 * `onRemoved` (when given) refreshes the list and moves focus (the button goes with the check). `demo` saves nothing (for /design).
 */
export function RemoveCheck({ checkId, label, onRemoved, demo = false }: { checkId: string; label: string; onRemoved?: () => void; demo?: boolean }) {
  const router = useRouter();
  const ids = useId();
  const [confirming, setConfirming] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
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
      // Without a list to look after focus (a check shown on its own), refresh the page.
      if (onRemoved) onRemoved();
      else router.refresh();
    } catch {
      setError("We couldn't reach CareerMetro. Check your connection and try again.");
    } finally {
      setSending(false);
    }
  }

  if (!confirming) {
    return (
      <button ref={opener} type="button" onClick={() => setConfirming(true)} aria-label={`Remove this check: ${label}`} className={smallButton}>
        Remove this check
      </button>
    );
  }
  return (
    <div ref={confirmBox} role="group" aria-labelledby={`${ids}-q`} className="flex flex-col gap-2 rounded-md border border-line bg-bg p-3 text-sm">
      <p id={`${ids}-q`}>Remove this check? Goals you added from it stay on your goals.</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={remove} disabled={sending} className={smallButton}>
          {sending ? "Removing…" : "Yes, remove it"}
        </button>
        <button type="button" onClick={() => setConfirming(false)} disabled={sending} className={smallButton}>
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
