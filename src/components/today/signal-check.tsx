"use client";

import { ArrowRight, Lightbulb } from "lucide-react";
import Link from "next/link";
import { StatusChip } from "@/components/ui/status-chip";
import type { SignalCheck } from "@/lib/schemas";

const STATUS_WORD = { missing: "Missing", weak: "Weak evidence" } as const;

/**
 * One question a day from the Practice bank. Answering ticks the day's last task. No score is shown.
 * Controlled: the parent holds the answer, so the ride's locked task and this card never disagree.
 * `answered` without `pickedKey` means it was answered earlier (only the right answer and explanation show).
 */
export function SignalCheckCard({
  check,
  answered,
  pickedKey,
  onAnswer,
  discussHref,
}: {
  check: SignalCheck;
  /** Junction, once it exists. Until then the footer says it is coming. */
  discussHref?: string;
  answered: boolean;
  pickedKey: string | null;
  onAnswer: (key: string) => void;
}) {
  function pick(key: string) {
    if (answered) return;
    onAnswer(key);
  }

  return (
    <section
      aria-label="Signal check"
      className="flex min-w-0 flex-col gap-3.5 rounded-[18px] border border-line bg-surface p-4 md:rounded-[20px] md:px-[22px] md:py-5"
    >
      <div className="flex flex-wrap items-center gap-2.5">
        <h3 className="text-[1.08rem] font-semibold">Signal check</h3>
        <span className="inline-flex">
          <StatusChip status={check.status} label={check.skillName} />
          <span className="sr-only">, {STATUS_WORD[check.status]}</span>
        </span>
        <span className="ml-auto font-mono text-[0.7rem] uppercase tracking-[0.06em] text-muted">1 question</span>
      </div>
      <p className="text-base font-medium leading-[1.45]">{check.question}</p>
      <div className="grid gap-2 sm:grid-cols-2" role="group" aria-label="Answers">
        {check.options.map((o) => {
          const right = answered && o.key === check.correctKey;
          return (
            <button
              key={o.key}
              type="button"
              aria-disabled={answered}
              onClick={() => pick(o.key)}
              className={`flex items-start gap-2.5 rounded-[14px] border-[1.5px] px-3.5 py-3 text-left text-[0.86rem] transition ${
                right ? "border-accent bg-accent-soft" : "border-line bg-bg"
              } ${answered && !right ? "opacity-55" : ""} ${answered ? "cursor-default" : "hover:-translate-y-px hover:border-ink"}`}
            >
              <span
                className={`grid size-[22px] shrink-0 place-items-center rounded-[6px] font-mono text-[0.7rem] ${right ? "bg-accent text-on-accent" : "bg-surface-2"}`}
              >
                {o.key}
              </span>
              <span className="flex min-w-0 flex-col gap-px break-words">
                {o.label}
                {o.detail && <small className="font-mono text-[0.68rem] text-muted">{o.detail}</small>}
                {(right || o.key === pickedKey) && (
                  <span className="sr-only">
                    {o.key === pickedKey ? ", your answer" : ""}
                    {right ? ", right answer" : ""}
                  </span>
                )}
              </span>
            </button>
          );
        })}
      </div>
      <div role="status">
        {answered && (
          <p className="flex items-start gap-2.5 rounded-[14px] bg-surface-2 px-3.5 py-3 text-[0.86rem]">
            <Lightbulb size={18} strokeWidth={1.75} className="mt-px shrink-0 text-accent" aria-hidden="true" />
            <span>
              {pickedKey === null ? "" : pickedKey === check.correctKey ? "Right. " : `Not quite: it's ${check.correctKey}. `}
              {check.explanation}
            </span>
          </p>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2.5 text-[0.78rem] text-muted">
        <span>{check.from}</span>
        {discussHref ? (
          <Link href={discussHref} className="ml-auto inline-flex items-center gap-1 text-[0.82rem] font-semibold hover:text-ink">
            Discuss on Junction
            <ArrowRight size={14} strokeWidth={1.75} aria-hidden="true" />
          </Link>
        ) : (
          <span className="ml-auto text-[0.82rem] font-semibold">Discuss on Junction · soon</span>
        )}
      </div>
    </section>
  );
}
