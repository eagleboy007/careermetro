"use client";

import { ArrowRight, Check, Lightbulb } from "lucide-react";
import Link from "next/link";
import { useId, useState } from "react";
import { StatusChip } from "@/components/ui/status-chip";
import type { Goal, GoalStatus, GoalsSummary } from "@/lib/schemas";

const LAMP: Record<GoalStatus, { index: number; className: string; word: string }> = {
  missing: { index: 0, className: "bg-bad", word: "Missing" },
  weak: { index: 1, className: "bg-warn", word: "Weak" },
  met: { index: 2, className: "bg-good", word: "Met" },
};

/** Your goals: one goal per gap, with red, amber or green lamps. Tapping a goal shows its evidence and its pitstops. */
export function GoalsCard({ summary, mapHref }: { summary: GoalsSummary; mapHref?: string }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <section aria-label="Your goals" className="flex min-w-0 flex-col gap-3.5 rounded-lg border border-line bg-surface px-4 py-4 md:px-5.5 md:py-5">
      <div className="flex flex-wrap items-center gap-2.5">
        <h3 className="text-[1.08rem] font-semibold">Your goals</h3>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-line px-2.5 py-1 text-[0.78rem] font-medium">
          <span className="font-mono text-[0.66rem] uppercase tracking-[0.06em] text-muted">Track</span>
          {summary.track}
        </span>
        {mapHref && (
          <Link href={mapHref} className="ml-auto inline-flex items-center gap-1 text-[0.82rem] font-medium underline-offset-2 hover:underline">
            Open map
            <ArrowRight size={14} strokeWidth={1.75} aria-hidden="true" />
          </Link>
        )}
      </div>
      <ul className="flex flex-col gap-1.5">
        {summary.goals.map((g) => (
          <GoalRow key={g.id} goal={g} open={open === g.id} onToggle={() => setOpen(open === g.id ? null : g.id)} />
        ))}
      </ul>
      {summary.moreCount > 0 && (
        <p className="text-[0.84rem] text-muted">
          {summary.moreCount === 1 ? "1 more goal" : `${summary.moreCount} more goals`} after these, on your map.
        </p>
      )}
      {summary.metThisMonth.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-[0.8rem] text-muted">
          <span>Goals met with proof this month:</span>
          {summary.metThisMonth.map((name) => (
            <StatusChip key={name} status="met" label={name} />
          ))}
        </div>
      )}
    </section>
  );
}

function GoalRow({ goal, open, onToggle }: { goal: Goal; open: boolean; onToggle: () => void }) {
  const detailId = useId();
  const lamp = LAMP[goal.status];
  const count = goal.pitstops.length;
  return (
    <li className="overflow-hidden rounded-[14px] border border-line">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={detailId}
        onClick={onToggle}
        className="grid w-full grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-0.5 px-3.5 py-2.5 text-left text-[0.88rem]"
      >
        <span className="flex h-3.5 w-[30px] items-center justify-around rounded-full bg-surface-2 px-[3px]" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <i key={i} className={`size-1.5 rounded-full ${i === lamp.index ? lamp.className : "bg-line"}`} />
          ))}
        </span>
        <b className="font-medium">{goal.name}</b>
        <span className="col-start-2 font-mono text-[0.68rem] uppercase tracking-[0.05em] text-muted">
          {lamp.word}
          {count > 0 && ` · ${count} ${count === 1 ? "pitstop" : "pitstops"}`}
        </span>
      </button>
      {open && (
        <div id={detailId} className="flex flex-col gap-2 px-3.5 pb-3 text-[0.82rem] text-muted sm:pl-14">
          <p>{goal.evidence}</p>
          {goal.quote && (
            <p>
              From your resume: <q className="rounded-[4px] bg-surface-2 px-1.5 py-px font-mono text-[0.74rem] text-ink">{goal.quote}</q>
            </p>
          )}
          {count > 0 && (
            <ol className="flex flex-col gap-1">
              {goal.pitstops.map((p) => (
                <li key={p.number} className={`grid grid-cols-[22px_minmax(0,1fr)] items-center gap-x-2 ${p.state === "now" ? "font-semibold text-ink" : ""}`}>
                  <span
                    className={`row-span-2 grid size-[22px] place-items-center rounded-full font-mono text-[0.66rem] ${
                      p.state === "done" ? "bg-accent text-on-accent" : p.state === "now" ? "border-2 border-accent text-ink" : "border border-line"
                    }`}
                  >
                    {p.state === "done" ? (
                      <>
                        <Check size={12} strokeWidth={1.75} aria-hidden="true" />
                        <span className="sr-only">done</span>
                      </>
                    ) : (
                      p.number
                    )}
                  </span>
                  <span>{p.title}</span>
                  <small className="col-start-2 font-mono text-[0.68rem] font-normal">{p.state === "now" ? `you are here · ${p.note}` : p.note}</small>
                </li>
              ))}
            </ol>
          )}
          {goal.suggestion && (
            <p className="flex items-start gap-2 rounded-md bg-surface-2 px-3 py-2">
              <Lightbulb size={16} strokeWidth={1.75} className="mt-0.5 shrink-0 text-ink" aria-hidden="true" />
              <span>
                <b className="block font-semibold text-ink">{goal.suggestion.title}</b>
                {goal.suggestion.detail}
              </span>
            </p>
          )}
        </div>
      )}
    </li>
  );
}
