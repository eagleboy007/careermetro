"use client";

import { Check, Undo2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { readApiReply } from "@/lib/api-reply";

/** FR-18: marks a path step done, or not done again. `demo` skips the network call. */
export function MarkDone({ stepId, done, demo = false }: { stepId: string; done: boolean; demo?: boolean }) {
  const router = useRouter();
  const [isDone, setDone] = useState(done);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  async function toggle() {
    const next = !isDone;
    setError(null);
    if (demo) return setDone(next);
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
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        onClick={toggle}
        disabled={pending}
        aria-pressed={isDone}
        className={`inline-flex w-fit items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-60 ${
          isDone ? "border-line text-muted hover:text-ink" : "border-accent text-accent hover:bg-accent-soft"
        }`}
      >
        {isDone ? <Undo2 size={14} strokeWidth={1.75} aria-hidden="true" /> : <Check size={14} strokeWidth={1.75} aria-hidden="true" />}
        {isDone ? "Not done yet" : "Mark done"}
      </button>
      {error && (
        <p role="alert" className="text-xs text-bad">
          {error}
        </p>
      )}
    </div>
  );
}
