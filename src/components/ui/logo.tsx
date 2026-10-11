/*
 * The CareerMetro logo, Option A (brand/, chosen by Milin 2026-10-11): one metro line with an open ring at the start,
 * level while learning, a 45° climb on proof, and the cobalt stop for the next role. To change the logo, replace the
 * mark below and the files in brand/, then run `npm run brand` for the favicon, home-screen icon and link preview.
 */

/** The mark alone. It follows the theme: ink line, page-coloured ring, accent stop. */
export function BrandMark({ size = 22, className = "" }: { size?: number; className?: string }) {
  return (
    <svg viewBox="2 10 45 27" width={(size * 45) / 27} height={size} aria-hidden="true" className={`text-ink ${className}`}>
      <path d="M8 31H18L32 17H40" fill="none" stroke="currentColor" strokeWidth="4.4" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="8" cy="31" r="4.8" fill="var(--bg)" stroke="currentColor" strokeWidth="4.4" />
      <circle cx="40" cy="17" r="6.6" fill="var(--accent)" />
    </svg>
  );
}

/** Mark and wordmark: "careermetro", lowercase, Bricolage Grotesque Bold. */
export function Logo({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 font-display text-lg font-bold tracking-tight ${className}`}>
      <BrandMark />
      careermetro
    </span>
  );
}
