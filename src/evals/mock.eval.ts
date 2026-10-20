import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { loadPrompt } from "@/lib/ai/prompts";
import { MOCK_MODEL, mockFeedbackFor } from "@/lib/mock/interview-feedback";
import { formatMockEval, loadMockCases, runMockEval } from "./mock-eval";

// Runs the real mock-interview prompt over the synthetic answers in fixtures/evals/mock (FR-50 part 3). Needs
// ANTHROPIC_API_KEY; a few cents a run. Run with `npm run eval:mock`, never with `npm test` or in CI. Without the key it
// fails rather than passing with nothing checked. It scores the model's output before the app's own score check, so a
// reply the app would hide still fails here.
describe("mock-interview eval", () => {
  it("gives feedback in words on every answer, never a score or 'ready'", async () => {
    if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is not set: this eval runs the real prompt.");
    const report = await runMockEval(loadMockCases(), async (c) => (await mockFeedbackFor({ roleTitle: c.roleTitle, items: c.items }, { eval: c.id })).parsed, {
      promptVersion: loadPrompt("mock-interview").id,
      model: MOCK_MODEL,
    });
    const summary = formatMockEval(report);
    mkdirSync("eval-results", { recursive: true });
    writeFileSync("eval-results/mock.json", JSON.stringify(report, null, 2));
    writeFileSync("eval-results/mock.md", summary);
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary + "\n");
    console.log(summary);

    expect(report.answeredRate).toBe(1);
    expect(report.broken).toEqual([]);
  });
});
