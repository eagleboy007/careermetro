import type { JobMatchView } from "./types";

/* Plain words for Match to this job, safe for client components (no matcher or content files). */

/** "2 of 5 required proved · 1 on resume", for cards. Never a score. */
export function matchSummary(m: Pick<JobMatchView, "requiredProved" | "requiredOnResume" | "requiredTotal">): string {
  if (m.requiredTotal === 0) return "No required skills";
  const head = `${m.requiredProved} of ${m.requiredTotal} required proved`;
  return m.requiredOnResume ? `${head} · ${m.requiredOnResume} on resume` : head;
}
