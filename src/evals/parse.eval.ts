import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { loadPrompt } from "@/lib/ai/prompts";
import { maskPii } from "@/lib/resume/mask";
import { PARSE_MODEL, parseResume } from "@/lib/resume/parse";
import { loadEvalCases } from "./cases";
import { formatParseEval, runParseEval } from "./parse-eval";

// Runs the real parse prompt over every synthetic eval resume (AI-4). Needs ANTHROPIC_API_KEY; about 5 to 8 US cents a case.
describe.skipIf(!process.env.ANTHROPIC_API_KEY)("parse eval", () => {
  it("parses every case without claiming skills the resume doesn't support", async () => {
    const report = await runParseEval(
      loadEvalCases(),
      async (text) => {
        const result = await parseResume(maskPii(text).text, { purpose: "eval" });
        return { profile: result.ok ? result.profile : null, calls: result.calls };
      },
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
  });
});
