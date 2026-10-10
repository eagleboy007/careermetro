import { describe, expect, it } from "vitest";
import { loadEvalCases } from "./cases";
import { runMatcherEval } from "./matcher-eval";

const scores = runMatcherEval(loadEvalCases());
const mean = (key: "gapPrecision" | "gapRecall" | "statusAccuracy") => scores.reduce((s, c) => s + c[key], 0) / scores.length;

// Floors sit just under the measured baseline, so a matcher change that loses ground fails CI. 2026-10-10: precision
// 0.96, recall 0.70, status 1.00. Recall was 0.76 while labels for context skills (communication, problem solving)
// counted; those were easy hits, and the app no longer shows them as gaps. Other skills' gaps are unchanged. This measures the matcher on ideal input: one
// labelled quote per skill, with no jobs or dates, so list detection on bullets and the outdated rule are covered
// by match.test.ts, not here. Status accuracy only counts gaps both sides found.
// 2026-10-10, 20 cases with 7 researched roles: precision 0.98, recall 0.72, status 1.00. The new misses are "light
// use" labelled weak; the matcher reads any real quote as held, so judging depth is a matcher change of its own.
describe("matcher eval", () => {
  it("finds the labelled gaps with few false alarms", () => {
    expect(mean("gapPrecision")).toBeGreaterThanOrEqual(0.9);
    expect(mean("gapRecall")).toBeGreaterThanOrEqual(0.69);
    expect(mean("statusAccuracy")).toBeGreaterThanOrEqual(0.95);
  });
});
