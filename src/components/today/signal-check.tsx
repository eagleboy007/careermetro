"use client";

import { Lightbulb } from "lucide-react";
import { useState } from "react";
import { StatusChip } from "@/components/ui/status-chip";
import type { SignalCheck } from "@/lib/schemas";

/** One question a day from the Practice bank. Answering ticks the day's last task. No score is shown. */
export function SignalCheckCard({ check, onAnswer }: { check: SignalCheck; onAnswer?: (key: string) => void }) {
  const [picked, setPicked] = useState<string | null>(null);
  const answered = picked !== null;

  function pick(key: string) {
    if (answered) return;
    setPicked(key);
    onAnswer?.(key);
  }

  return (
    <section aria-label="Signal check" className="flex min-w-0 flex-col gap-3.5 rounded-lg border border-line bg-surface px-4 py-4 md:px-5.5 md:py-5">
      <div className="flex flex-wrap items-center gap-2.5">
        <h3 className="text-[1.08rem] font-semibold">Signal check</h3>
        <StatusChip status={check.status} label={check.skillName} />
        <span className="ml-auto font-mono text-[0.7rem] uppercase tracking-[0.06em] text-muted">1 question</span>
      </div>
      <p className="text-[0.95rem] font-medium leading-snug">{check.question}</p>
      <div className="grid gap-2 sm:grid-cols-2" role="group" aria-label="Answers">
        {check.options.map((o) => {
          const right = answered && o.key === check.correctKey;
          return (
            <button
              key={o.key}
              type="button"
              disabled={answered}
              aria-pressed={o.key === picked}
              onClick={() => pick(o.key)}
              className={`flex items-start gap-2.5 rounded-[14px] border px-3.5 py-3 text-left text-[0.86rem] transition-colors ${
                right ? "border-ink bg-surface-2" : "border-line bg-bg"
              } ${answered && !right ? "opacity-60" : ""} ${answered ? "cursor-default" : "hover:border-ink"}`}
            >
              <span className="grid size-[22px] shrink-0 place-items-center rounded-[6px] bg-surface-2 font-mono text-[0.7rem]">{o.key}</span>
              <span className="flex min-w-0 flex-col gap-px break-words">
                {o.label}
                {o.detail && <small className="font-mono text-[0.68rem] text-muted">{o.detail}</small>}
                {right && <span className="sr-only">, right answer</span>}
              </span>
            </button>
          );
        })}
      </div>
      {answered && (
        <p role="status" className="flex items-start gap-2.5 rounded-[14px] bg-surface-2 px-3.5 py-3 text-[0.86rem]">
          <Lightbulb size={18} strokeWidth={1.75} className="mt-px shrink-0" aria-hidden="true" />
          <span>
            {picked === check.correctKey ? "Right. " : `Not quite: it's ${check.correctKey}. `}
            {check.explanation}
          </span>
        </p>
      )}
      <p className="text-[0.78rem] text-muted">{check.from}</p>
    </section>
  );
}
