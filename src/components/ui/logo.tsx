export function Logo({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2.5 font-display text-lg font-semibold tracking-tight ${className}`}>
      <svg viewBox="0 0 34 18" width="34" height="18" aria-hidden="true" className="text-ink">
        <path d="M5 13h10l6-8h8" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="5" cy="13" r="3.5" fill="var(--bg)" stroke="currentColor" strokeWidth="2.5" />
        <circle cx="29" cy="5" r="3.5" fill="var(--accent)" stroke="var(--accent)" strokeWidth="2.5" />
      </svg>
      careermetro
    </span>
  );
}
