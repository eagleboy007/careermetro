import { StatusChip } from "@/components/ui/status-chip";
import type { Gap } from "@/lib/schemas";

/**
 * One gap with its evidence (FR-12). `askedIn` ("Asked in 7 of 10 postings", src/lib/gaps/asked-in.ts) shows only
 * where the role was measured on real postings; without it the card says nothing about how common the skill is.
 */
export function GapCard({ gap, askedIn = null }: { gap: Gap; askedIn?: string | null }) {
  return (
    <article className="flex min-w-0 flex-col gap-2 rounded-md border border-line p-3.5 [overflow-wrap:anywhere]">
      <div className="flex items-center justify-between gap-2">
        <h3 className="min-w-0 font-sans text-[15px] font-semibold tracking-normal">{gap.skillName}</h3>
        <StatusChip status={gap.status} />
      </div>
      {askedIn && <p className="font-mono text-xs text-muted">{askedIn}</p>}
      <div className="grid gap-1 text-[13px] text-muted">
        {gap.resumeQuote ? (
          <>
            <span>Your resume:</span>
            <q className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-xs text-ink [quotes:none]">
              {gap.resumeQuote}
            </q>
          </>
        ) : (
          <span>Nothing in your resume shows this.</span>
        )}
        {/* Only proof fills a gap: a skill only listed, being learned or backed by a partial, undated or expired certificate stays a goal (Milin, 2026-10-11). */}
        {gap.status === "weak" && <span className="text-ink">Your resume doesn&apos;t show you using it in a job or project yet.</span>}
        <span>{gap.explanation}</span>
      </div>
    </article>
  );
}
