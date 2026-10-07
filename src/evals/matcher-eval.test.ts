import { describe, expect, it } from "vitest";
import { loadEvalCases } from "./cases";
import { runMatcherEval } from "./matcher-eval";

const scores = runMatcherEval(loadEvalCases());
const mean = (key: "gapPrecision" | "gapRecall" | "statusAccuracy") => scores.reduce((s, c) => s + c[key], 0) / scores.length;

// Floors sit just under the first measured baseline (2026-10-07: precision 0.94, recall 0.80, status 1.00),
// so a matcher change that loses ground fails CI. Raise them as the rules and labels improve.
describe("matcher eval", () => {
  it("finds the labelled gaps with few false alarms", () => {
    expect(mean("gapPrecision")).toBeGreaterThanOrEqual(0.9);
    expect(mean("gapRecall")).toBeGreaterThanOrEqual(0.75);
    expect(mean("statusAccuracy")).toBeGreaterThanOrEqual(0.95);
  });
});
