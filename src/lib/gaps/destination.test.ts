import { describe, expect, it } from "vitest";
import { destinationChoice, gapAnalysis } from "@/lib/schemas";
import { gapSkillsOf, leftOnEarlierLine, picksSilently } from "./destination";

describe("picksSilently", () => {
  const current = { id: "a1", roleSlug: "data-analyst", sample: false };
  it("makes a first analysis the destination, and the same role on another resume", () => {
    expect(picksSilently(null, "cloud-engineer")).toBe(true);
    expect(picksSilently(current, "data-analyst")).toBe(true);
  });
  it("lets the person's own resume take over from the sample", () => {
    expect(picksSilently({ ...current, sample: true }, "cloud-engineer")).toBe(true);
  });
  it("asks first for any other role", () => {
    expect(picksSilently(current, "cloud-engineer")).toBe(false);
  });
});

describe("leftOnEarlierLine", () => {
  const gaps = new Set(["sql", "excel"]);
  it("leaves behind only gap goals the current analysis doesn't need", () => {
    expect(leftOnEarlierLine({ skillId: "process-mapping", source: "gap" }, gaps)).toBe(true);
    expect(leftOnEarlierLine({ skillId: "sql", source: "gap" }, gaps)).toBe(false);
  });
  it("never leaves behind a goal the person chose", () => {
    expect(leftOnEarlierLine({ skillId: "process-mapping", source: "user" }, gaps)).toBe(false);
  });
  it("leaves nothing behind without a current analysis", () => {
    expect(leftOnEarlierLine({ skillId: "process-mapping", source: "gap" }, null)).toBe(false);
  });
  it("reads the gap skills of an analysis", () => {
    expect(gapSkillsOf(null)).toBeNull();
    expect([...gapSkillsOf({ result: { gaps: [{ skillId: "sql" }, { skillId: "excel" }] } })!]).toEqual(["sql", "excel"]);
  });
});

describe("destination schemas", () => {
  const analysis = { roleSlug: "data-analyst", gaps: [], metSkillIds: [], readiness: { headline: "Close", explanation: "Close.", estimatedHours: 0 } };
  it("takes notChosen only as true, and leaves it out when absent", () => {
    expect(gapAnalysis.safeParse({ ...analysis, notChosen: true }).success).toBe(true);
    expect(gapAnalysis.safeParse({ ...analysis, notChosen: false }).success).toBe(false);
    expect(gapAnalysis.safeParse({ ...analysis, notChosen: "yes" }).success).toBe(false);
    expect(gapAnalysis.parse(analysis)).not.toHaveProperty("notChosen");
  });
  it("takes one analysis id and nothing else", () => {
    expect(destinationChoice.safeParse({ analysisId: "7d1c2f9e-3a4b-4c5d-8e6f-0a1b2c3d4e5f" }).success).toBe(true);
    for (const bad of [{}, { analysisId: "abc" }, { analysisId: 3 }, null, "7d1c2f9e-3a4b-4c5d-8e6f-0a1b2c3d4e5f", { analysisId: "7d1c2f9e-3a4b-4c5d-8e6f-0a1b2c3d4e5f", userId: "x" }]) {
      expect(destinationChoice.safeParse(bad).success).toBe(false);
    }
  });
});
