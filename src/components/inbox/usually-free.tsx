"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { freeSlot, sortFree, usuallyFreeSummary } from "@/lib/account/availability";
import { FREE_DAY_LABELS, FREE_DAYS, SLOT_TIMES } from "@/lib/schemas/constants";

const btn = "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full border px-[11px] py-1.5 text-[0.8rem] font-[550]";
const ghost = `${btn} min-h-11 border-line bg-surface text-ink hover:bg-surface-2 aria-disabled:cursor-not-allowed aria-disabled:opacity-60`;

const FULL_DAY: Record<(typeof FREE_DAYS)[number], string> = { mon: "Monday", tue: "Tuesday", wed: "Wednesday", thu: "Thursday", fri: "Friday" };

const same = (a: readonly string[], b: readonly string[]) => sortFree(a).join("|") === sortFree(b).join("|");

/**
 * "Usually free" in the Inbox's availability panel (FR-55, v44 gap item 31): Monday to Friday by the eight picker
 * times, one row per day with time chips (the panel is narrow beside the chat). Each chip is a toggle; Save sends the
 * whole grid at once. The summary above is what is saved, worked out in code. Private: companies never see it. Without
 * `save` (the example on /design) nothing is saved.
 */
export function UsuallyFree({ initial, save }: { initial: string[]; save?: (slots: string[]) => Promise<string | null> }) {
  const [picked, setPicked] = useState<string[]>(initial);
  // A save refreshes the page, which passes the saved hours down: start again from them.
  const [base, setBase] = useState(initial);
  if (!same(base, initial)) {
    setBase(initial);
    setPicked(initial);
  }
  const [pending, start] = useTransition();
  const [said, setSaid] = useState<{ text: string; n: number } | null>(null);
  const status = useRef<HTMLParagraphElement>(null);
  const dirty = !same(picked, initial);
  useEffect(() => {
    if (said) status.current?.focus();
  }, [said]);
  const toggle = (slot: string) => setPicked((p) => (p.includes(slot) ? p.filter((s) => s !== slot) : [...p, slot]));
  const say = (text: string) => setSaid((s) => ({ text, n: (s?.n ?? 0) + 1 }));
  const onSave = () => {
    // Save stays focusable while saving (aria-disabled, not disabled), so focus never drops to the page.
    if (pending) return;
    if (!save) return say("Example. Nothing is saved.");
    const slots = sortFree(picked);
    start(async () => {
      const error = await save(slots);
      say(error ?? "Saved. Ask for times now pre-ticks these hours.");
    });
  };

  return (
    <div className="flex flex-col gap-2">
      <dl className="flex flex-col">
        <div className="flex justify-between gap-2.5 border-t border-line py-2 text-[0.84rem]">
          <dt>Usually free</dt>
          <dd data-usually-free-summary className="text-right text-muted">
            {usuallyFreeSummary(sortFree(initial))}
          </dd>
        </div>
      </dl>
      <div role="group" aria-label="Usually free hours" className="flex flex-col gap-1.5">
        {FREE_DAYS.map((day) => (
          <div key={day} role="group" aria-label={FULL_DAY[day]} className="flex flex-wrap items-center gap-1">
            <span aria-hidden="true" className="w-9 shrink-0 font-mono text-[0.72rem] text-muted">
              {FREE_DAY_LABELS[day]}
            </span>
            {SLOT_TIMES.map((time) => {
              const slot = freeSlot(day, time);
              return (
                <button
                  key={slot}
                  type="button"
                  aria-pressed={picked.includes(slot)}
                  onClick={() => toggle(slot)}
                  className="min-h-11 min-w-11 rounded-[7px] border border-line bg-surface px-1 font-mono text-[0.7rem] text-muted aria-pressed:border-ink aria-pressed:bg-ink aria-pressed:text-surface"
                >
                  <span className="sr-only">{FREE_DAY_LABELS[day]} </span>
                  {time}
                </button>
              );
            })}
          </div>
        ))}
      </div>
      <p className="text-[0.78rem] text-muted">
        Private. Companies never see it. It only pre-ticks open times when a company asks for times; you still pick and send.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={`${ghost} self-start`} aria-disabled={pending || !dirty || undefined} onClick={() => dirty && onSave()}>
          {pending ? "Saving…" : "Save"}
        </button>
        <p ref={status} tabIndex={-1} role="status" className="text-[0.78rem] text-muted empty:hidden">
          {said?.text ?? ""}
        </p>
      </div>
    </div>
  );
}
