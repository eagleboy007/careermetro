import { describe, expect, it } from "vitest";
import { PARSE_STEP_STARTS_MS, PARSE_STEPS, currentParseStep } from "./parse-steps";

describe("the steps shown while a resume is read", () => {
  it("name only what the upload itself does, never the role or the line", () => {
    expect(PARSE_STEPS).toEqual(["Reading your file", "Removing phone, email and address", "Finding your skills", "Saving your profile"]);
    expect(PARSE_STEPS.join(" ")).not.toMatch(/Comparing|line/);
  });

  it("move on with time and stop at the last step", () => {
    expect(PARSE_STEP_STARTS_MS).toHaveLength(PARSE_STEPS.length);
    expect(currentParseStep(0)).toBe(0);
    expect(currentParseStep(PARSE_STEP_STARTS_MS[1] - 1)).toBe(0);
    expect(currentParseStep(PARSE_STEP_STARTS_MS[1])).toBe(1);
    expect(currentParseStep(PARSE_STEP_STARTS_MS[2])).toBe(2);
    expect(currentParseStep(PARSE_STEP_STARTS_MS[3])).toBe(3);
    expect(currentParseStep(120_000)).toBe(3);
  });
});
