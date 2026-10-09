"use client";

import { ArrowRight, Check, ChevronRight, Lightbulb, Plus } from "lucide-react";
import Link from "next/link";
import { useId, useState } from "react";
import { StatusChip } from "@/components/ui/status-chip";
import type { Goal, GoalStatus, GoalsSummary } from "@/lib/schemas";

const LAMP: Record<GoalStatus, { index: number; className: string; glow: string; word: string }> = {
  missing: { index: 0, className: "bg-bad", glow: "shadow-[0_0_6px_var(--color-bad)]", word: "Missing" },
  weak: { index: 1, className: "bg-warn", glow: "shadow-[0_0_6px_var(--color-warn)]", word: "Weak" },
  met: { index: 2, className: "bg-good", glow: "shadow-[0_0_6px_var(--color-good)]", word: "Met" },
};

/** Your goals: one goal per gap, with red, amber or green lamps. Tapping a goal shows its evidence and its pitstops. */
export function GoalsCard({ summary, mapHref }: { summary: GoalsSummary; mapHref?: string }) {
  const [open, setOpen] = useState<string | null>(null);
  const [added, setAdded] = useState(false);
  const more = summary.moreCount === 1 ? "1 more goal" : `${summary.moreCount} more goals`;
  return (
    <section
      aria-label="Your goals"
      className="flex min-w-0 flex-col gap-3.5 rounded-[18px] border border-line bg-surface p-4 md:rounded-[20px] md:px-[22px] md:py-5"
    >
      <div className="flex flex-wrap items-center gap-2.5">
        <h3 className="text-[1.08rem] font-semibold tracking-[-0.01em]">Your goals</h3>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface-2 px-2.5 py-1 text-[0.8rem]">
          <span className="font-mono text-[0.62rem] uppercase tracking-[0.06em] text-muted">Track</span>
          {summary.track}
          <ChevronRight size={14} strokeWidth={1.75} aria-hidden="true" />
        </span>
        {mapHref ? (
          <Link href={mapHref} className="ml-auto inline-flex items-center gap-1 text-[0.82rem] font-semibold text-muted hover:text-ink">
            Open map
            <ArrowRight size={14} strokeWidth={1.75} aria-hidden="true" />
          </Link>
        ) : (
          <span className="ml-auto text-[0.82rem] font-semibold text-muted">Map · soon</span>
        )}
      </div>
      <ul className="flex flex-col gap-1.5">
        {summary.goals.map((g) => (
          <GoalRow key={g.id} goal={g} open={open === g.id} onToggle={() => setOpen(open === g.id ? null : g.id)} />
        ))}
      </ul>
      {summary.moreCount > 0 && (
        <p className="mt-1 text-[0.8rem] text-muted">
          {more} after these{summary.moreNames.length > 0 ? `: ${joinNames(summary.moreNames)}.` : "."}{" "}
          {mapHref ? (
            <Link href={mapHref} className="font-semibold text-ink hover:underline">
              See all on the map
            </Link>
          ) : (
            <span className="font-semibold">See all on the map, soon.</span>
          )}
        </p>
      )}
      {summary.suggestedGoal && (
        <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-3 rounded-[14px] border border-dashed border-line px-3.5 py-3 sm:grid-cols-[auto_minmax(0,1fr)_auto]">
          <Lightbulb size={18} strokeWidth={1.75} className="text-muted" aria-hidden="true" />
          <span className="flex flex-col gap-0.5 text-[0.82rem] text-muted">
            <b className="text-[0.9rem] font-semibold text-ink">Suggested goal: {summary.suggestedGoal.name}</b>
            {summary.suggestedGoal.reason}
          </span>
          <button
            type="button"
            aria-pressed={added}
            onClick={() => setAdded((a) => !a)}
            className="col-start-2 inline-flex items-center gap-1.5 justify-self-start whitespace-nowrap rounded-full border border-line bg-surface px-[11px] py-1.5 text-[0.8rem] font-semibold sm:col-start-3"
          >
            {added ? <Check size={16} strokeWidth={1.75} aria-hidden="true" /> : <Plus size={16} strokeWidth={1.75} aria-hidden="true" />}
            {added ? "Added" : "Add goal"}
          </button>
        </div>
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

function joinNames(names: string[]): string {
  return names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
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
        className="grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-3.5 py-[11px] text-left text-[0.88rem]"
      >
        <span className="flex h-3.5 w-[30px] items-center justify-around rounded-full bg-surface-2 px-[3px]" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <i key={i} className={`size-1.5 rounded-full ${i === lamp.index ? `${lamp.className} ${lamp.glow}` : "bg-line"}`} />
          ))}
        </span>
        <b className="min-w-0 truncate font-medium">{goal.name}</b>
        <span className="whitespace-nowrap font-mono text-[0.68rem] uppercase tracking-[0.05em] text-muted">
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
