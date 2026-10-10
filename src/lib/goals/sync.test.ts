import { describe, expect, it } from "vitest";
import type { Gap } from "@/lib/schemas";
import { planGoalSync, type ExistingGoal } from "./sync";

const gap = (skillId: string): Gap => ({ skillId, skillName: skillId, status: "missing", resumeQuote: null, requirement: "r", explanation: "e" });
const goal = (skillId: string, position: number, status: ExistingGoal["status"] = "active"): ExistingGoal => ({
  skillId,
  position,
  status,
  source: "gap",
});
const noImplies = new Map<string, string[]>();

describe("planGoalSync", () => {
  it("makes one goal per gap, in path order (a skill's prerequisite first)", () => {
    const plan = planGoalSync({
      existing: [],
      gaps: [gap("nextjs"), gap("javascript"), gap("sql")],
      metSkillIds: [],
      provedSkillIds: [],
      implies: new Map([["nextjs", ["javascript"]]]),
    });
    expect(plan.insert).toEqual([
      { skillId: "javascript", position: 1, status: "active" },
      { skillId: "nextjs", position: 2, status: "active" },
      { skillId: "sql", position: 3, status: "active" },
    ]);
    expect(plan.update).toEqual([]);
  });

  it("keeps existing goals in place and adds new gaps at the end", () => {
    const plan = planGoalSync({
      existing: [goal("sql", 1), goal("power-bi", 2)],
      gaps: [gap("python"), gap("power-bi"), gap("sql")],
      metSkillIds: [],
      provedSkillIds: [],
      implies: noImplies,
    });
    expect(plan.insert).toEqual([{ skillId: "python", position: 3, status: "active" }]);
    expect(plan.update).toEqual([]);
  });

  it("marks a goal met when a newer resume shows the skill, and leaves goals from another role alone", () => {
    const plan = planGoalSync({
      existing: [goal("sql", 1), goal("siem", 2)],
      gaps: [gap("python")],
      metSkillIds: ["sql"],
      provedSkillIds: [],
      implies: noImplies,
    });
    expect(plan.update).toEqual([{ skillId: "sql", status: "met" }]);
    expect(plan.insert).toEqual([{ skillId: "python", position: 3, status: "active" }]);
  });

  it("makes a new gap met at once when its proof was already accepted (proof carries over)", () => {
    const plan = planGoalSync({ existing: [], gaps: [gap("sql"), gap("python")], metSkillIds: [], provedSkillIds: ["sql"], implies: noImplies });
    expect(plan.insert).toEqual([
      { skillId: "sql", position: 1, status: "met" },
      { skillId: "python", position: 2, status: "active" },
    ]);
  });

  it("reopens a goal met only by an earlier resume when it is a gap again, but never a proved or skipped one", () => {
    const plan = planGoalSync({
      existing: [goal("sql", 1, "met"), goal("python", 2, "met"), goal("excel", 3, "skipped")],
      gaps: [gap("sql"), gap("python"), gap("excel")],
      metSkillIds: [],
      provedSkillIds: ["python"],
      implies: noImplies,
    });
    expect(plan.update).toEqual([{ skillId: "sql", status: "active" }]);
    expect(plan.insert).toEqual([]);
  });

  it("never touches the person's own goals", () => {
    const own: ExistingGoal = { skillId: "public-speaking", position: 1, status: "active", source: "user" };
    const plan = planGoalSync({ existing: [own], gaps: [], metSkillIds: ["public-speaking"], provedSkillIds: [], implies: noImplies });
    expect(plan).toEqual({ insert: [], update: [] });
  });
});
