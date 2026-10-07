import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { loadPrompt } from "@/lib/ai/prompts";
import { maskPii } from "@/lib/resume/mask";
import { PARSE_MODEL, parseResume } from "@/lib/resume/parse";
import { loadEvalCases } from "./cases";
import { formatParseEval, runParseEval, type ParseOutcome } from "./parse-eval";

/**
 * Lowest mean skill recall that passes. Set below the first measured baseline so a prompt change that loses
 * many skills fails; raise it as the prompt and taxonomy aliases improve. Override with EVAL_MIN_RECALL.
 */
const MIN_RECALL = Number(process.env.EVAL_MIN_RECALL ?? 0.5);

async function parseCase(text: string): Promise<ParseOutcome> {
  const masked = maskPii(text).text;
  let result = await parseResume(masked, { purpose: "eval" });
  // One retry for an API error (a 429 or 529 among parallel calls), so an outage blip doesn't fail the check.
  if (!result.ok && result.reason === "unavailable") {
    const retry = await parseResume(masked, { purpose: "eval" });
    retry.calls.unshift(...result.calls);
    result = retry;
  }
  return result.ok
    ? { profile: result.profile, droppedSkills: result.report.droppedSkills, calls: result.calls }
    : { profile: null, reason: result.reason, calls: result.calls };
}

// Runs the real parse prompt over every synthetic eval resume (AI-4). Needs ANTHROPIC_API_KEY; about 5 to 8 US cents a case.
describe.skipIf(!process.env.ANTHROPIC_API_KEY)("parse eval", () => {
  it("parses every case without claiming skills the resume doesn't support", async () => {
    const report = await runParseEval(
      loadEvalCases(),
      parseCase,
      { promptVersion: loadPrompt("parse-resume").id, model: PARSE_MODEL },
    );

    const summary = formatParseEval(report);
    mkdirSync("eval-results", { recursive: true });
    writeFileSync("eval-results/parse.json", JSON.stringify(report, null, 2));
    writeFileSync("eval-results/parse.md", summary);
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary + "\n");
    console.log(summary);

    expect(report.failed).toBe(0);
    expect(report.cases.filter((c) => c.hallucinations.length > 0).map((c) => c.id)).toEqual([]);
    expect(report.meanRecall).toBeGreaterThanOrEqual(MIN_RECALL);
  });
});
