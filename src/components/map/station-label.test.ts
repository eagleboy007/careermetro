import { describe, expect, it } from "vitest";
import { stationLabel } from "./metro-map";

describe("stationLabel", () => {
  it("starts with the text the station shows", () => {
    expect(stationLabel("1 · LEARN ✓", "Statistics", "Statistics", false)).toBe("1 · LEARN ✓ Statistics, done");
    expect(stationLabel("2 · PROVE", "SQL window f…", "SQL window functions", true)).toBe(
      "2 · PROVE SQL window f…, SQL window functions, you are here",
    );
    expect(stationLabel(null, "Data Analyst", "Data Analyst", false)).toBe("Data Analyst");
  });
});
