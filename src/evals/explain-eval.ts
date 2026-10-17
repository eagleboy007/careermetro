import { roleProfiles } from "@/content";
import type { AiCallRecord } from "@/lib/ai/log";
import { SHOWN_GAPS } from "@/lib/gaps/analysis";
import { matchProfile, type MatchResult } from "@/lib/gaps/match";
import type { EvalCase, GapAnalysis } from "@/lib/schemas";
import { expectedProfile } from "./matcher-eval";

/*
 * The explain-gaps eval (pending item 6, AI-4). The matcher decides the gaps; the model only words them, so this checks
 * the words: that the model answered at all (not the template fallback), that it quotes nothing the analysis didn't
 * give it, that the readiness line keeps the matcher's hours, and the prompt's style rules (at most 45 words, no
 * exclamation marks). Scoring is pure and tested without the API; `npm run eval:explain` runs the real prompt.
 */

/** What explaining one case gave, as explainGaps returns it. */
export type ExplainOutcome = { analysis: GapAnalysis; source: "model" | "template"; calls: AiCallRecord[] };
export type ExplainFn = (match: MatchResult, roleTitle: string) => Promise<ExplainOutcome>;

export type ExplainCaseResult = {
  id: string;
  /** The models the calls report, so a fallback shows. */
  models: string[];
  /** False when the page would have shown template sentences: the call failed or the answer broke the rules. */
  model: boolean;
  gaps: number;
  /** Quoted phrases (three words or more) found nowhere in what the model was given: the role title and every gap's resume quote, skill name and role expectation. */
  inventedQuotes: string[];
  /** Hours named in the readiness line that differ from the matcher's estimate. */
  wrongHours: number[];
  /** Explanations (and the readiness line) over the prompt's 45 words. */
  tooLong: number;
  exclamations: number;
  costUsd: number;
  latencyMs: number;
};

export type ExplainEvalReport = {
  promptVersion: string;
  /** The model asked for; `models` lists the ones that answered, which differ after a server-side fallback. */
  model: string;
  models: string[];
  cases: ExplainCaseResult[];
  modelRate: number;
  inventedQuotes: number;
  wrongHours: number;
  tooLong: number;
  exclamations: number;
  costUsd: number;
};

const MAX_WORDS = 45;
const words = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;
const plain = (s: string) =>
  s
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[^\p{L}\p{N}'+#.]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

/** Phrases the text puts in double quotes (straight or curly). */
export function quotedPhrases(text: string): string[] {
  return [...text.matchAll(/["“]([^"“”]+)["”]/g)].map((m) => m[1]!.trim()).filter((q) => words(q) >= 3);
}

const NUMBER = String.raw`\d[\d,]*(?:\.\d+)?`;
const HOURS = new RegExp(String.raw`(?<![\d.,])(${NUMBER})(?:\s*(?:-|–|to)\s*(${NUMBER}))?\s*(?:-\s*)?(?:hours?|hrs?)\b`, "gi");

/** Every number of hours a sentence names ("about 40 hours", "40-hour", both ends of "40-60 hours", "1.5 hours"). */
export function hoursNamed(text: string): number[] {
  const num = (n: string) => Number(n.replace(/,/g, ""));
  return [...text.matchAll(HOURS)].flatMap((m) => (m[2] ? [num(m[1]!), num(m[2])] : [num(m[1]!)]));
}

/**
 * Scores one case's explanations against the matcher's own analysis. Pure. A quote counts as invented only when it is in
 * none of what the model was given (T61): the role title, and every gap's resume quote, skill name and expectation.
 */
export function scoreExplainCase(id: string, match: MatchResult, out: ExplainOutcome, roleTitle = ""): ExplainCaseResult {
  const sum = (key: "costUsd" | "latencyMs") => out.calls.reduce((s, call) => s + call[key], 0);
  const shown = match.gaps.slice(0, SHOWN_GAPS);
  const byId = new Map(out.analysis.gaps.map((g) => [g.skillId, g]));
  const texts = shown.map((g) => byId.get(g.skillId)?.explanation ?? "");
  const readiness = out.analysis.readiness.explanation;
  const source = plain([roleTitle, ...match.gaps.flatMap((g) => [g.resumeQuote ?? "", g.skillName, g.requirement])].join(" \n "));
  const inventedQuotes = [...texts, readiness].flatMap((t) => quotedPhrases(t).filter((q) => !source.includes(plain(q))));
  return {
    id,
    models: [...new Set(out.calls.map((c) => c.model))],
    model: out.source === "model",
    gaps: shown.length,
    inventedQuotes,
    wrongHours: hoursNamed(readiness).filter((h) => h !== match.readiness.estimatedHours),
    tooLong: [...texts, readiness].filter((t) => words(t) > MAX_WORDS).length,
    exclamations: [...texts, readiness].filter((t) => t.includes("!")).length,
    costUsd: sum("costUsd"),
    latencyMs: sum("latencyMs"),
  };
}

/** The matcher's result for each case's labelled profile, as the Gaps page would explain it; cases with no gaps drop out. */
export function explainInputs(cases: EvalCase[], now = new Date("2026-10-07T00:00:00Z")): { id: string; match: MatchResult; roleTitle: string }[] {
  return cases.flatMap((c) => {
    const role = roleProfiles.find((r) => r.slug === c.roleSlug);
    if (!role) throw new Error(`Eval case ${c.id} names unknown role ${c.roleSlug}`);
    const match = matchProfile(expectedProfile(c), role, now);
    return match.gaps.length ? [{ id: c.id, match, roleTitle: role.title }] : [];
  });
}

/** Explains every case and scores it, a few at a time. */
export async function runExplainEval(
  inputs: { id: string; match: MatchResult; roleTitle: string }[],
  explain: ExplainFn,
  meta: { promptVersion: string; model: string },
  concurrency = 4,
): Promise<ExplainEvalReport> {
  const results: ExplainCaseResult[] = new Array(inputs.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, inputs.length) }, async () => {
      while (next < inputs.length) {
        const i = next++;
        const { id, match, roleTitle } = inputs[i]!;
        results[i] = scoreExplainCase(id, match, await explain(match, roleTitle), roleTitle);
      }
    }),
  );
  const total = (f: (r: ExplainCaseResult) => number) => results.reduce((s, r) => s + f(r), 0);
  return {
    ...meta,
    models: [...new Set(results.flatMap((r) => r.models))].sort(),
    cases: results,
    modelRate: total((r) => (r.model ? 1 : 0)) / Math.max(1, results.length),
    inventedQuotes: total((r) => r.inventedQuotes.length),
    wrongHours: total((r) => r.wrongHours.length),
    tooLong: total((r) => r.tooLong),
    exclamations: total((r) => r.exclamations),
    costUsd: total((r) => r.costUsd),
  };
}

const pct = (n: number) => `${Math.round(n * 100)}%`;

/** A Markdown summary: case ids, counts and the invented quotes (the model's words, never resume text it was given). */
export function formatExplainEval(r: ExplainEvalReport): string {
  const rows = r.cases.map(
    (c) =>
      `| ${c.id} | ${c.model ? "model" : "template"} | ${c.gaps} | ${c.inventedQuotes.length ? c.inventedQuotes.map((q) => `"${q}"`).join("; ") : "none"} | ${c.wrongHours.join(", ") || "none"} | ${c.tooLong} | ${c.exclamations} | $${c.costUsd.toFixed(3)} | ${(c.latencyMs / 1000).toFixed(1)}s |`,
  );
  return [
    `## Explain-gaps eval: ${r.promptVersion} on ${r.model}${r.models.some((m) => m !== r.model) ? ` (answered by ${r.models.join(", ")})` : ""}`,
    "",
    `Model words used ${pct(r.modelRate)} · invented quotes ${r.inventedQuotes} · wrong hours ${r.wrongHours} · over 45 words ${r.tooLong} · exclamation marks ${r.exclamations} · cost $${r.costUsd.toFixed(2)}`,
    "",
    "| Case | Words from | Gaps | Invented quotes | Wrong hours | Over 45 words | Exclamations | Cost | Time |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ...rows,
  ].join("\n");
}
