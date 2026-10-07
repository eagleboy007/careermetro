"use client";

import { Check } from "lucide-react";
import { useState } from "react";
import { readApiReply } from "@/lib/api-reply";

const LABELS = ["Not at all", "Mostly wrong", "Partly right", "Mostly right", "Spot on"];

/** "Are these gaps right?" on a 1 to 5 scale, the beta's accuracy measure. `demo` skips the network call. */
export function GapRating({ analysisId, initial, demo = false }: { analysisId: string; initial: number | null; demo?: boolean }) {
  const [rating, setRating] = useState<number | null>(initial);
  const [state, setState] = useState<{ kind: "idle" | "saving" | "saved" } | { kind: "error"; message: string }>({
    kind: initial ? "saved" : "idle",
  });

  async function rate(value: number) {
    setRating(value);
    setState({ kind: "saving" });
    if (demo) return setState({ kind: "saved" });
    try {
      const res = await fetch(`/api/gaps/${analysisId}/rating`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ rating: value }),
      });
      const reply = await readApiReply(res);
      setState(reply.ok ? { kind: "saved" } : { kind: "error", message: reply.error ?? "Something went wrong. Please try again." });
    } catch {
      setState({ kind: "error", message: "We couldn't reach CareerMetro. Check your connection and try again." });
    }
  }

  return (
    <fieldset className="m-0 flex min-w-0 flex-col gap-3 rounded-lg border border-line bg-surface p-4">
      <legend className="float-left mb-1 font-semibold">Are these gaps right?</legend>
      <div role="group" aria-label="Rate from 1, not at all, to 5, spot on" className="clear-left flex flex-wrap gap-2">
        {LABELS.map((label, i) => {
          const value = i + 1;
          const chosen = rating === value;
          return (
            <button
              key={value}
              type="button"
              aria-pressed={chosen}
              aria-label={`${value}: ${label}`}
              disabled={state.kind === "saving"}
              onClick={() => rate(value)}
              className={`h-10 w-10 rounded-full border font-mono text-sm transition-colors disabled:opacity-60 ${
                chosen ? "border-ink bg-ink text-bg" : "border-line hover:border-ink"
              }`}
            >
              {value}
            </button>
          );
        })}
      </div>
      <p className="text-xs text-muted">1 means not at all, 5 means spot on. Your answer helps us make the gaps more accurate.</p>
      {state.kind === "saved" && (
        <p role="status" className="flex items-center gap-1.5 text-sm">
          <Check size={16} strokeWidth={1.75} aria-hidden="true" />
          Thanks, saved. You can change it any time.
        </p>
      )}
      {state.kind === "error" && (
        <p role="alert" className="text-sm text-bad">
          {state.message}
        </p>
      )}
    </fieldset>
  );
}
