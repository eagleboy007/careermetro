import { PRACTICE_CONFIDENCE_WORDS } from "@/lib/schemas/constants";

/** "Not yet" for 1 up to "Very" for 4. */
export const confidenceWord = (rating: number) => PRACTICE_CONFIDENCE_WORDS[rating - 1] ?? "";

export const sessionsText = (n: number) => `${n} ${n === 1 ? "session" : "sessions"}`;

/**
 * A small line of the person's own ratings, oldest to newest, 1 (Not yet) at the bottom and 4 (Very) at the top. Ink
 * only: it is the person's own word, not progress and not a gap status, so it is never cobalt, red, amber or green.
 */
export function ConfidenceSpark({ ratings, width = 220, height = 28, className = "" }: { ratings: number[]; width?: number; height?: number; className?: string }) {
  if (ratings.length === 0) return null;
  const pad = 4;
  const x = (i: number) => (ratings.length === 1 ? width / 2 : pad + ((width - pad * 2) * i) / (ratings.length - 1));
  const y = (v: number) => height - pad - ((height - pad * 2) * (v - 1)) / 3;
  const d = ratings.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(" ");
  const first = confidenceWord(ratings[0]);
  const last = confidenceWord(ratings[ratings.length - 1]);
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={`Your own ratings over ${sessionsText(ratings.length)}: from ${first} to ${last}`}
      className={`block h-auto w-full ${className}`}
    >
      <path d={d} className="fill-none stroke-ink" strokeWidth={1.8} strokeLinejoin="round" strokeLinecap="round" />
      {ratings.map((v, i) => (
        <circle key={i} cx={x(i)} cy={y(v)} r={2.4} className="fill-ink" />
      ))}
    </svg>
  );
}
