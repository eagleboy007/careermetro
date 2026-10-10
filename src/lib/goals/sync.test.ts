import { describe, expect, it } from "vitest";
import type { Gap } from "@/lib/schemas";
import { planGoalSync, type ExistingGoal } from "./sync";

const gap = (skillId: string): Gap => ({
  skillId,
  skillName: skillId,
  status: "missing",
  resumeQuote: null,
  requirement: "r",
  explanation: "e",
});
const goal = (
  skillId: string,
  position: number,
  status: ExistingGoal["status"] = "active",
): ExistingGoal => ({
  skillId,
  position,
  status,
  source: "gap",
  groupId: null,
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
      { skillId: "javascript", position: 1, status: "active", groupId: null },
      { skillId: "nextjs", position: 2, status: "active", groupId: null },
      { skillId: "sql", position: 3, status: "active", groupId: null },
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
    expect(plan.insert).toEqual([
      { skillId: "python", position: 3, status: "active", groupId: null },
    ]);
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
    expect(plan.insert).toEqual([
      { skillId: "python", position: 3, status: "active", groupId: null },
    ]);
  });

  it("makes a new gap met at once when its proof was already accepted (proof carries over)", () => {
    const plan = planGoalSync({
      existing: [],
      gaps: [gap("sql"), gap("python")],
      metSkillIds: [],
      provedSkillIds: ["sql"],
      implies: noImplies,
    });
    expect(plan.insert).toEqual([
      { skillId: "sql", position: 1, status: "met", groupId: null },
      { skillId: "python", position: 2, status: "active", groupId: null },
    ]);
  });

  it("reopens a goal met only by an earlier resume when it is a gap again, but never a proved or skipped one", () => {
    const plan = planGoalSync({
      existing: [
        goal("sql", 1, "met"),
        goal("python", 2, "met"),
        goal("excel", 3, "skipped"),
      ],
      gaps: [gap("sql"), gap("python"), gap("excel")],
      metSkillIds: [],
      provedSkillIds: ["python"],
      implies: noImplies,
    });
    expect(plan.update).toEqual([{ skillId: "sql", status: "active" }]);
    expect(plan.insert).toEqual([]);
  });

  it("never touches the person's own goals", () => {
    const own: ExistingGoal = {
      skillId: "public-speaking",
      position: 1,
      status: "active",
      source: "user",
      groupId: null,
    };
    const plan = planGoalSync({
      existing: [own],
      gaps: [],
      metSkillIds: ["public-speaking"],
      provedSkillIds: [],
      implies: noImplies,
    });
    expect(plan).toEqual({ insert: [], update: [] });
  });

  describe("one of these groups", () => {
    const members = new Map([["cloud", ["aws", "azure", "gcp"]]]);
    const groupGap = (skillId: string): Gap => ({
      ...gap(skillId),
      groupId: "cloud",
    });
    const groupGoal = (
      skillId: string,
      status: ExistingGoal["status"] = "active",
    ): ExistingGoal => ({ ...goal(skillId, 1, status), groupId: "cloud" });
    const plan = (
      existing: ExistingGoal[],
      gaps: Gap[],
      met: string[] = [],
      proved: string[] = [],
    ) =>
      planGoalSync({
        existing,
        gaps,
        metSkillIds: met,
        provedSkillIds: proved,
        implies: noImplies,
        members,
      });

    it("makes one goal for a group gap and marks it with the group", () => {
      expect(plan([], [groupGap("aws")]).insert).toEqual([
        { skillId: "aws", position: 1, status: "active", groupId: "cloud" },
      ]);
    });

    it("fills a group goal with proof of any skill in the group", () => {
      expect(plan([], [groupGap("aws")], [], ["gcp"]).insert[0].status).toBe(
        "met",
      );
      expect(plan([groupGoal("aws")], [], [], ["azure"]).update).toEqual([
        { skillId: "aws", status: "met" },
      ]);
    });

    it("meets a group goal when a newer resume shows another skill of the group", () => {
      expect(plan([groupGoal("aws")], [], ["azure"]).update).toEqual([
        { skillId: "aws", status: "met" },
      ]);
    });

    it("moves the group's goal to the skill the gap now suggests, so the gap and its goal stay paired", () => {
      const p = plan([groupGoal("aws", "met")], [groupGap("azure")]);
      expect(p.insert).toEqual([]);
      expect(p.update).toEqual([
        { skillId: "aws", status: "active", moveTo: "azure" },
      ]);
    });

    it("brings an existing goal for the suggested skill into the group, so proof of another skill fills it", () => {
      const own = goal("aws", 1);
      expect(plan([own], [groupGap("aws")]).update).toEqual([
        { skillId: "aws", groupId: "cloud" },
      ]);
      expect(plan([own], [groupGap("aws")], [], ["gcp"]).update).toEqual([
        { skillId: "aws", status: "met", groupId: "cloud" },
      ]);
    });

    it("treats a group goal as its own skill when the group is unknown", () => {
      const p = planGoalSync({
        existing: [groupGoal("aws")],
        gaps: [],
        metSkillIds: ["azure"],
        provedSkillIds: [],
        implies: noImplies,
      });
      expect(p.update).toEqual([]);
    });
  });
});
