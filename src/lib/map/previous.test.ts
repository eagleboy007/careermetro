import { describe, expect, it } from "vitest";
import { gapAnalysis, mapLine, previousLine } from "@/lib/schemas";
import { exampleMapLine, exampleSwitchedMapLine } from "./fixtures";
import { earlierLine } from "./previous";

const gaps = (ids: string[]) => ids.map((skillId) => ({ skillId, skillName: skillId.toUpperCase() }));
const base = {
  analysisId: "7d1c2f9e-3a4b-4c5d-8e6f-0a1b2c3d4e5f",
  title: "Business Analyst",
  currentRoleSlug: "data-analyst",
  lineSkillIds: new Set(["sql", "excel", "power-bi"]),
  goals: new Map<string, { id: string; proved: boolean }>(),
  ownByGoal: new Map<string, number>(),
};

describe("earlierLine", () => {
  it("leaves on the earlier line only the gaps the new line doesn't need, in their order, and counts the shared ones", () => {
    const line = earlierLine({ ...base, previous: { roleSlug: "business-analyst", gaps: gaps(["sql", "process-mapping", "excel", "requirements-gathering"]) } });
    expect(line).toEqual({
      role: { slug: "business-analyst", title: "Business Analyst" },
      analysisId: base.analysisId,
      left: [
        { skillId: "process-mapping", name: "PROCESS-MAPPING", proved: false, ownPitstops: 0 },
        { skillId: "requirements-gathering", name: "REQUIREMENTS-GATHERING", proved: false, ownPitstops: 0 },
      ],
      shared: 2,
      came: [
        { skillId: "sql", name: "SQL", proved: false, learnDone: false },
        { skillId: "excel", name: "EXCEL", proved: false, learnDone: false },
      ],
      changedAt: null,
    });
    expect(previousLine.safeParse(line).success).toBe(true);
  });

  it("lists what came along with its proof or progress, and when the destination changed (C25)", () => {
    const line = earlierLine({
      ...base,
      previous: { roleSlug: "business-analyst", gaps: gaps(["sql", "excel", "process-mapping"]) },
      goals: new Map([["sql", { id: "g1", proved: true }]]),
      learnDone: new Set(["excel"]),
      changedAt: "2026-10-31T09:30:00.000Z",
    });
    expect(line!.came).toEqual([
      { skillId: "sql", name: "SQL", proved: true, learnDone: false },
      { skillId: "excel", name: "EXCEL", proved: false, learnDone: true },
    ]);
    expect(line!.changedAt).toBe("2026-10-31T09:30:00.000Z");
    expect(previousLine.safeParse(line).success).toBe(true);
    expect(previousLine.safeParse({ ...line!, changedAt: "last week" }).success).toBe(false);
    expect(previousLine.safeParse({ ...line!, analysisId: "abc" }).success).toBe(false);
  });

  it("keeps each left goal's proof and the pitstops the person added on it, at most three", () => {
    const line = earlierLine({
      ...base,
      previous: { roleSlug: "business-analyst", gaps: gaps(["process-mapping", "stakeholder-management"]) },
      goals: new Map([
        ["process-mapping", { id: "g1", proved: true }],
        ["stakeholder-management", { id: "g2", proved: false }],
      ]),
      ownByGoal: new Map([
        ["g1", 0],
        ["g2", 5],
      ]),
    });
    expect(line!.left).toEqual([
      { skillId: "process-mapping", name: "PROCESS-MAPPING", proved: true, ownPitstops: 0 },
      { skillId: "stakeholder-management", name: "STAKEHOLDER-MANAGEMENT", proved: false, ownPitstops: 3 },
    ]);
  });

  it("draws no earlier line for the same role, and an empty one when every goal came along", () => {
    expect(earlierLine({ ...base, previous: { roleSlug: "data-analyst", gaps: gaps(["sql"]) } })).toBeNull();
    expect(earlierLine({ ...base, previous: { roleSlug: "business-analyst", gaps: gaps(["sql", "excel"]) } })).toMatchObject({ left: [], shared: 2 });
  });

  it("clips a long skill name to 80 characters", () => {
    const line = earlierLine({ ...base, previous: { roleSlug: "business-analyst", gaps: [{ skillId: "x", skillName: "A".repeat(120) }] } });
    expect(line!.left[0].name).toHaveLength(80);
    expect(previousLine.safeParse(line).success).toBe(true);
  });
});

describe("previousLine and chosenAt schemas", () => {
  it("accepts the design page's switched line and lines without one", () => {
    expect(mapLine.safeParse(exampleSwitchedMapLine).success).toBe(true);
    expect(mapLine.safeParse({ ...exampleMapLine, previous: null }).success).toBe(true);
    expect(mapLine.safeParse(exampleMapLine).success).toBe(true);
    expect(exampleSwitchedMapLine.previous).toMatchObject({ role: { slug: "business-analyst" }, shared: 2 });
  });

  it("refuses more own pitstops on a left goal than a goal can have", () => {
    const left = [{ skillId: "a", name: "A", proved: false, ownPitstops: 4 }];
    const line = { role: { slug: "x", title: "X" }, analysisId: null, left, shared: 0, came: [], changedAt: null };
    expect(previousLine.safeParse(line).success).toBe(false);
    expect(previousLine.safeParse({ ...line, left: [{ ...left[0], ownPitstops: 3 }] }).success).toBe(true);
  });

  it("takes chosenAt only as an ISO date and time on the analysis", () => {
    const analysis = { roleSlug: "data-analyst", gaps: [], metSkillIds: [], readiness: { headline: "Close", explanation: "Close.", estimatedHours: 0 } };
    expect(gapAnalysis.safeParse({ ...analysis, chosenAt: "2026-10-31T09:30:00.123Z" }).success).toBe(true);
    expect(gapAnalysis.safeParse({ ...analysis, chosenAt: "yesterday" }).success).toBe(false);
    expect(gapAnalysis.parse(analysis)).not.toHaveProperty("chosenAt");
  });
});
