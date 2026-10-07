/** How often public job postings for a role mention a skill. Neutral colors: this is market data, not progress or a gap. */
export function PostingShareBar({ share }: { share: number | null }) {
  if (share === null) {
    return <span className="font-mono text-xs text-muted">Not measured</span>;
  }
  const percent = Math.round(share * 100);
  return (
    <div className="flex items-center gap-3">
      <div
        className="h-1.5 min-w-[80px] flex-1 overflow-hidden rounded-full bg-surface-2"
        role="img"
        aria-label={`Asked for in ${percent}% of postings`}
      >
        <span className="block h-full rounded-full bg-muted" style={{ width: `${percent}%` }} />
      </div>
      <span className="w-10 text-right font-mono text-xs tabular-nums text-muted">{percent}%</span>
    </div>
  );
}
