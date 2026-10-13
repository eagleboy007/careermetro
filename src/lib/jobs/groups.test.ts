import { describe, expect, it } from "vitest";
import { roleProfiles } from "@/content";
import { buildGapAnalysis } from "@/lib/gaps/analysis";
import { matchProfile } from "@/lib/gaps/match";
import type { GapAnalysis, Profile } from "@/lib/schemas";
import { inPathOrder, jobCheckView, postingRole, type StoredJobCheck } from "./groups";

const NOW = new Date("2026-10-12T10:00:00Z");
const dataAnalyst = roleProfiles.find((r) => r.slug === "data-analyst")!;

// The sample profile the stand-in Claude API returns (e2e/mock-ai.mjs): SQL, Excel and Python used, Power BI only
// listed. Against Data Analyst its gaps are Statistics and Data cleaning.
const profile: Profile = {
  headline: "Data Analyst",
  totalYearsExperience: 3,
  roles: [
    {
      title: "Data Analyst",
      employer: "Example Retail Pvt Ltd",
      start: "2022-06",
      end: null,
      highlights: ["Wrote SQL queries for weekly sales reports across 40 stores", "Built Excel dashboards with pivot tables for regional managers"],
    },
  ],
  skills: [
    { name: "SQL", lastUsed: null, evidence: ["Wrote SQL queries for weekly sales reports across 40 stores"] },
    { name: "Excel", lastUsed: null, evidence: ["Built Excel dashboards with pivot tables for regional managers"] },
    { name: "Python", lastUsed: "2022-05", evidence: ["Used Python (pandas) to merge vendor files"] },
    { name: "Power BI", lastUsed: null, evidence: [] },
  ],
  education: [],
  certifications: [],
};
const target = buildGapAnalysis(matchProfile(profile, dataAnalyst, NOW), null);

const check = (over: Partial<StoredJobCheck> = {}): StoredJobCheck => ({
  id: "c1",
  company: "Example Analytics Pvt Ltd",
  title: "Data Analyst",
  requiredSkillIds: ["sql", "excel", "python", "statistics", "power-bi", "data-orchestration"],
  niceSkillIds: ["tableau", "git"],
  unknownSkills: ["Alteryx"],
  createdAt: NOW,
  ...over,
});
const ids = (list: { skillId: string }[]) => list.map((s) => s.skillId);

describe("postingRole", () => {
  it("makes the posting a role: required and nice skills, no shares, no groups", () => {
    const role = postingRole(check({ niceSkillIds: ["tableau", "sql"] }), NOW);
    expect(role.skills.map((s) => [s.skillId, s.importance])).toEqual([
      ["sql", "required"],
      ["excel", "required"],
      ["python", "required"],
      ["statistics", "required"],
      ["power-bi", "required"],
      ["data-orchestration", "required"],
      ["tableau", "nice_to_have"],
    ]);
    expect(role.skills.every((s) => s.postingShare === null && s.expectation.length > 0)).toBe(true);
    expect(role.groups).toEqual([]);
    expect(role.sources).toHaveLength(1);
  });
});

describe("jobCheckView", () => {
  it("sorts the posting into covered, your goals, only this job and not asked", () => {
    expect(ids(target.gaps)).toEqual(["statistics", "data-cleaning"]);
    const view = jobCheckView(check(), profile, target, new Set(), { now: NOW });
    expect(view.covered).toEqual([
      { skillId: "sql", skillName: "SQL", by: "resume" },
      { skillId: "excel", skillName: "Excel", by: "resume" },
      { skillId: "python", skillName: "Python", by: "resume" },
    ]);
    expect(view.alsoGoals).toEqual([{ skillId: "statistics", skillName: "Statistics", status: "missing" }]);
    // Power BI is only good to have for the target role, so here it is a gap of this job alone.
    expect(view.onlyThisJob.map((s) => [s.skillId, s.status])).toEqual([
      ["power-bi", "weak"],
      ["data-orchestration", "missing"],
    ]);
    expect(ids(view.notAsked)).toEqual(["data-cleaning"]);
    expect(ids(view.goodToHave).sort()).toEqual(["git", "tableau"]);
    expect(view.goodToHave.every((s) => s.status === "missing")).toBe(true);
    expect(view.unknown).toEqual(["Alteryx"]);
    expect(view.createdAt).toBe(NOW.toISOString());
  });

  it("never scores nice-to-haves or unknown skills as gaps", () => {
    const view = jobCheckView(check({ requiredSkillIds: [], niceSkillIds: ["statistics"], unknownSkills: ["SAS"] }), profile, target, new Set(), { now: NOW });
    expect([...view.covered, ...view.alsoGoals, ...view.onlyThisJob]).toEqual([]);
    expect(ids(view.goodToHave)).toEqual(["statistics"]);
    // A target gap the posting names, even as good to have, is mentioned: it isn't "not asked".
    expect(ids(view.notAsked)).not.toContain("statistics");
  });

  it("counts accepted proof as covered, for required and good-to-have skills", () => {
    const view = jobCheckView(check(), profile, target, new Set(["statistics", "data-orchestration", "tableau"]), { now: NOW });
    expect(view.covered).toContainEqual({ skillId: "statistics", skillName: "Statistics", by: "proof" });
    expect(view.covered).toContainEqual({ skillId: "data-orchestration", skillName: expect.any(String), by: "proof" });
    expect(view.alsoGoals).toEqual([]);
    expect(ids(view.onlyThisJob)).toEqual(["power-bi"]);
    expect(view.goodToHave.find((s) => s.skillId === "tableau")?.status).toBe("met");
  });

  it("leaves out a context skill the resume doesn't show, as the matcher does", () => {
    const view = jobCheckView(check({ requiredSkillIds: ["communication", "sql"] }), profile, target, new Set(), { now: NOW });
    expect(ids(view.covered)).toEqual(["sql"]);
    expect([...view.alsoGoals, ...view.onlyThisJob]).toEqual([]);
  });

  it("treats a skill of a target 'one of these' group as one of the person's goals", () => {
    const grouped: Pick<GapAnalysis, "gaps"> = {
      gaps: [{ skillId: "aws", skillName: "A cloud platform", status: "missing", resumeQuote: null, requirement: "r", explanation: "e", groupId: "cloud" }],
    };
    const members = new Map([["cloud", ["aws", "azure", "gcp"]]]);
    const view = jobCheckView(check({ requiredSkillIds: ["azure"], niceSkillIds: [] }), profile, grouped, new Set(), { now: NOW, members });
    expect(ids(view.alsoGoals)).toEqual(["azure"]);
    expect(view.notAsked).toEqual([]);
    const other = jobCheckView(check({ requiredSkillIds: ["docker"], niceSkillIds: [] }), profile, grouped, new Set(), { now: NOW, members });
    expect(ids(other.onlyThisJob)).toEqual(["docker"]);
    expect(other.notAsked).toEqual([{ skillId: "aws", skillName: "A cloud platform" }]);
  });

  it("gives the same groups for the same inputs", () => {
    expect(jobCheckView(check(), profile, target, new Set(), { now: NOW })).toEqual(jobCheckView(check(), profile, target, new Set(), { now: NOW }));
  });
});

describe("inPathOrder", () => {
  it("puts a job's goals in the path's order, and goals the path left for later after them in the check's order", () => {
    const s = (skillId: string) => ({ skillId });
    expect(inPathOrder([s("c"), s("x"), s("a"), s("y"), s("b")], ["a", "b", "c"]).map((g) => g.skillId)).toEqual(["a", "b", "c", "x", "y"]);
    expect(inPathOrder([s("x"), s("y")], [])).toEqual([s("x"), s("y")]);
  });
});
