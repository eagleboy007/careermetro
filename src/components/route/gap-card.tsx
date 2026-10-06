import { StatusChip } from "@/components/ui/status-chip";
import type { Gap } from "@/lib/schemas";

export function GapCard({ gap }: { gap: Gap }) {
  return (
    <article className="flex flex-col gap-2 rounded-md border border-line p-3.5">
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-sans text-[15px] font-semibold tracking-normal">{gap.skillName}</h3>
        <StatusChip status={gap.status} />
      </div>
      <div className="grid gap-1 text-[13px] text-muted">
        {gap.resumeQuote ? (
          <>
            <span>Your resume:</span>
            <q className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-xs text-ink [quotes:none]">
              {gap.resumeQuote}
            </q>
          </>
        ) : null}
        <span>{gap.explanation}</span>
      </div>
    </article>
  );
}
