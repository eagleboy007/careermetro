"use client";

import { Check, Undo2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { readApiReply } from "@/lib/api-reply";

/** FR-18: marks a path step done, or not done again. `title` names the step for screen readers; `demo` skips the network call. */
export function MarkDone({ stepId, title, done, demo = false }: { stepId: string; title: string; done: boolean; demo?: boolean }) {
  const router = useRouter();
  const [isDone, setDone] = useState(done);
  const [shownDone, setShownDone] = useState(done);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [pending, startTransition] = useTransition();

  // Take a newer value from the server after a refresh, for example a change made in another tab.
  if (done !== shownDone) {
    setShownDone(done);
    setDone(done);
  }

  async function toggle() {
    if (saving) return;
    const next = !isDone;
    setError(null);
    if (demo) return setDone(next);
    setSaving(true);
    try {
      const res = await fetch(`/api/path-steps/${stepId}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ done: next }),
      });
      const reply = await readApiReply(res);
      if (!reply.ok) return setError(reply.error ?? "Something went wrong. Please try again.");
      setDone(next);
      startTransition(() => router.refresh());
    } catch {
      setError("We couldn't reach CareerMetro. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  const label = isDone ? "Not done yet" : "Mark done";
  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        onClick={toggle}
        disabled={saving || pending}
        aria-label={isDone ? `Mark ${title} not done yet` : `Mark ${title} done`}
        className={`inline-flex w-fit items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-60 ${
          isDone ? "border-line text-muted hover:text-ink" : "border-accent text-accent hover:bg-accent-soft"
        }`}
      >
        {isDone ? <Undo2 size={14} strokeWidth={1.75} aria-hidden="true" /> : <Check size={14} strokeWidth={1.75} aria-hidden="true" />}
        {label}
      </button>
      {error && (
        <p role="alert" className="text-xs text-bad">
          {error}
        </p>
      )}
    </div>
  );
}
