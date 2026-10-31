import { describe, expect, it } from "vitest";
import { exampleOwnMapLine } from "@/lib/map/fixtures";
import { OWN_PITSTOPS_PER_GOAL } from "@/lib/schemas";
import { addableGoals, goalKey } from "./own-pitstops";

// Add a pitstop on the Map (FR-58): which goals the form offers.
describe("addableGoals", () => {
  const goals = exampleOwnMapLine.goals;
  it("offers open goals only: never a proved or skipped one", () => {
    const open = addableGoals(goals, true).map((g) => g.skillId);
    expect(open).toEqual(goals.filter((g) => !g.proved).map((g) => g.skillId));
    const skipped = goals.map((g) => (g.skillId === "power-bi" ? { ...g, skipped: true } : g));
    expect(addableGoals(skipped, true).map((g) => g.skillId)).not.toContain("power-bi");
  });
  it("needs a saved goal outside example data, and stops at the limit a goal", () => {
    expect(addableGoals(goals, false)).toEqual([]);
    const saved = goals.map((g) => ({ ...g, goalId: `g-${g.skillId}` }));
    expect(addableGoals(saved, false).length).toBe(goals.filter((g) => !g.proved).length);
    const full = { ...saved[3], ownPitstops: Array(OWN_PITSTOPS_PER_GOAL).fill({ id: "p", title: "Labs", course: null }) };
    expect(addableGoals([full], false)).toEqual([]);
  });
  it("picks a goal by its id, or by its skill in example data", () => {
    expect(goalKey(goals[3])).toBe(goals[3].skillId);
    expect(goalKey({ ...goals[3], goalId: "g1" })).toBe("g1");
  });
});
