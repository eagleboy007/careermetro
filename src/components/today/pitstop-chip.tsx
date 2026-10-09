"use client";

import { Info, Route } from "lucide-react";
import { useId, useState } from "react";

/** "Pitstop 4 of 11", with a popover that explains goals, pitstops and proof in plain words. */
export function PitstopChip({ number, total }: { number: number; total: number }) {
  const [open, setOpen] = useState(false);
  const popId = useId();
  return (
    <span className="relative inline-flex">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        onBlur={(e) => {
          if (!e.currentTarget.parentElement?.contains(e.relatedTarget as Node | null)) setOpen(false);
        }}
        aria-expanded={open}
        aria-controls={popId}
        className="inline-flex items-center gap-1.5 rounded-full bg-accent-soft px-3 py-1.5 text-[0.8rem] font-semibold text-ink"
      >
        <Route size={16} strokeWidth={1.75} className="text-accent" aria-hidden="true" />
        Pitstop {number} of {total}
        <Info size={16} strokeWidth={1.75} className="text-muted" aria-hidden="true" />
      </button>
      <div
        id={popId}
        hidden={!open}
        tabIndex={-1}
        className="shadow-raised absolute left-0 top-full z-30 mt-2 flex w-80 flex-col gap-2 rounded-md border border-line bg-surface p-4 text-sm"
      >
        <p className="font-semibold">Goals and pitstops</p>
        <p className="text-muted">
          Each goal is one gap between you and your destination. The app suggests the pitstops for each goal, usually two:{" "}
          <b className="text-ink">learn</b> (a free course, with daily tasks like videos, reading and practice) and{" "}
          <b className="text-ink">prove</b>.
        </p>
        <p className="text-muted">
          Only the prove pitstop fills the gap: a skill check, a certification, or work experience backed by a course or certificate.
          Then the goal is met and your train moves to the next one.
        </p>
        <p className="text-muted">Your destination is your next role, not your last. Reach it and you pick the next one.</p>
      </div>
    </span>
  );
}
