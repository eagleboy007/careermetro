import { describe, expect, it } from "vitest";
import { monthLabel } from "./life-layout";

describe("monthLabel", () => {
  it("reads the month in India time (T24)", () => {
    // 00:30 IST on 1 Nov is still 31 Oct in UTC.
    expect(monthLabel(new Date("2026-10-31T19:00:00Z"))).toBe("Nov 2026");
    expect(monthLabel(new Date("2026-10-31T18:00:00Z"))).toBe("Oct 2026");
  });
});
