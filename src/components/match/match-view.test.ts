import { describe, expect, it } from "vitest";
import { jobsHref, jobsText, soonHeading, whenText } from "./match-view";

describe("Match wording", () => {
  it("says how far a role is in weeks, or Now", () => {
    expect(whenText(null)).toBe("Now");
    expect(whenText(1)).toBe("about 1 week");
    expect(whenText(4)).toBe("about 4 weeks");
  });

  it("heads the second group with its largest number of weeks", () => {
    expect(soonHeading(9)).toBe("Within 9 weeks");
    expect(soonHeading(1)).toBe("Within 1 week");
    expect(soonHeading(null)).toBe("Within a few weeks");
  });

  it("counts open jobs in Departures, and falls back to a plain link", () => {
    expect(jobsText(3)).toBe("3 open jobs in Departures");
    expect(jobsText(1)).toBe("1 open job in Departures");
    expect(jobsText(0)).toBe("No open jobs in Departures yet");
    expect(jobsText(null)).toBe("Browse Departures");
    // "N open jobs" opens that role's jobs; with none, or no count, all of Departures.
    expect(jobsHref("data-analyst", 3)).toBe("/departures?role=data-analyst");
    expect(jobsHref("data-analyst", 0)).toBe("/departures");
    expect(jobsHref("data-analyst", null)).toBe("/departures");
  });
});
