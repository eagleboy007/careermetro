import { describe, expect, it } from "vitest";
import { exampleMapLine } from "@/lib/map/fixtures";
import { exampleGoals } from "@/lib/today/fixtures";
import { goalChoice, goalsSummary, jobCheckGoalRequest, mapLine, MAX_CHOICE_GOALS, userGoal } from ".";
import { MAX_GAPS } from "./gap";

// "Your choice" goals (role-suggest-plan.md part B, part 2): goals the person adds, such as from a job check.
describe("goalChoice", () => {
  it("names the job's company, or none once the check is removed", () => {
    expect(goalChoice.parse({ company: "Example Analytics Pvt Ltd" })).toEqual({ company: "Example Analytics Pvt Ltd" });
    expect(goalChoice.parse({ company: null })).toEqual({ company: null });
    expect(goalChoice.safeParse({ company: "" }).success).toBe(false);
    expect(goalChoice.safeParse({ company: "x".repeat(101) }).success).toBe(false);
  });
});

describe("userGoal", () => {
  const base = { id: "g1", skillId: "sql", source: "gap", status: "active", position: 1, proved: false };
  it("defaults to no job check and no choice, so goals from gaps read as before", () => {
    expect(userGoal.parse(base)).toMatchObject({ jobCheckId: null, choice: null, groupId: null });
  });
  it("carries a Your choice goal's job check and company", () => {
    const g = userGoal.parse({ ...base, source: "user", jobCheckId: "c1", choice: { company: "Example Analytics Pvt Ltd" } });
    expect(g.choice).toEqual({ company: "Example Analytics Pvt Ltd" });
  });
});

describe("mapLine with Your choice goals", () => {
  const choice = { ...exampleMapLine.goals[0], skillId: "data-orchestration", name: "Data pipeline orchestration", status: "missing" as const, proved: false, choice: { company: "Example Analytics Pvt Ltd" } };
  it("takes them after the gap goals", () => {
    expect(mapLine.safeParse({ ...exampleMapLine, goals: [...exampleMapLine.goals, choice] }).success).toBe(true);
    // Example data without the field still reads.
    expect(mapLine.safeParse(exampleMapLine).success).toBe(true);
  });
  it("refuses a Your choice goal before a gap goal", () => {
    expect(mapLine.safeParse({ ...exampleMapLine, goals: [choice, ...exampleMapLine.goals] }).success).toBe(false);
  });
  it(`fits every gap and ${MAX_CHOICE_GOALS} choice goals, and no more`, () => {
    const gap = { ...exampleMapLine.goals[0], choice: null };
    const goals = [...Array(MAX_GAPS).fill(gap), ...Array(MAX_CHOICE_GOALS).fill(choice)];
    expect(mapLine.safeParse({ ...exampleMapLine, goals }).success).toBe(true);
    expect(mapLine.safeParse({ ...exampleMapLine, goals: [...goals, choice] }).success).toBe(false);
  });
});

describe("goalsSummary with a Your choice goal", () => {
  it("keeps the tag on the goal", () => {
    const goals = [...exampleGoals.goals, { ...exampleGoals.goals[0], id: "choice-1", choice: { company: null } }];
    const parsed = goalsSummary.parse({ ...exampleGoals, goals });
    expect(parsed.goals.at(-1)?.choice).toEqual({ company: null });
    expect(parsed.goals[0].choice ?? null).toBeNull();
  });
});

describe("jobCheckGoalRequest", () => {
  it("takes one skill id and nothing else", () => {
    expect(jobCheckGoalRequest.parse({ skillId: "data-orchestration" })).toEqual({ skillId: "data-orchestration" });
    for (const bad of [{}, { skillId: "" }, { skillId: "../x" }, { skillId: "Power BI" }, { skillId: "sql", jobCheckId: "x" }, { skillId: "x".repeat(81) }]) {
      expect(jobCheckGoalRequest.safeParse(bad).success).toBe(false);
    }
  });
});
