/** Share of a team that meets a skill (Phase 3 team view; shared with the personal app). */
export function SkillCoverageBar({ met, total }: { met: number; total: number }) {
  const share = total === 0 ? 0 : met / total;
  return (
    <div className="flex items-center gap-3">
      <div className="h-2 min-w-[120px] flex-1 overflow-hidden rounded-full bg-surface-2" role="img" aria-label={`${met} of ${total} people`}>
        <span className={`block h-full rounded-full ${share < 0.5 ? "bg-warn" : "bg-accent"}`} style={{ width: `${share * 100}%` }} />
      </div>
      <span className="w-14 whitespace-nowrap text-right font-mono text-xs tabular-nums">
        {met} / {total}
      </span>
    </div>
  );
}
