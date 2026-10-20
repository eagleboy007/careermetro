import { describe, expect, it } from "vitest";
import { PARSE_GIVE_UP_FILE_MS, PARSE_GIVE_UP_MS, PARSE_STEP_STARTS_MS, PARSE_STEPS, SLOW_PARSE_MS, currentParseStep, parseWaitNote } from "./parse-steps";

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

  it("say a slow reading is still going, and stop waiting after the route's own limit", () => {
    expect(parseWaitNote(0)).toBe("This usually takes 10 to 30 seconds.");
    expect(parseWaitNote(SLOW_PARSE_MS - 1)).toBe("This usually takes 10 to 30 seconds.");
    expect(parseWaitNote(SLOW_PARSE_MS)).toMatch(/^Still reading\./);
    // /api/resume runs for at most 120 seconds once the request has arrived, so the form never gives up on a reply that
    // can still come. A file also has to arrive first (fetch can't say when it has), so it gets about a minute more.
    expect(PARSE_GIVE_UP_MS).toBeGreaterThan(120_000);
    expect(PARSE_GIVE_UP_FILE_MS).toBeGreaterThanOrEqual(PARSE_GIVE_UP_MS + 45_000);
    expect(SLOW_PARSE_MS).toBeLessThan(PARSE_GIVE_UP_MS);
  });
});
