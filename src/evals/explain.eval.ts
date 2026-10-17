import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { loadPrompt } from "@/lib/ai/prompts";
import { EXPLAIN_MODEL, explainGaps } from "@/lib/gaps/explain";
import { loadEvalCases } from "./cases";
import { explainInputs, formatExplainEval, runExplainEval } from "./explain-eval";

/** Lowest share of cases that must get the model's words rather than the template. Override with EVAL_EXPLAIN_MIN_MODEL. */
const MIN_MODEL_RATE = Number(process.env.EVAL_EXPLAIN_MIN_MODEL ?? 0.9);

// Runs the real explain-gaps prompt over the matcher's gaps for each synthetic resume in fixtures/evals (pending item
// 6). Needs ANTHROPIC_API_KEY; about $1 a run. Run with `npm run eval:explain`, never with `npm test` or in CI. Without
// the key it fails rather than passing with nothing checked (T70).
describe("explain-gaps eval", () => {
  it("words every gap without inventing quotes or changing the hours", async () => {
    if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is not set: this eval runs the real prompt.");
    const report = await runExplainEval(explainInputs(loadEvalCases()), (match, roleTitle) => explainGaps(match, roleTitle, { eval: "explain" }), {
      promptVersion: loadPrompt("explain-gaps").id,
      model: EXPLAIN_MODEL,
    });

    const summary = formatExplainEval(report);
    mkdirSync("eval-results", { recursive: true });
    writeFileSync("eval-results/explain.json", JSON.stringify(report, null, 2));
    writeFileSync("eval-results/explain.md", summary);
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary + "\n");
    console.log(summary);

    expect(report.modelRate).toBeGreaterThanOrEqual(MIN_MODEL_RATE);
    expect(report.cases.filter((c) => c.inventedQuotes.length > 0).map((c) => c.id)).toEqual([]);
    expect(report.cases.filter((c) => c.wrongHours.length > 0).map((c) => c.id)).toEqual([]);
    expect(report.exclamations).toBe(0);
    expect(report.cases.filter((c) => c.tooLong > 0).map((c) => c.id)).toEqual([]);
  });
});
