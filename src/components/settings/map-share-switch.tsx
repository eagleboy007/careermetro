"use client";

import { useRef, useState, useTransition } from "react";
import { Switch } from "@/components/ui/switch";

export type MapShareAction = (on: boolean) => Promise<string | null>;

const FAILED = "That didn't work. Please try again.";
export const MAP_SHARE_LABEL = "Show my pitstop on the map";
export const MAP_SHARE_HINT =
  "Signed-in people on the same goal see you only as part of a count, never below 3. Your connections see your name. Companies never see it.";
export const mapShareStatus = (on: boolean) => (on ? "You now show on the map." : "You are off the map. Nobody sees your pitstop.");

/**
 * "Show my pitstop on the map" (On your line, C13, docs/plans/on-your-line-plan.md): one switch, off by default, in
 * Settings > Privacy (`legend`) and Me's "Who sees what" rail. Saved as soon as it moves, apart from the Save button,
 * like "Let people find me"; both copies read the same column, and the save refreshes the page. The status line takes
 * focus after a change. Without an action (example data) it moves here only and nothing is saved.
 */
export function MapShareSwitch({ initial, action, legend = false }: { initial: boolean; action?: MapShareAction; legend?: boolean }) {
  const [on, setOn] = useState(initial);
  // A new value from the server (after the save's refresh, or a change in another tab) resets the switch.
  const [base, setBase] = useState(initial);
  if (base !== initial) {
    setBase(initial);
    setOn(initial);
  }
  const [message, setMessage] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const statusRef = useRef<HTMLParagraphElement>(null);

  const toggle = (next: boolean) => {
    if (pending || next === on) return;
    if (!action) {
      setOn(next);
      setMessage(`${mapShareStatus(next)} Example data: nothing is saved.`);
      requestAnimationFrame(() => statusRef.current?.focus());
      return;
    }
    start(async () => {
      const error = await action(next).catch(() => FAILED);
      if (error) setMessage(error);
      else {
        setOn(next);
        setMessage(mapShareStatus(next));
      }
      requestAnimationFrame(() => statusRef.current?.focus());
    });
  };

  return (
    <fieldset className="flex min-w-0 flex-col" disabled={pending} data-map-share>
      {legend && <legend className="mb-1 text-[0.82rem] font-semibold">On your line</legend>}
      <Switch checked={on} onChange={toggle} disabled={pending} hint={legend ? `${MAP_SHARE_HINT} Off by default; saved as soon as you switch it.` : "Only a count of 3 or more, or your name to connections."}>
        {MAP_SHARE_LABEL}
      </Switch>
      <p ref={statusRef} tabIndex={-1} role="status" className="text-[0.78rem] text-muted outline-none">
        {message}
      </p>
    </fieldset>
  );
}
