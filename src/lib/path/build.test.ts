import { describe, expect, it } from "vitest";
import type { Gap } from "@/lib/schemas";
import { buildPath, type CatalogResource } from "./build";

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

function gap(skillId: string, status: Gap["status"] = "missing"): Gap {
  return {
    skillId,
    skillName: skillId.toUpperCase(),
    status,
    resumeQuote: null,
    requirement: `Use ${skillId}`,
    explanation: `Why ${skillId} matters.`,
  };
}

function res(n: number, skillIds: string[], minutes = 60, extra: Partial<CatalogResource> = {}): CatalogResource {
  return { id: uuid(n), skillIds, minutes, free: true, healthy: true, ...extra };
}

const skills = [
  { id: "javascript", implies: [] },
  { id: "react", implies: ["javascript"] },
  { id: "nextjs", implies: ["react"] },
  { id: "sql", implies: [] },
  { id: "excel", implies: [] },
];
const proofTasks = new Map([["sql", "Write five queries against a public dataset."]]);
const base = { weeklyHours: 5, skills, proofTasks };

describe("buildPath", () => {
  it("keeps the gaps' order when no gap is a prerequisite of another", () => {
    const path = buildPath({ ...base, gaps: [gap("sql"), gap("excel")], resources: [] });
    expect(path.steps.map((s) => s.skillId)).toEqual(["sql", "excel"]);
    expect(path.steps.map((s) => s.position)).toEqual([1, 2]);
  });

  it("puts a prerequisite before the skill that builds on it, following chains", () => {
    const path = buildPath({ ...base, weeklyHours: 10, gaps: [gap("nextjs"), gap("sql"), gap("javascript")], resources: [] });
    expect(path.steps.map((s) => s.skillId)).toEqual(["javascript", "nextjs", "sql"]);
  });

  it("keeps the gaps' ranking among several prerequisites of one gap", () => {
    const tied = [...skills, { id: "x", implies: ["sql", "excel"] }];
    const path = buildPath({ ...base, weeklyHours: 10, skills: tied, gaps: [gap("x"), gap("excel"), gap("sql")], resources: [] });
    expect(path.steps.map((s) => s.skillId)).toEqual(["excel", "sql", "x"]);
  });

  it("does not loop on a cycle in the taxonomy", () => {
    const cyclic = [{ id: "a", implies: ["b"] }, { id: "b", implies: ["a"] }];
    const path = buildPath({ ...base, skills: cyclic, gaps: [gap("a"), gap("b")], resources: [] });
    expect(path.steps.map((s) => s.skillId).sort()).toEqual(["a", "b"]);
  });

  it("has at most 6 steps and lists the rest as deferred", () => {
    const ids = ["a", "b", "c", "d", "e", "f", "g", "h"];
    const path = buildPath({ ...base, weeklyHours: 10, gaps: ids.map((id) => gap(id, "weak")), resources: [] });
    expect(path.steps).toHaveLength(6);
    expect(path.deferredSkillIds).toEqual(["g", "h"]);
  });

  it("picks only healthy resources for the skill, free first, then shortest, at most 3", () => {
    const resources = [
      res(1, ["sql"], 300),
      res(2, ["sql"], 30, { healthy: false }),
      res(3, ["sql"], 90, { free: false }),
      res(4, ["sql"], 45),
      res(5, ["excel"], 10),
      res(6, ["sql", "excel"], 120),
    ];
    const [step] = buildPath({ ...base, gaps: [gap("sql")], resources }).steps;
    expect(step.resourceIds).toEqual([uuid(4), uuid(6), uuid(1)]);
  });

  it("takes the fewest resources that cover the gap estimate", () => {
    const resources = [res(1, ["sql"], 300), res(2, ["sql"], 30), res(3, ["sql"], 600)];
    const [step] = buildPath({ ...base, gaps: [gap("sql", "weak")], resources }).steps;
    // A weak gap is 4 hours: 30 + 300 minutes cover it, so the 600-minute course is left out.
    expect(step.resourceIds).toEqual([uuid(2), uuid(1)]);
    expect(step.hours).toBe(4);
  });

  it("does not repeat a resource shared by two gaps", () => {
    const resources = [res(1, ["sql", "excel"], 600), res(2, ["excel"], 120)];
    const steps = buildPath({ ...base, weeklyHours: 10, gaps: [gap("sql"), gap("excel")], resources }).steps;
    expect(steps.map((s) => s.resourceIds)).toEqual([[uuid(1)], [uuid(2)]]);
    expect(steps.map((s) => s.hours)).toEqual([10, 2]);
  });

  it("sizes a step from its resources, capped by the gap estimate, and at least 1 hour", () => {
    const resources = [res(1, ["sql"], 50), res(2, ["excel"], 3000)];
    const steps = buildPath({ ...base, gaps: [gap("sql", "missing"), gap("excel", "weak"), gap("javascript", "outdated")], resources }).steps;
    expect(steps.map((s) => [s.skillId, s.hours])).toEqual([
      ["sql", 1],
      ["excel", 4],
      ["javascript", 6],
    ]);
  });

  it("places steps in weeks at the chosen hours and defers what would end after week 6", () => {
    // Each missing gap with no resources is 12 hours; at 3 hours a week the budget is 18 hours.
    const path = buildPath({ ...base, weeklyHours: 3, gaps: [gap("a"), gap("b", "weak"), gap("c"), gap("d", "weak")], resources: [] });
    expect(path.steps.map((s) => [s.skillId, s.week])).toEqual([
      ["a", 1],
      ["b", 5],
    ]);
    // d would fit on its own, but it waits behind c so a later step never jumps ahead of an earlier one.
    expect(path.deferredSkillIds).toEqual(["c", "d"]);
    expect(path.totalHours).toBe(16);
    expect(path.weeks).toBe(6);
  });

  it("keeps a step that ends exactly at the end of week 6", () => {
    const path = buildPath({ ...base, weeklyHours: 3, gaps: [gap("a", "outdated"), gap("b", "outdated"), gap("c", "outdated")], resources: [] });
    expect(path.steps.map((s) => s.skillId)).toEqual(["a", "b", "c"]);
    expect(path.weeks).toBe(6);
  });

  it("always keeps the first step, however long", () => {
    const path = buildPath({ ...base, weeklyHours: 3, gaps: [gap("a")], resources: [res(1, ["a"], 6000)] });
    expect(path.steps).toHaveLength(1);
  });

  it("uses the gap's explanation as the reason and the catalog's proof task, with a fallback", () => {
    const steps = buildPath({ ...base, gaps: [gap("sql"), gap("excel")], resources: [] }).steps;
    expect(steps[0].reason).toBe("Why sql matters.");
    expect(steps[0].proofTask).toBe("Write five queries against a public dataset.");
    expect(steps[1].proofTask).toContain("EXCEL");
  });

  it("rejects weekly hours outside the offered choices, an empty gap list and a repeated gap", () => {
    expect(() => buildPath({ ...base, weeklyHours: 4, gaps: [gap("sql")], resources: [] })).toThrow();
    expect(() => buildPath({ ...base, gaps: [], resources: [] })).toThrow();
    expect(() => buildPath({ ...base, gaps: [gap("sql"), gap("sql")], resources: [] })).toThrow();
  });

  it("uses the real catalog by default and finds resources for a real gap", () => {
    const path = buildPath({ weeklyHours: 5, gaps: [gap("sql")], resources: [res(1, ["sql"])] });
    expect(path.steps[0].proofTask.length).toBeGreaterThan(20);
    expect(path.steps[0].resourceIds).toEqual([uuid(1)]);
  });
});
