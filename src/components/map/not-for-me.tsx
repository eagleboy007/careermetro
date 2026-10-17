"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, useTransition } from "react";
import { smallButton } from "@/components/gaps/job-check-actions";
import { readApiReply } from "@/lib/api-reply";
import type { MapGoal } from "@/lib/schemas";

type Change = { action: "skip" } | { action: "swap"; skillId: string } | { action: "restore" };

/** Sends one "Not for me" change for a goal. Answers null once it is saved, else the words to show. */
export async function changeGoal(goalId: string, change: Change, demo = false): Promise<string | null> {
  if (demo) return "This is example data, so nothing changes.";
  try {
    const reply = await readApiReply(
      await fetch(`/api/goals/${goalId}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(change) }),
    );
    return reply.ok ? null : (reply.error ?? "Something went wrong. Please try again.");
  } catch {
    return "We couldn't reach CareerMetro. Check your connection and try again.";
  }
}

/**
 * "Not for me" on a goal from a gap (handoff section 6, FR-48), at the foot of its pitstops on the Map. A required goal
 * can be skipped anyway: it stays a gap, the train passes it, and "Bring back" restores it. A "one of these" goal can
 * be swapped to another skill of its group, any of which fills it. Neither changes the match. After a change the page
 * refreshes and focus moves to this section's heading, never to the page. `demo` saves nothing (for /design).
 */
export function NotForMe({ goal, demo = false }: { goal: MapGoal; demo?: boolean }) {
  const router = useRouter();
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [refreshing, startRefresh] = useTransition();
  const heading = useRef<HTMLHeadingElement>(null);
  const headingId = useId();
  const moveFocus = useRef(false);
  useEffect(() => {
    if (refreshing || !moveFocus.current) return;
    heading.current?.focus();
    moveFocus.current = false;
  }, [refreshing]);

  const offer = goal.notForMe ?? null;
  if (goal.proved || (!goal.skipped && !offer)) return null;

  // Buttons stay focusable while a change is saving (aria-disabled, not disabled), so focus never drops to the page.
  async function send(change: Change, done: string) {
    if (sending || refreshing) return;
    setError("");
    setSending(true);
    const failed = await changeGoal(goal.goalId ?? "example", change, demo || !goal.goalId);
    setSending(false);
    if (failed) return setError(failed);
    moveFocus.current = true;
    setNote(done);
    startRefresh(() => router.refresh());
  }
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-2.5 rounded-[14px] border border-line p-3 text-[0.86rem]">
      <h4 ref={heading} id={headingId} tabIndex={-1} className="font-mono text-[0.72rem] uppercase tracking-[0.06em] text-muted focus:outline-2 focus:outline-offset-2 focus:outline-ink">
        {goal.skipped ? "Skipped" : "Not for me"}
      </h4>
      {goal.skipped ? (
        <>
          <p className="text-muted">You skipped {goal.name}. It stays a gap, so your match and the roles that need it don&apos;t change, and the train passes it.</p>
          <div className="flex">
            <button type="button" aria-disabled={sending || refreshing} onClick={() => send({ action: "restore" }, `${goal.name} is back on your goals.`)} className={`${smallButton} aria-disabled:opacity-60`}>
              {sending ? "Bringing back…" : "Bring back"}
            </button>
          </div>
        </>
      ) : offer?.kind === "swap" ? (
        <>
          <p className="text-muted">
            The role asks for any one of these. You&apos;re learning {offer.current}; learning another fills this goal just the same, so your match doesn&apos;t change.
          </p>
          <div className="flex flex-wrap gap-2">
            {offer.options.map((o) => (
              <button
                key={o.skillId}
                type="button"
                aria-disabled={sending || refreshing}
                onClick={() => send({ action: "swap", skillId: o.skillId }, `You're learning ${o.name} for this goal now.`)}
                className={`${smallButton} aria-disabled:opacity-60`}
              >
                Learn {o.name} instead
              </button>
            ))}
          </div>
        </>
      ) : (
        <>
          {offer?.share && <p className="text-muted">{offer.share}</p>}
          <p className="text-muted">The role needs it. If you skip it, it stays a gap, so roles that need it stay amber. You can bring it back any time.</p>
          <div className="flex">
            <button type="button" aria-disabled={sending || refreshing} onClick={() => send({ action: "skip" }, `${goal.name} skipped. It stays a gap.`)} className={`${smallButton} aria-disabled:opacity-60`}>
              {sending ? "Skipping…" : "Skip anyway"}
            </button>
          </div>
        </>
      )}
      {error && (
        <p role="alert" className="text-xs text-bad">
          {error}
        </p>
      )}
      <p role="status" aria-live="polite" className="sr-only">
        {note}
      </p>
    </section>
  );
}
