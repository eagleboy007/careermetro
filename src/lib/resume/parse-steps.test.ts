import { describe, expect, it } from "vitest";
import { PARSE_STEP_STARTS_MS, currentParseStep, parseSteps } from "./parse-steps";

describe("the steps shown while a resume is read", () => {
  it("name the picked role in the third step", () => {
    expect(parseSteps("Cyber Security Analyst")).toEqual([
      "Reading your resume",
      "Finding your skills",
      "Comparing with Cyber Security Analyst",
      "Drawing your line",
    ]);
    expect(parseSteps(null)[2]).toBe("Comparing with the roles we know");
  });

  it("move on with time and stop at the last step", () => {
    expect(PARSE_STEP_STARTS_MS).toHaveLength(parseSteps(null).length);
    expect(currentParseStep(0)).toBe(0);
    expect(currentParseStep(PARSE_STEP_STARTS_MS[1] - 1)).toBe(0);
    expect(currentParseStep(PARSE_STEP_STARTS_MS[1])).toBe(1);
    expect(currentParseStep(PARSE_STEP_STARTS_MS[2])).toBe(2);
    expect(currentParseStep(PARSE_STEP_STARTS_MS[3])).toBe(3);
    expect(currentParseStep(120_000)).toBe(3);
  });
});
