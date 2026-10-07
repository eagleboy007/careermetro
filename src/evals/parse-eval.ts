import { normalizeSkillTerm, skillIdByTerm } from "@/content";
import type { AiCallRecord } from "@/lib/ai/log";
import type { EvalCase, Profile } from "@/lib/schemas";
import { scoreCase } from "./score";

export type ParseFn = (resumeText: string) => Promise<{ profile: Profile | null; calls: AiCallRecord[] }>;

export type ParseCaseResult = {
  id: string;
  ok: boolean;
  parseRecall: number;
  hallucinations: string[];
  /** Expected skills the parser didn't produce, by id. */
  missed: string[];
  /** Skill names the parser produced that match no taxonomy name or alias. These are candidates for new aliases. */
  unmapped: string[];
  costUsd: number;
  latencyMs: number;
};

export type ParseEvalReport = {
  promptVersion: string;
  model: string;
  cases: ParseCaseResult[];
  meanRecall: number;
  failed: number;
  hallucinations: number;
  costUsd: number;
};

/** Maps a parsed skill name to a taxonomy id by exact name or alias, the same rule the gap matcher starts from. */
export function resolveSkillId(name: string): string | undefined {
  return skillIdByTerm.get(normalizeSkillTerm(name));
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}

/** Runs the parser over every eval case and scores skill recall and hallucinations (AI-4). */
export async function runParseEval(
  cases: EvalCase[],
  parse: ParseFn,
  meta: { promptVersion: string; model: string },
  concurrency = 4,
): Promise<ParseEvalReport> {
  const results = await mapLimit(cases, concurrency, async (c): Promise<ParseCaseResult> => {
    const { profile, calls } = await parse(c.resumeText);
    const names = profile?.skills.map((s) => s.name) ?? [];
    const skillIds = [...new Set(names.map(resolveSkillId).filter((id): id is string => id !== undefined))];
    const score = scoreCase(c, { skillIds, gaps: [] });
    const found = new Set(skillIds);
    return {
      id: c.id,
      ok: profile !== null,
      parseRecall: profile ? score.parseRecall : 0,
      hallucinations: score.hallucinations,
      missed: c.expected.skills.map((s) => s.skillId).filter((id) => !found.has(id)),
      unmapped: names.filter((n) => resolveSkillId(n) === undefined),
      costUsd: calls.reduce((sum, call) => sum + call.costUsd, 0),
      latencyMs: calls.reduce((sum, call) => sum + call.latencyMs, 0),
    };
  });
  return {
    ...meta,
    cases: results,
    meanRecall: results.reduce((sum, r) => sum + r.parseRecall, 0) / Math.max(1, results.length),
    failed: results.filter((r) => !r.ok).length,
    hallucinations: results.reduce((sum, r) => sum + r.hallucinations.length, 0),
    costUsd: results.reduce((sum, r) => sum + r.costUsd, 0),
  };
}

const pct = (n: number) => `${Math.round(n * 100)}%`;

/** A Markdown summary for the CI job page. Skill ids and names only, never resume text. */
export function formatParseEval(r: ParseEvalReport): string {
  const rows = r.cases.map(
    (c) =>
      `| ${c.id} | ${c.ok ? pct(c.parseRecall) : "failed"} | ${c.hallucinations.join(", ") || "none"} | ${c.missed.join(", ") || "none"} | ${c.unmapped.join(", ") || "none"} | $${c.costUsd.toFixed(3)} | ${(c.latencyMs / 1000).toFixed(1)}s |`,
  );
  return [
    `## Parse eval: ${r.promptVersion} on ${r.model}`,
    "",
    `Mean skill recall ${pct(r.meanRecall)} · hallucinated skills ${r.hallucinations} · failed parses ${r.failed} · cost $${r.costUsd.toFixed(2)}`,
    "",
    "| Case | Recall | Hallucinated | Missed | Not in taxonomy | Cost | Time |",
    "| --- | --- | --- | --- | --- | --- | --- |",
    ...rows,
  ].join("\n");
}
