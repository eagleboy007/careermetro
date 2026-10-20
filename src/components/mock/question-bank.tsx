"use client";

import { ArrowRight, Lock } from "lucide-react";
import Link from "next/link";
import { useId, useState } from "react";
import type { MockBankView } from "@/lib/schemas";
import { MOCK_BANK_FREE_OPEN } from "@/lib/schemas/constants";

const ICON = { strokeWidth: 1.75, "aria-hidden": true } as const;
const LABEL = "font-mono text-[0.7rem] uppercase tracking-[0.06em] text-muted";
const PILL = "inline-flex min-h-11 items-center rounded-full border border-line-strong bg-surface px-3.5 text-[0.84rem] font-[550] text-ink hover:border-ink aria-pressed:border-ink aria-pressed:bg-ink aria-pressed:text-bg";

/**
 * The question bank tab of /mock (handoff 12l, prototype v44): a role's questions by topic, each opening "A strong
 * answer covers" and "Practise this one". On Free, 5 are open and the rest show locked, with nothing of their note
 * sent to the browser. The questions are content, never written by AI.
 */
export function QuestionBank({ bank, elite, roleTitle }: { bank: MockBankView; elite: boolean; roleTitle: string }) {
  const id = useId();
  const [topic, setTopic] = useState<string | null>(null);
  const shown = bank.items.filter((q) => topic === null || q.topic === topic);
  const locked = bank.items.filter((q) => !q.open).length;

  return (
    <section aria-labelledby={`${id}-h`} className="flex min-w-0 flex-col gap-3.5 rounded-lg border border-line bg-surface px-[18px] py-4">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 id={`${id}-h`} className="mr-auto font-sans text-[1.05rem] font-semibold">
          Question bank
        </h2>
        <span className={LABEL}>{roleTitle}</span>
      </div>
      {!elite && locked > 0 && (
        <p className="text-[0.84rem] text-muted">
          {MOCK_BANK_FREE_OPEN} questions are open on Free. Elite opens all {bank.items.length}, free during the beta.
        </p>
      )}
      {bank.items.length === 0 ? (
        <p className="text-[0.86rem] text-muted">No questions for this role yet. The bank grows skill by skill.</p>
      ) : (
        <>
          <div role="group" aria-label="Topic" className="flex flex-wrap gap-2">
            <button type="button" aria-pressed={topic === null} onClick={() => setTopic(null)} className={PILL}>
              All
            </button>
            {bank.topics.map((t) => (
              <button key={t} type="button" aria-pressed={topic === t} onClick={() => setTopic(t)} className={PILL}>
                {t}
              </button>
            ))}
          </div>
          <ul className="flex flex-col">
            {shown.map((q) => (
              <li key={q.id} data-bank-item={q.open ? "open" : "locked"} className="border-t border-line first:border-t-0">
                <details className="group">
                  <summary className="flex min-h-11 cursor-pointer list-none flex-wrap items-baseline gap-x-3 gap-y-1 py-3 [&::-webkit-details-marker]:hidden">
                    <span className={`${LABEL} min-w-[120px]`}>{q.topic}</span>
                    <b className={`min-w-[200px] flex-1 text-[0.92rem] font-[550] ${q.open ? "text-ink" : "text-muted"}`}>{q.question}</b>
                    {!q.open && (
                      <span className="inline-flex items-center gap-1 text-[0.74rem] text-muted">
                        <Lock size={14} {...ICON} />
                        Elite
                      </span>
                    )}
                  </summary>
                  {q.open ? (
                    <div className="flex flex-col items-start gap-1.5 pb-3.5 text-[0.86rem]">
                      <span className={LABEL}>A strong answer covers</span>
                      <p className="max-w-[70ch] text-muted">{q.strongCovers}</p>
                      <Link href={q.practiceHref} className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-line-strong bg-surface px-3.5 text-[0.84rem] font-[550] text-ink hover:bg-surface-2">
                        Practise this one
                        <ArrowRight size={15} {...ICON} />
                      </Link>
                    </div>
                  ) : (
                    <p className="pb-3.5 text-[0.84rem] text-muted">What a strong answer covers opens with Elite, free during the beta.</p>
                  )}
                </details>
              </li>
            ))}
          </ul>
        </>
      )}
      <p className="text-[0.78rem] text-muted">Questions come from CareerMetro&apos;s practice bank, not from AI. Practice gets you ready; only proof fills a goal.</p>
    </section>
  );
}
