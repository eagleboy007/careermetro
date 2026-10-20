"use client";

import { Award } from "lucide-react";
import Link from "next/link";
import { useState, useTransition } from "react";
import { Switch } from "@/components/ui/switch";
import type { PlanView } from "@/lib/schemas";

/**
 * "Your plan" on the person's own profile (handoff 12l, prototype v41): only they see it, and it is hidden in View as
 * others. With Elite on: "Show the Elite badge on my profile", off by default. On Free: See Elite. Without an action
 * (example data) the switch changes nothing on the server.
 */
export function MePlanCard({ plan, onBadge }: { plan: PlanView; onBadge?: (shown: boolean) => Promise<string | null> }) {
  const [shown, setShown] = useState(plan.badgeShown);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, start] = useTransition();
  // A new plan from the server resets the switch.
  const [base, setBase] = useState(plan);
  if (base.elite !== plan.elite || base.badgeShown !== plan.badgeShown) {
    setBase(plan);
    setShown(plan.badgeShown);
  }

  const toggle = (next: boolean) => {
    if (pending) return;
    if (!onBadge) {
      setShown(next);
      return;
    }
    start(async () => {
      const error = await onBadge(next).catch(() => "That didn't work. Please try again.");
      if (error) setMessage(error);
      else {
        setShown(next);
        setMessage(next ? "Your Elite badge shows next to your name." : "Your Elite badge is hidden.");
      }
    });
  };

  return (
    <section
      aria-label="Your plan"
      className={`mt-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-3 rounded-md border px-4 py-3.5 ${plan.elite ? "border-elite bg-elite-soft shadow-[inset_0_0_0_1px_var(--elite)]" : "border-line bg-surface"}`}
    >
      <div className="flex min-w-[220px] flex-1 items-start gap-3">
        <span className={`grid size-[34px] shrink-0 place-items-center rounded-full ${plan.elite ? "bg-elite text-on-elite" : "bg-surface-2 text-ink"}`}>
          <Award size={16} strokeWidth={1.75} aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <b className="text-[0.92rem] font-semibold">{plan.elite ? "Elite is on, free in the beta" : "You're on Free"}</b>
          <small className="mt-0.5 block max-w-[60ch] text-[0.8rem] text-muted">
            {plan.elite
              ? "Everything in Elite is open until the beta ends, each part as it arrives. Only you see this card."
              : "Everything that gets you ready is free. Elite adds mock interviews, timed tests, the full question bank and the Elite shelf."}
          </small>
        </div>
      </div>
      <div className="flex flex-col gap-1">
        {plan.elite ? (
          <Switch checked={shown} onChange={toggle} tone="elite">
            Show the Elite badge on my profile
          </Switch>
        ) : (
          <Link href="/elite" className="inline-flex min-h-11 items-center gap-1.5 self-start rounded-full bg-elite px-3.5 text-[0.84rem] font-[550] text-on-elite hover:opacity-90">
            <Award size={15} strokeWidth={1.75} aria-hidden="true" />
            See Elite
          </Link>
        )}
        <p role="status" className="text-[0.76rem] text-muted">
          {message}
        </p>
      </div>
    </section>
  );
}
