import { describe, expect, it } from "vitest";
import type { Profile } from "@/lib/schemas";
import { normalizeForMatch, verifyProfile } from "./verify";

const resume = `Priya Sharma
Data Analyst, Example Retail Pvt Ltd, Pune (Jun 2022 - Present)
• Wrote SQL queries for weekly sales
  reports across 40 stores
B.Com, Savitribai Phule Pune University, 2021
SKILLS: SQL, Excel, Power BI
Google Data Analytics Professional Certificate`;

const base: Profile = {
  headline: null,
  totalYearsExperience: 3,
  roles: [
    { title: "Data Analyst", employer: "Example Retail Pvt Ltd", start: "2022-06", end: null, highlights: ["Wrote SQL queries for weekly sales reports across 40 stores"] },
  ],
  skills: [{ name: "SQL", lastUsed: null, evidence: ["Wrote SQL queries for weekly sales reports across 40 stores"] }],
  education: [{ qualification: "B.Com", institution: "Savitribai Phule Pune University", year: "2021" }],
  certifications: ["Google Data Analytics Professional Certificate"],
};

describe("verifyProfile", () => {
  it("keeps a profile that the resume supports, even across line wraps and bullets", () => {
    const { profile, report } = verifyProfile(base, resume);
    expect(profile).toEqual(base);
    expect(report).toEqual({ droppedSkills: [], droppedQuotes: 0, droppedRoles: 0, droppedOther: 0 });
  });

  it("drops invented employers, quotes, skills, degrees and certifications", () => {
    const invented: Profile = {
      ...base,
      roles: [...base.roles, { title: "Senior Data Scientist", employer: "Google", start: "2020", end: "2021", highlights: [] }],
      skills: [
        { name: "SQL", lastUsed: null, evidence: ["Led a team of 10 analysts"] },
        { name: "Tableau", lastUsed: null, evidence: ["Built Tableau dashboards"] },
        { name: "Power BI", lastUsed: null, evidence: [] },
      ],
      education: [...base.education, { qualification: "MBA", institution: "IIM Ahmedabad", year: "2023" }],
      certifications: [...base.certifications, "AWS Certified Solutions Architect"],
    };
    const { profile, report } = verifyProfile(invented, resume);
    expect(profile.roles.map((r) => r.employer)).toEqual(["Example Retail Pvt Ltd"]);
    expect(profile.skills.map((s) => s.name)).toEqual(["SQL", "Power BI"]);
    expect(profile.skills[0].evidence).toEqual([]);
    expect(profile.education).toHaveLength(1);
    expect(profile.certifications).toEqual(["Google Data Analytics Professional Certificate"]);
    expect(report).toEqual({ droppedSkills: ["Tableau"], droppedQuotes: 2, droppedRoles: 1, droppedOther: 2 });
  });

  it("normalizes quotes, dashes and spacing", () => {
    expect(normalizeForMatch("  • Jun 2022 – Present’s  \n work")).toBe("jun 2022 - present's work");
  });
});
