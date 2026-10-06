import type { GapAnalysis } from "@/lib/schemas";

/** Readiness in words, never a bare score (FR-13). */
export function ReadinessCard({ readiness }: { readiness: GapAnalysis["readiness"] }) {
  return (
    <div className="flex flex-col gap-1 rounded-md bg-accent-soft px-4 py-3.5">
      <p className="font-display text-[17px] font-semibold tracking-tight">{readiness.headline}</p>
      <p className="text-sm">{readiness.explanation}</p>
    </div>
  );
}
