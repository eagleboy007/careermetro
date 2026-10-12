import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { loadPrompt } from "@/lib/ai/prompts";
import { PARSE_JD_MODEL, parseJobPosting } from "@/lib/jobs/parse";
import { loadJdEvalCases } from "./cases";
import { formatJdEval, runJdEval, type JdOutcome } from "./jd-eval";

/** Lowest mean skill recall that passes, until a first baseline is measured. Override with EVAL_JD_MIN_RECALL. */
const MIN_RECALL = Number(process.env.EVAL_JD_MIN_RECALL ?? 0.7);

async function readCase(text: string): Promise<JdOutcome> {
  let result = await parseJobPosting(text, { purpose: "eval" });
  // One retry for an API error (a 429 or 529 among parallel calls), so an outage blip doesn't fail the check.
  if (!result.ok && result.reason === "unavailable") {
    const retry = await parseJobPosting(text, { purpose: "eval" });
    retry.calls.unshift(...result.calls);
    result = retry;
  }
  return result.ok ? result : { ok: false, reason: result.reason, calls: result.calls };
}

// Runs the real parse-jd prompt over the synthetic postings in fixtures/evals/jd (AI-4). Needs ANTHROPIC_API_KEY; a few
// US cents a case. Run with `npm run eval:jd`, never with `npm test`.
describe.skipIf(!process.env.ANTHROPIC_API_KEY)("job posting eval", () => {
  it("reads every posting without claiming skills it doesn't name", async () => {
    const report = await runJdEval(loadJdEvalCases(), readCase, { promptVersion: loadPrompt("parse-jd").id, model: PARSE_JD_MODEL });

    const summary = formatJdEval(report);
    mkdirSync("eval-results", { recursive: true });
    writeFileSync("eval-results/jd.json", JSON.stringify(report, null, 2));
    writeFileSync("eval-results/jd.md", summary);
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary + "\n");
    console.log(summary);

    expect(report.failed).toBe(0);
    expect(report.cases.filter((c) => c.hallucinations.length > 0).map((c) => c.id)).toEqual([]);
    expect(report.meanRecall).toBeGreaterThanOrEqual(MIN_RECALL);
  });
});
