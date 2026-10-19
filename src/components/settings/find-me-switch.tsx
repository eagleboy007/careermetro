"use client";

import { useRef, useState, useTransition } from "react";
import { Switch } from "@/components/ui/switch";

/**
 * "Let people find me" in Settings > Privacy, the same switch as the bar on /network (handoff 12j). It saves at once,
 * apart from the Save button, because Network turns it on and off the same way. Without an action (example data) it is off.
 */
export function FindMeSwitch({ initial, action }: { initial: boolean; action?: (on: boolean) => Promise<string | null> }) {
  const [on, setOn] = useState(initial);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const statusRef = useRef<HTMLParagraphElement>(null);

  const toggle = (next: boolean) => {
    if (!action) return;
    start(async () => {
      const error = await action(next);
      if (error) setMessage(error);
      else {
        setOn(next);
        setMessage(next ? "People can now find you by name." : "You are out of name search. Your connections still see you.");
      }
      requestAnimationFrame(() => statusRef.current?.focus());
    });
  };

  return (
    <fieldset className="flex min-w-0 flex-col" disabled={!action || pending} data-find-me>
      <legend className="mb-1 text-[0.82rem] font-semibold">Network</legend>
      <Switch
        checked={on}
        onChange={toggle}
        disabled={!action || pending}
        hint="Signed-in people can find you by name or @handle on Network. Your connections can always find you. Never people you blocked. Off by default; saved as soon as you switch it."
      >
        Let people find me
      </Switch>
      <p ref={statusRef} tabIndex={-1} role="status" className="text-[0.78rem] text-muted outline-none">
        {message}
      </p>
    </fieldset>
  );
}
