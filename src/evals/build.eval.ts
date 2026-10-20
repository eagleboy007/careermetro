import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { loadPrompt } from "@/lib/ai/prompts";
import { BUILD_MODEL, rewordAnswers } from "@/lib/builder/reword";
import { formatBuildEval, loadBuildCases, runBuildEval } from "./build-eval";

// Runs the real build-resume prompt over the synthetic answers in fixtures/evals/builder (FR-36). Needs
// ANTHROPIC_API_KEY; a few cents a run. Run with `npm run eval:build`, never with `npm test` or in CI. Without the key it
// fails rather than passing with nothing checked.
describe("build-resume eval", () => {
  it("rewords every answer without making anything up", async () => {
    if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is not set: this eval runs the real prompt.");
    const report = await runBuildEval(loadBuildCases(), async (a) => (await rewordAnswers(a, { eval: "build" })).reword, {
      promptVersion: loadPrompt("build-resume").id,
      model: BUILD_MODEL,
    });
    const summary = formatBuildEval(report);
    mkdirSync("eval-results", { recursive: true });
    writeFileSync("eval-results/build.json", JSON.stringify(report, null, 2));
    writeFileSync("eval-results/build.md", summary);
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary + "\n");
    console.log(summary);

    expect(report.answeredRate).toBe(1);
    expect(report.cases.filter((c) => c.unsupported.length > 0).map((c) => c.id)).toEqual([]);
    expect(report.cases.filter((c) => c.missingIds.length + c.extraIds.length > 0).map((c) => c.id)).toEqual([]);
    expect(report.cases.reduce((n, c) => n + c.exclamations, 0)).toBe(0);
  });
});
