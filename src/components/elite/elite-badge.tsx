/**
 * The Elite badge next to a name (handoff 12l): says the person has Elite, nothing about who they are or what they
 * know, so it never ranks anyone. Shown only when its owner turned it on. Elite violet, never cobalt or gold.
 */
export function EliteBadge({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center rounded-full bg-elite px-[9px] py-[3px] align-middle font-mono text-[0.66rem] font-medium uppercase tracking-[0.06em] text-on-elite ${className}`}>
      Elite
    </span>
  );
}
