import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { matchProfile } from "@/lib/gaps/match";
import type { PostingSkills, Profile } from "@/lib/schemas";
import { postingRole, type StoredJobCheck } from "./groups";
import { mapPostingSkills } from "./parse";
import { standInView } from "./stand-in";

const NOW = new Date("2026-10-12T10:00:00Z");

// A role our library doesn't have: the posting stands in as the target.
const fixture = JSON.parse(readFileSync("fixtures/job-postings/example-freight-supply-chain-analyst.json", "utf8")) as {
  company: string;
  title: string;
  text: string;
  skills: PostingSkills["skills"];
};
const mapped = mapPostingSkills({ skills: fixture.skills }, fixture.text);

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
    { name: "Power BI", lastUsed: null, evidence: [] },
  ],
  education: [],
  certifications: [],
};

const check: StoredJobCheck = {
  id: "c1",
  company: fixture.company,
  title: fixture.title,
  ...mapped,
  createdAt: NOW,
};
const ids = (list: { skillId: string }[]) => list.map((s) => s.skillId);

describe("the fixture posting", () => {
  it("maps to our skills, keeps unknown names and drops the invented quote", () => {
    expect(mapped.requiredSkillIds).toEqual(["sql", "excel", "data-cleaning", "statistics", "power-bi"]);
    expect(mapped.niceSkillIds).toEqual(["python", "tableau"]);
    expect(mapped.unknownSkills).toEqual(["Demand forecasting", "SAP WM"]);
    expect(mapped.dropped).toBe(1);
  });
});

describe("standInView", () => {
  it("makes the posting's required skills the gaps, with the matcher's statuses and the resume's words", () => {
    const view = standInView(check, profile, new Set(), { now: NOW });
    const match = matchProfile(profile, postingRole(check, NOW), NOW);
    expect(ids(view.gaps)).toEqual(match.gaps.map((g) => g.skillId));
    expect(ids(view.gaps)).toEqual(["data-cleaning", "statistics", "power-bi"]);
    expect(view.gaps.find((g) => g.skillId === "power-bi")).toMatchObject({ status: "weak" });
    expect(view.gaps.every((g) => g.explanation.includes("This job posting asks for"))).toBe(true);
    expect(view.met.map((m) => [m.skillId, m.status])).toEqual([
      ["sql", "met"],
      ["excel", "met"],
    ]);
    expect(view.goodToHave.map((n) => n.skillId)).toEqual(["python", "tableau"]);
    expect(view.unknown).toEqual(["Demand forecasting", "SAP WM"]);
  });

  it("says readiness in words about this job, never a bare score", () => {
    const view = standInView(check, profile, new Set(), { now: NOW });
    expect(view.readiness.headline).toBe("You cover 2 of the 5 skills this job asks for.");
    expect(view.readiness.explanation).toMatch(/about \d+ hours/);
    const all = standInView({ ...check, requiredSkillIds: ["sql", "excel"] }, profile, new Set(), { now: NOW });
    expect(all.readiness.explanation).toBe("Your resume shows every skill this posting asks for.");
  });

  it("counts accepted proof as covered", () => {
    const view = standInView(check, profile, new Set(["statistics"]), { now: NOW });
    expect(ids(view.gaps)).toEqual(["data-cleaning", "power-bi"]);
    expect(view.met.find((m) => m.skillId === "statistics")).toMatchObject({ status: "met", by: "proof" });
    expect(view.readiness.headline).toBe("You cover 3 of the 5 skills this job asks for.");
  });

  it("keeps every gap, even past the twenty a role profile may have", () => {
    const many = Array.from({ length: 30 }, (_, i) => `skill-${i}`);
    const view = standInView({ ...check, requiredSkillIds: many, niceSkillIds: [] }, profile, new Set(), { now: NOW });
    expect(view.gaps).toHaveLength(30);
  });
});
