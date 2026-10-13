import type { CriteriaView, JobMatchView } from "./types";

/* Plain words for Match to this job, safe for client components (no matcher or content files). */

/** "2 of 5 required proved · 1 on resume", for cards. Never a score. */
export function matchSummary(m: Pick<JobMatchView, "requiredProved" | "requiredOnResume" | "requiredTotal">): string {
  if (m.requiredTotal === 0) return "No required skills";
  const head = `${m.requiredProved} of ${m.requiredTotal} required proved`;
  return m.requiredOnResume ? `${head} · ${m.requiredOnResume} on resume` : head;
}

/** "2 of 3 criteria met", for Express apply's criteria. Never a score. */
export function criteriaSummary(c: Pick<CriteriaView, "met" | "total">): string {
  if (c.total === 0) return "No Express apply criteria";
  if (c.met === c.total) return c.total === 1 ? "Criterion met" : `All ${c.total} criteria met`;
  return `${c.met} of ${c.total} ${c.total === 1 ? "criterion" : "criteria"} met`;
}
