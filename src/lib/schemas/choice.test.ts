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
  it("keeps them off the main line, in their own list", () => {
    expect(mapLine.safeParse({ ...exampleMapLine, choiceGoals: [choice] }).success).toBe(true);
    // Example data without the field still reads.
    expect(mapLine.safeParse(exampleMapLine).success).toBe(true);
    expect(mapLine.safeParse({ ...exampleMapLine, goals: [...exampleMapLine.goals, choice] }).success).toBe(false);
    expect(mapLine.safeParse({ ...exampleMapLine, choiceGoals: [{ ...choice, choice: null }] }).success).toBe(false);
  });
  it(`fits ${MAX_CHOICE_GOALS} choice goals beside every gap, and no more`, () => {
    const goals = Array(MAX_GAPS).fill({ ...exampleMapLine.goals[0], choice: null });
    const choiceGoals = Array(MAX_CHOICE_GOALS).fill(choice);
    expect(mapLine.safeParse({ ...exampleMapLine, goals, choiceGoals }).success).toBe(true);
    expect(mapLine.safeParse({ ...exampleMapLine, goals, choiceGoals: [...choiceGoals, choice] }).success).toBe(false);
  });
});

describe("goalsSummary with a Your choice goal", () => {
  const chosen = { ...exampleGoals.goals[0], id: "choice-1", choice: { company: null }, pitstops: exampleGoals.goals[0].pitstops.map((p) => ({ ...p, state: "ahead" as const })) };
  it("lists them apart from the line's goals, tagged", () => {
    const parsed = goalsSummary.parse({ ...exampleGoals, choiceGoals: [chosen] });
    expect(parsed.choiceGoals?.[0].choice).toEqual({ company: null });
    expect(parsed.goals.every((g) => (g.choice ?? null) === null)).toBe(true);
  });
  it("never puts the train on a Your choice goal, and refuses an untagged one", () => {
    const now = { ...chosen, pitstops: [{ ...chosen.pitstops[0], state: "now" as const }] };
    expect(goalsSummary.safeParse({ ...exampleGoals, choiceGoals: [now] }).success).toBe(false);
    expect(goalsSummary.safeParse({ ...exampleGoals, choiceGoals: [{ ...chosen, choice: null }] }).success).toBe(false);
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
