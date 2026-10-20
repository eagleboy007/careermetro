"use client";

import { Zap } from "lucide-react";
import { useState, useTransition } from "react";

/**
 * "Turn on Elite, free in the beta" on /elite (handoff 12l): Elite violet, never cobalt. Once on it reads "Elite is
 * on, free in the beta" and pressing it again turns Elite off, as in the prototype. While a change runs the button keeps
 * focus (aria-disabled, not disabled). Without an action (example data) nothing changes.
 */
export function TurnOnElite({ on, action }: { on: boolean; action?: (on: boolean) => Promise<string | null> }) {
  const [message, setMessage] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const press = () => {
    if (pending) return;
    if (!action) {
      setMessage("Example data: sign in to turn Elite on.");
      return;
    }
    const next = !on;
    start(async () => {
      const error = await action(next).catch(() => "That didn't work. Please try again.");
      setMessage(error ?? (next ? "Elite is on. Everything in Elite opens as it arrives, free in the beta." : "Elite is off. You are back on Free, and everything you made stays."));
    });
  };

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={press}
        aria-pressed={on}
        aria-disabled={pending || undefined}
        className="inline-flex min-h-11 items-center justify-center gap-2 self-start rounded-full bg-elite px-5 text-[0.9rem] font-[550] text-on-elite hover:opacity-90 aria-disabled:cursor-wait aria-disabled:opacity-70"
      >
        <Zap size={17} strokeWidth={1.75} aria-hidden="true" />
        {on ? "Elite is on, free in the beta" : "Turn on Elite, free in the beta"}
      </button>
      <p role="status" className="text-[0.8rem] text-muted">
        {message}
      </p>
    </div>
  );
}
