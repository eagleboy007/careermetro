import { describe, expect, it } from "vitest";
import { loadEvalCases } from "./cases";
import { runMatcherEval } from "./matcher-eval";

const scores = runMatcherEval(loadEvalCases());
const mean = (key: "gapPrecision" | "gapRecall" | "statusAccuracy") => scores.reduce((s, c) => s + c[key], 0) / scores.length;

// Floors sit just under the measured baseline (2026-10-07, after the review fixes: precision 0.96, recall 0.76,
// status 1.00), so a matcher change that loses ground fails CI. This measures the matcher on ideal input: one
// labelled quote per skill, with no jobs or dates, so list detection on bullets and the outdated rule are covered
// by match.test.ts, not here. Status accuracy only counts gaps both sides found.
describe("matcher eval", () => {
  it("finds the labelled gaps with few false alarms", () => {
    expect(mean("gapPrecision")).toBeGreaterThanOrEqual(0.9);
    expect(mean("gapRecall")).toBeGreaterThanOrEqual(0.75);
    expect(mean("statusAccuracy")).toBeGreaterThanOrEqual(0.95);
  });
});
