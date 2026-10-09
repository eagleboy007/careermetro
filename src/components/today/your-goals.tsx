"use client";

import { ArrowRight, Check, ChevronDown, Lightbulb, Plus } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import type { Goal, TodayView } from "@/lib/schemas/today";
import { LAMP_WORD } from "@/lib/today/logic";
import { Lamp } from "./lamp";
import { LampChip } from "./lamp-chip";

type Props = Pick<TodayView, "goals" | "track" | "moreGoals" | "goalsMetThisMonth" | "suggestedGoal"> & { showExtras: boolean };

/**
 * Your goals (handoff 5 and 6): one goal per gap, each with its lamps, the resume line it came from and its pitstops
 * in order. Adding a suggestion is local for now; it is saved once goals live in the database (handoff PR 5).
 */
export function YourGoals({ goals, track, moreGoals, goalsMetThisMonth, suggestedGoal, showExtras }: Props) {
  const [added, setAdded] = useState<ReadonlySet<string>>(new Set());
  const add = (key: string) => setAdded((prev) => new Set(prev).add(key));

  return (
    <section aria-label="Your goals" className="flex min-w-0 flex-col gap-3.5 rounded-lg border border-line bg-surface px-[22px] py-5">
      <div className="flex flex-wrap items-center gap-2.5">
        <h3 className="text-[1.08rem] font-semibold">Your goals</h3>
        {track && (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-line px-2.5 py-1 text-[0.78rem]">
            <span className="font-mono text-[0.66rem] uppercase tracking-wider text-muted">Track</span>
            {track}
          </span>
        )}
        <Link href="/map" className="ml-auto inline-flex items-center gap-1 text-[0.84rem] font-medium text-muted hover:text-ink">
          Open map
          <ArrowRight size={16} strokeWidth={1.75} aria-hidden="true" />
        </Link>
      </div>

      <ul className="flex flex-col gap-1.5">
        {goals.map((g) => (
          <GoalRow key={g.id} goal={g} added={added.has(g.id)} onAdd={() => add(g.id)} />
        ))}
      </ul>

      {showExtras && moreGoals.length > 0 && (
        <p className="text-[0.84rem] text-muted">
          {moreGoals.length} more {moreGoals.length === 1 ? "goal" : "goals"} after these: {moreGoals.join(" and ").toLowerCase()}.{" "}
          <Link href="/map" className="font-medium text-ink underline underline-offset-2">
            See all on the map
          </Link>
        </p>
      )}

      {showExtras && suggestedGoal && (
        <div className="flex flex-wrap items-start gap-2.5 rounded-[14px] bg-surface-2 px-3.5 py-3 text-[0.84rem]">
          <Lightbulb size={18} strokeWidth={1.75} className="mt-px shrink-0 text-muted" aria-hidden="true" />
          <span className="min-w-0 flex-1">
            <b className="block font-semibold">Suggested goal: {suggestedGoal.skillName}</b>
            <span className="text-muted">{suggestedGoal.why}</span>
          </span>
          <AddButton done={added.has("suggested-goal")} onClick={() => add("suggested-goal")} label="Add goal" />
        </div>
      )}

      {showExtras && goalsMetThisMonth.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-[0.8rem] text-muted">
          <span>Goals met with proof this month:</span>
          {goalsMetThisMonth.map((name) => (
            <LampChip key={name} status="met" label={name} />
          ))}
        </div>
      )}
    </section>
  );
}

function GoalRow({ goal, added, onAdd }: { goal: Goal; added: boolean; onAdd: () => void }) {
  const count = goal.pitstops.length;
  return (
    <li>
      <details className="group overflow-hidden rounded-[14px] border border-line">
        <summary className="grid cursor-pointer list-none grid-cols-[auto_minmax(0,1fr)_auto_auto] items-center gap-3 px-3.5 py-[11px] text-[0.88rem] [&::-webkit-details-marker]:hidden">
          <Lamp status={goal.status} />
          <b className="font-medium">{goal.skillName}</b>
          <span className="font-mono text-[0.68rem] uppercase tracking-wider text-muted">
            {LAMP_WORD[goal.status]} · {count} {count === 1 ? "pitstop" : "pitstops"}
          </span>
          <ChevronDown size={16} strokeWidth={1.75} className="text-muted transition-transform group-open:rotate-180" aria-hidden="true" />
        </summary>
        <div className="flex flex-col gap-2 px-3.5 pb-3 text-[0.82rem] text-muted sm:pl-14">
          <p>
            {goal.resumeQuote && (
              <>
                You wrote <q className="rounded-[4px] bg-surface-2 px-1.5 py-px font-mono text-[0.74rem] text-ink [quotes:none]">{goal.resumeQuote}</q>.{" "}
              </>
            )}
            {goal.evidence}
          </p>
          <ol className="flex flex-col gap-1">
            {goal.pitstops.map((p) => (
              <li key={p.number} className={`flex items-center gap-2 ${p.state === "now" ? "font-medium text-ink" : ""}`}>
                <span
                  className={`grid size-5 shrink-0 place-items-center rounded-full font-mono text-[0.64rem] ${
                    p.state === "done" ? "bg-accent text-on-accent" : p.state === "now" ? "border-2 border-accent" : "border border-line"
                  }`}
                >
                  {p.state === "done" ? <Check size={12} strokeWidth={1.75} aria-hidden="true" /> : p.number}
                </span>
                <span className="min-w-0 flex-1">{p.label}</span>
                {p.note && <small className="font-mono text-[0.68rem]">{p.state === "now" ? `you are here · ${p.note}` : p.note}</small>}
              </li>
            ))}
          </ol>
          {goal.suggestedPitstop && (
            <div className="flex flex-wrap items-start gap-2 rounded-[12px] bg-surface-2 px-3 py-2.5">
              <Lightbulb size={16} strokeWidth={1.75} className="mt-px shrink-0" aria-hidden="true" />
              <span className="min-w-0 flex-1">
                <b className="block font-semibold text-ink">Suggested pitstop: {goal.suggestedPitstop.title}</b>
                {goal.suggestedPitstop.why}
              </span>
              <AddButton done={added} onClick={onAdd} label="Add" />
            </div>
          )}
        </div>
      </details>
    </li>
  );
}

function AddButton({ done, onClick, label }: { done: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={done}
      className="inline-flex items-center gap-1.5 rounded-full border border-line px-3 py-1.5 text-xs font-medium text-ink hover:bg-surface disabled:text-muted"
    >
      {done ? <Check size={14} strokeWidth={1.75} aria-hidden="true" /> : <Plus size={14} strokeWidth={1.75} aria-hidden="true" />}
      {done ? "Added" : label}
    </button>
  );
}
