"use client";

import { TrainFront } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { streakLabel } from "@/lib/today/board";

/** The ride streak in the top bar. A day counts once one task is ticked; a missed day pauses the count, never resets it. */
export function StreakChip({ days, todayCounted }: { days: number; todayCounted: boolean }) {
  const [open, setOpen] = useState(false);
  const popId = useId();
  const wrap = useRef<HTMLSpanElement>(null);
  const button = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      button.current?.focus();
    };
    document.addEventListener("click", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("click", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const heading = days === 0 ? "Your streak starts today" : `Your streak: ${days} ${days === 1 ? "day" : "days"} in a row`;
  const today =
    days === 0
      ? "Finish one task today to start it."
      : todayCounted
        ? "Today is counted."
        : `Today is not counted yet. Finish one task and it goes to ${days + 1}.`;

  return (
    <span ref={wrap} className="relative inline-flex">
      <button
        ref={button}
        type="button"
        aria-expanded={open}
        aria-controls={popId}
        aria-label={`${streakLabel(days)}. Show details`}
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-accent-soft px-3 py-1.5 text-[0.8rem] font-semibold text-ink"
      >
        <TrainFront size={16} strokeWidth={1.75} className="text-accent" aria-hidden="true" />
        {days === 0 ? (
          "Day 1"
        ) : (
          <span>
            <span className="font-mono font-medium">{days}</span>-day streak
          </span>
        )}
      </button>
      <div
        id={popId}
        hidden={!open}
        className="shadow-raised absolute right-0 top-[calc(100%+8px)] z-30 flex w-[min(280px,calc(100vw-32px))] flex-col gap-1.5 rounded-md border border-line bg-surface px-4 py-3.5 text-[0.84rem] leading-snug"
      >
        <b className="font-display text-[0.98rem]">{heading}</b>
        <p>A day counts when you finish at least one task from that day&apos;s ride.</p>
        <p>{today}</p>
        <p className="text-muted">Miss a day and it pauses. It never drops back to zero.</p>
      </div>
    </span>
  );
}
