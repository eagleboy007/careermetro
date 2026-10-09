"use client";

import { Lightbulb } from "lucide-react";
import { useState } from "react";
import type { SignalCheck } from "@/lib/schemas/today";
import { LampChip } from "./lamp-chip";
import { useRide } from "./ride-state";

/** One question a day from the Practice bank. Answering ticks the day's last task. No score is shown. */
export function SignalCheckCard({ check }: { check: SignalCheck }) {
  const { answerSignalCheck } = useRide();
  const [picked, setPicked] = useState<string | null>(null);
  const answered = picked !== null;

  function pick(key: string) {
    if (answered) return;
    setPicked(key);
    answerSignalCheck();
  }

  return (
    <section aria-label="Signal check" className="flex min-w-0 flex-col gap-3.5 rounded-lg border border-line bg-surface px-[22px] py-5">
      <div className="flex flex-wrap items-center gap-2.5">
        <h3 className="text-[1.08rem] font-semibold">Signal check</h3>
        <LampChip status={check.status} label={check.skillName} />
        <span className="ml-auto font-mono text-[0.72rem] uppercase tracking-wider text-muted">1 question</span>
      </div>
      <p className="text-base font-medium leading-[1.45]">{check.question}</p>
      <div className="grid gap-2 sm:grid-cols-2">
        {check.options.map((o) => {
          const right = answered && o.key === check.correctKey;
          const wrong = answered && o.key === picked && !right;
          return (
            <button
              key={o.key}
              type="button"
              disabled={answered}
              aria-pressed={o.key === picked}
              onClick={() => pick(o.key)}
              className={`flex items-start gap-2.5 rounded-[14px] border-[1.5px] px-3.5 py-3 text-left text-[0.86rem] transition ${
                right ? "border-accent bg-accent-soft" : "border-line bg-bg"
              } ${wrong || (answered && !right) ? "opacity-55" : ""} ${answered ? "cursor-default" : "hover:-translate-y-px hover:border-ink"}`}
            >
              <span
                className={`grid size-[22px] shrink-0 place-items-center rounded-[6px] font-mono text-[0.7rem] ${
                  right ? "bg-accent text-on-accent" : "bg-surface-2"
                }`}
              >
                {o.key}
              </span>
              <span className="flex flex-col gap-px">
                {o.label}
                {o.detail && <small className="font-mono text-[0.68rem] text-muted">{o.detail}</small>}
              </span>
            </button>
          );
        })}
      </div>
      {answered && (
        <div role="status" className="flex animate-[cm-pop_.35s_ease] items-start gap-2.5 rounded-[14px] bg-surface-2 px-3.5 py-3 text-[0.86rem]">
          <Lightbulb size={18} strokeWidth={1.75} className="mt-px shrink-0 text-accent" aria-hidden="true" />
          <span>
            {picked === check.correctKey ? "Right. " : `Close, but it is ${check.correctKey}. `}
            {check.explanation}
          </span>
        </div>
      )}
      <p className="text-[0.78rem] text-muted">{check.from}</p>
    </section>
  );
}
