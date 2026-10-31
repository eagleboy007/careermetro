"use client";

import { useRef, useState, useTransition } from "react";
import { Switch } from "@/components/ui/switch";

/** What the switch says under it, on /timetable and in Settings > Notifications alike. */
export const DIGEST_HINT =
  "Monday mornings, India time: up to 5 events in the next 7 days that match your goals or interests. Only on weeks when something matches. One tap to turn it off, in the email or here. Saved as soon as you switch it.";

/**
 * "Send me this week's events" (Timetable PR 5, docs/plans/timetable-plan.md section 5), the same switch on /timetable
 * and in Settings > Notifications. It saves at once, apart from Settings' Save button, as "Let people find me" does.
 * Without an action (example data and /design) it changes nothing.
 */
export function EventsDigestSwitch({ initial, action }: { initial: boolean; action?: (on: boolean) => Promise<string | null> }) {
  const [on, setOn] = useState(initial);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const statusRef = useRef<HTMLParagraphElement>(null);

  const toggle = (next: boolean) => {
    if (!action) return;
    start(async () => {
      const error = await action(next).catch(() => "That didn't work. Please try again.");
      if (error) setMessage(error);
      else {
        setOn(next);
        setMessage(next ? "On. The next one comes on Monday morning, if an event matches." : "Off. We won't send it.");
      }
      requestAnimationFrame(() => statusRef.current?.focus());
    });
  };

  return (
    <div className="flex min-w-0 flex-col" data-events-digest>
      <Switch checked={on} onChange={toggle} disabled={!action || pending} hint={DIGEST_HINT}>
        Send me this week&apos;s events
      </Switch>
      <p ref={statusRef} tabIndex={-1} role="status" className="text-[0.78rem] text-muted outline-none">
        {message}
      </p>
    </div>
  );
}
