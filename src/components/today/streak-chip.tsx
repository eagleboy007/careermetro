"use client";

import { TrainFront } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { streakLabel } from "@/lib/today/logic";
import { useRide } from "./ride-state";

/**
 * "12-day streak", or "Day 1" before the first ticked task. Opens a popover saying what counts as a day.
 * `rideDays` is the stored count before today; ticking any task today adds today.
 */
export function StreakChip({ rideDays, rodeToday }: { rideDays: number; rodeToday: boolean }) {
  const { done } = useRide();
  const [open, setOpen] = useState(false);
  const popId = useId();
  const wrap = useRef<HTMLSpanElement>(null);
  const count = rideDays + (!rodeToday && done.size > 0 ? 1 : 0);
  const { number, text } = streakLabel(count);

  useEffect(() => {
    if (!open) return;
    function close(e: MouseEvent | KeyboardEvent) {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !wrap.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  return (
    <span ref={wrap} className="relative inline-flex">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls={popId}
        aria-label={`${count === 0 ? "Day 1" : `${count}-day streak`}, details`}
        className="inline-flex items-center gap-1.5 rounded-full bg-accent-soft px-3 py-1.5 text-[0.8rem] font-semibold text-ink"
      >
        <TrainFront size={16} strokeWidth={1.75} className="text-accent" aria-hidden="true" />
        <span className="font-mono font-medium">{number}</span>
        <span>{text}</span>
      </button>
      <div
        id={popId}
        hidden={!open}
        className="shadow-raised absolute right-0 top-full z-30 mt-2 w-72 rounded-md border border-line bg-surface p-4 text-sm"
      >
        <p className="font-semibold">What counts as a day</p>
        <p className="mt-1.5 text-muted">
          Tick any one task and that day is a ride. Miss a day and the count pauses. It never goes back to zero.
        </p>
      </div>
    </span>
  );
}
