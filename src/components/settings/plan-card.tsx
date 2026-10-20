"use client";

import { Award, Check, Eye, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { Switch } from "@/components/ui/switch";
import type { PlanView } from "@/lib/schemas";

const ICON = { size: 16, strokeWidth: 1.75, "aria-hidden": true } as const;
const FAILED = "That didn't work. Please try again.";

/**
 * What Elite adds, for Free (prototype v44, gap list item 39), each something built today. Prototype lines not built yet
 * are left out: the practice round before a company's AI interview on Arrivals (companies have no AI interview yet)
 * and interview prep per role from Express apply ("soon" on Departures). The prototype's prices and payment are C4,
 * not in the beta.
 */
export const ELITE_ADDS = [
  "AI mock interviews for your target role, with written feedback",
  "The full question bank for your role, with what a strong answer covers",
  "Timed mock tests with a review of every question",
  "No daily cap on Practice",
  "Elite shelf in the Library",
  "Elite badge on your profile",
] as const;

export type PlanActions = {
  /** "Turn off" here (false); /elite turns it on. */
  switchElite: (on: boolean) => Promise<string | null>;
  switchBadge: (shown: boolean) => Promise<string | null>;
};

/**
 * Account settings > Your plan (handoff 12l, prototype v44): with Elite on, "Elite, free in the beta", the badge switch
 * and Turn off; on Free, "You're on Free" with See Elite. Nothing can be bought: there is no billing in the beta. Without
 * actions (example data) nothing changes.
 */
export function PlanCard({ plan, actions }: { plan: PlanView; actions?: PlanActions }) {
  const [badge, setBadge] = useState(plan.badgeShown);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const status = useRef<HTMLParagraphElement>(null);
  // Turn off removes its own button, so focus moves to the line that says what happened (after a press only).
  const [focusTick, setFocusTick] = useState(0);
  useEffect(() => {
    if (focusTick) status.current?.focus();
  }, [focusTick]);
  // A new plan from the server (after Turn off, or a change elsewhere) resets the switch.
  const [base, setBase] = useState(plan);
  if (base.elite !== plan.elite || base.badgeShown !== plan.badgeShown) {
    setBase(plan);
    setBadge(plan.badgeShown);
  }

  const toggleBadge = (next: boolean) => {
    if (!actions || pending) return;
    // The switch moves at once and goes back if the save fails.
    setBadge(next);
    start(async () => {
      const error = await actions.switchBadge(next).catch(() => FAILED);
      if (error) {
        setBadge(!next);
        setMessage(error);
      } else setMessage(next ? "Your Elite badge shows next to your name." : "Your Elite badge is hidden.");
    });
  };
  const turnOff = () => {
    if (pending) return;
    if (!actions) return setMessage("Example data: nothing changes here.");
    start(async () => {
      const error = await actions.switchElite(false).catch(() => FAILED);
      setMessage(error ?? "Elite is off. You are back on Free, and everything you made stays.");
      if (!error) setFocusTick((n) => n + 1);
    });
  };

  return (
    <div className="flex flex-col gap-3">
      {plan.elite ? (
        <ul className="flex flex-col divide-y divide-line overflow-hidden rounded-[14px] border border-line">
          <Row icon={<Award {...ICON} />} title="Elite, free in the beta" detail={`On since ${plan.since}. Everything in Elite is open until the beta ends. We tell you at least 30 days before, and nothing is charged unless you choose a plan.`} />
          <Row
            icon={<Eye {...ICON} />}
            title="Elite badge on your profile"
            detail="Off unless you turn it on. It never ranks you anywhere."
            action={
              <Switch checked={badge} onChange={toggleBadge} disabled={!actions} tone="elite">
                <span className="sr-only">Show the Elite badge on my profile</span>
              </Switch>
            }
          />
          <Row
            icon={<X {...ICON} />}
            title="Turn off Elite"
            detail="Back to Free at once. Everything you made stays."
            action={
              <button
                type="button"
                onClick={turnOff}
                aria-disabled={pending || undefined}
                className="inline-flex min-h-11 items-center rounded-full border border-line-strong bg-surface px-3.5 text-[0.8rem] font-medium text-ink hover:bg-surface-2 aria-disabled:opacity-60"
              >
                Turn off
              </button>
            }
          />
        </ul>
      ) : (
        <>
          <p className="text-[0.88rem] text-muted">
            Everything you use today stays free: your gaps, path, daily rides, Library free shelf, Departures and the Inbox. Elite adds interview
            practice and expert content on top, free during the beta.
          </p>
          <ul className="flex flex-col overflow-hidden rounded-[14px] border border-line">
            <Row
              icon={<Award {...ICON} />}
              title="You're on Free"
              detail="Elite adds mock interviews, timed tests, the full question bank, no daily cap on Practice and the Elite shelf. No card needed."
              action={
                <Link href="/elite" className="inline-flex min-h-11 items-center gap-1.5 rounded-full bg-elite px-3.5 text-[0.8rem] font-medium text-on-elite hover:opacity-90">
                  <Award size={14} strokeWidth={1.75} aria-hidden="true" />
                  See Elite
                </Link>
              }
            />
          </ul>
          <div className="flex flex-col gap-2 rounded-[14px] border border-line p-3.5">
            <span className="inline-flex items-center gap-1.5 self-start rounded-full bg-elite-soft px-2.5 py-0.5 text-[0.78rem] font-semibold text-elite">
              <Award size={14} strokeWidth={1.75} aria-hidden="true" />
              Elite
            </span>
            <ul aria-label="What Elite adds" className="flex flex-col gap-1.5 text-[0.86rem]">
              {ELITE_ADDS.map((line) => (
                <li key={line} className="flex items-start gap-2">
                  <Check size={15} strokeWidth={1.75} aria-hidden="true" className="mt-0.5 shrink-0 text-elite" />
                  {line}
                </li>
              ))}
            </ul>
          </div>
          <p className="text-[0.78rem] text-muted">Mentor sessions are separate from Elite. They aren&apos;t open yet.</p>
        </>
      )}
      <p ref={status} tabIndex={-1} role="status" className="text-[0.78rem] text-muted outline-none">
        {message}
      </p>
    </div>
  );
}

function Row({ icon, title, detail, action }: { icon: ReactNode; title: string; detail: string; action?: ReactNode }) {
  return (
    <li className="grid grid-cols-[30px_minmax(0,1fr)] items-center gap-3 px-3.5 py-3 min-[760px]:grid-cols-[34px_minmax(0,1fr)_auto]">
      <span className="grid size-[30px] place-items-center rounded-[10px] bg-elite-soft text-elite min-[760px]:size-[34px]">{icon}</span>
      <div className="min-w-0">
        <b className="text-[0.9rem] font-semibold">{title}</b>
        <small className="block text-[0.78rem] text-muted">{detail}</small>
      </div>
      {action && <div className="col-start-2 justify-self-start min-[760px]:col-start-3">{action}</div>}
    </li>
  );
}
