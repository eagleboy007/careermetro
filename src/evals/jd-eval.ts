import type { AiCallRecord } from "@/lib/ai/log";
import type { JdEvalCase } from "@/lib/schemas";

/** What reading one posting gave: the mapped skills after the quote check, or why it failed. */
export type JdOutcome =
  | { ok: true; requiredSkillIds: string[]; niceSkillIds: string[]; unknownSkills: string[]; dropped: number; calls: AiCallRecord[] }
  | { ok: false; reason: string; calls: AiCallRecord[] };

export type JdReadFn = (postingText: string) => Promise<JdOutcome>;

export type JdCaseResult = {
  id: string;
  ok: boolean;
  reason?: string;
  /** Share of the expected skills (required and good to have) found at all. */
  recall: number;
  /** Share of the expected skills found that were given the expected level. */
  levelAccuracy: number;
  /** Expected skills not found, by id. */
  missed: string[];
  /** Skills found that the posting never names (mustNotClaim). */
  hallucinations: string[];
  /** Expected unknown names that were listed as "Not in our skill list yet". */
  unknownFound: number;
  /** Skills the quote check dropped: the prompt's own invented quotes, before the safety net. */
  dropped: number;
  costUsd: number;
  latencyMs: number;
};

export type JdEvalReport = {
  promptVersion: string;
  model: string;
  cases: JdCaseResult[];
  meanRecall: number;
  meanLevelAccuracy: number;
  failed: number;
  hallucinations: number;
  dropped: number;
  costUsd: number;
};

/** Scores one reading against its labels. Pure, so it is tested without the API. */
export function scoreJdCase(c: JdEvalCase, out: JdOutcome): JdCaseResult {
  const sum = (key: "costUsd" | "latencyMs") => out.calls.reduce((s, call) => s + call[key], 0);
  const expected = [...c.expected.required, ...c.expected.nice];
  if (!out.ok) {
    return { id: c.id, ok: false, reason: out.reason, recall: 0, levelAccuracy: 0, missed: expected, hallucinations: [], unknownFound: 0, dropped: 0, costUsd: sum("costUsd"), latencyMs: sum("latencyMs") };
  }
  const required = new Set(out.requiredSkillIds);
  const nice = new Set(out.niceSkillIds);
  const found = expected.filter((id) => required.has(id) || nice.has(id));
  const rightLevel = found.filter((id) => (c.expected.required.includes(id) ? required.has(id) : nice.has(id)));
  const unknown = new Set(out.unknownSkills.map((n) => n.toLowerCase()));
  return {
    id: c.id,
    ok: true,
    recall: found.length / Math.max(1, expected.length),
    levelAccuracy: found.length ? rightLevel.length / found.length : 0,
    missed: expected.filter((id) => !found.includes(id)),
    hallucinations: c.expected.mustNotClaim.filter((id) => required.has(id) || nice.has(id)),
    unknownFound: c.expected.unknown.filter((n) => unknown.has(n.toLowerCase())).length,
    dropped: out.dropped,
    costUsd: sum("costUsd"),
    latencyMs: sum("latencyMs"),
  };
}

/** Reads every eval posting and scores it (AI-4), a few at a time. */
export async function runJdEval(cases: JdEvalCase[], read: JdReadFn, meta: { promptVersion: string; model: string }, concurrency = 4): Promise<JdEvalReport> {
  const results: JdCaseResult[] = new Array(cases.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, cases.length) }, async () => {
      while (next < cases.length) {
        const i = next++;
        results[i] = scoreJdCase(cases[i], await read(cases[i].text));
      }
    }),
  );
  const mean = (key: "recall" | "levelAccuracy") => results.reduce((s, r) => s + r[key], 0) / Math.max(1, results.length);
  return {
    ...meta,
    cases: results,
    meanRecall: mean("recall"),
    meanLevelAccuracy: mean("levelAccuracy"),
    failed: results.filter((r) => !r.ok).length,
    hallucinations: results.reduce((s, r) => s + r.hallucinations.length, 0),
    dropped: results.reduce((s, r) => s + r.dropped, 0),
    costUsd: results.reduce((s, r) => s + r.costUsd, 0),
  };
}

const pct = (n: number) => `${Math.round(n * 100)}%`;

/** A Markdown summary. Skill ids and counts only, never posting text. */
export function formatJdEval(r: JdEvalReport): string {
  const rows = r.cases.map(
    (c) =>
      `| ${c.id} | ${c.ok ? pct(c.recall) : `failed (${c.reason})`} | ${c.ok ? pct(c.levelAccuracy) : "-"} | ${c.hallucinations.join(", ") || "none"} | ${c.dropped} | ${c.missed.join(", ") || "none"} | ${c.unknownFound} | $${c.costUsd.toFixed(3)} | ${(c.latencyMs / 1000).toFixed(1)}s |`,
  );
  return [
    `## Job posting eval: ${r.promptVersion} on ${r.model}`,
    "",
    `Mean skill recall ${pct(r.meanRecall)} · right level ${pct(r.meanLevelAccuracy)} · hallucinated skills ${r.hallucinations} · dropped by the quote check ${r.dropped} · failed ${r.failed} · cost $${r.costUsd.toFixed(2)}`,
    "",
    "| Case | Recall | Right level | Hallucinated | Dropped | Missed | Unknown names found | Cost | Time |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ...rows,
  ].join("\n");
}
