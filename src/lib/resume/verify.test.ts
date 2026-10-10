import { describe, expect, it } from "vitest";
import type { Profile } from "@/lib/schemas";
import { containsPhrase, normalizeForMatch, verifyProfile } from "./verify";

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
  certifications: [{ name: "Google Data Analytics Professional Certificate", earned: null, expires: null }],
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
      certifications: [...base.certifications, { name: "AWS Certified Solutions Architect", earned: null, expires: null }],
    };
    const { profile, report } = verifyProfile(invented, resume);
    expect(profile.roles.map((r) => r.employer)).toEqual(["Example Retail Pvt Ltd"]);
    expect(profile.skills.map((s) => s.name)).toEqual(["SQL", "Power BI"]);
    expect(profile.skills[0].evidence).toEqual([]);
    expect(profile.education).toHaveLength(1);
    expect(profile.certifications).toEqual(base.certifications);
    expect(report).toEqual({ droppedSkills: ["Tableau"], droppedQuotes: 2, droppedRoles: 1, droppedOther: 2 });
  });

  it("keeps a certificate's dates only when its line shows them", () => {
    const text = `B.Com, Savitribai Phule Pune University, 2021
Google Data Analytics Professional Certificate
CISSP, Mar 2024, valid till 2027
AWS Cloud Practitioner (2023) - no expiry
Tableau Desktop Specialist, lifetime`;
    const certs: Profile["certifications"] = [
      // 2021 is printed on the line above, for the degree: not this certificate's year.
      { name: "Google Data Analytics Professional Certificate", earned: "2021", expires: "none" },
      { name: "CISSP", earned: "2024-03", expires: "2027" },
      { name: "AWS Cloud Practitioner", earned: "2023", expires: "2026" },
      { name: "Tableau Desktop Specialist", earned: null, expires: "none" },
    ];
    const { profile } = verifyProfile({ ...base, roles: [], skills: [], education: [], certifications: certs }, text);
    expect(profile.certifications).toEqual([
      { name: "Google Data Analytics Professional Certificate", earned: null, expires: null },
      { name: "CISSP", earned: "2024-03", expires: "2027" },
      { name: "AWS Cloud Practitioner", earned: "2023", expires: null },
      { name: "Tableau Desktop Specialist", earned: null, expires: "none" },
    ]);
  });

  it("never takes a date from the next certificate, an expiry, the name, or a month the resume doesn't print", () => {
    const text = `CISSP
CISA 2019
CISM, valid till 2028
PMP
Certified ScrumMaster 2021-2023
ISO/IEC 27001:2013 Lead Auditor
Azure Fundamentals, Mar 2024
AWS Cloud Practitioner 2022`;
    const c = (name: string, earned: string | null, expires: string | null = null) => ({ name, earned, expires });
    const certs = [
      c("CISSP", "2019"),
      c("CISA", "2019-07"),
      c("CISM", "2028", "2028"),
      c("PMP", "2021", "2023"),
      c("Certified ScrumMaster", "2021", "2023"),
      c("ISO/IEC 27001:2013 Lead Auditor", "2013"),
      c("Azure Fundamentals", "2024-03"),
      c("AWS Cloud Practitioner", "2022-01"),
    ];
    const { profile } = verifyProfile({ ...base, roles: [], skills: [], education: [], certifications: certs }, text);
    expect(profile.certifications).toEqual([
      c("CISSP", null),
      c("CISA", "2019"),
      c("CISM", null, "2028"),
      c("PMP", null, null),
      c("Certified ScrumMaster", "2021", "2023"),
      c("ISO/IEC 27001:2013 Lead Auditor", null),
      c("Azure Fundamentals", "2024-03"),
      c("AWS Cloud Practitioner", "2022"),
    ]);
  });

  it("matches skills and employers as whole words only", () => {
    const parsed: Profile = {
      ...base,
      roles: [...base.roles, { title: "Data Analyst", employer: "Example", start: null, end: null, highlights: [] }],
      skills: [
        { name: "Go", lastUsed: null, evidence: [] },
        { name: "Excel", lastUsed: null, evidence: [] },
      ],
    };
    const { profile, report } = verifyProfile(parsed, resume);
    expect(profile.skills.map((s) => s.name)).toEqual(["Excel"]);
    expect(report.droppedSkills).toEqual(["Go"]);
    expect(profile.roles).toHaveLength(2);
  });

  it("pairs a title only with an employer printed next to it", () => {
    const text = `Data Analyst
Example Retail Pvt Ltd, 2022 - Present
Built reports

Projects
Weekly dashboards
Monthly reviews
Store visits
Stock reports
Volunteer at Pune Food Bank
Sales forecasts`;
    const parsed: Profile = {
      ...base,
      roles: [
        { title: "Data Analyst", employer: "Example Retail Pvt Ltd", start: null, end: null, highlights: [] },
        { title: "Data Analyst", employer: "Pune Food Bank", start: null, end: null, highlights: [] },
      ],
      skills: [],
      education: [],
      certifications: [],
    };
    const { profile, report } = verifyProfile(parsed, text);
    expect(profile.roles.map((r) => r.employer)).toEqual(["Example Retail Pvt Ltd"]);
    expect(report.droppedRoles).toBe(1);
  });

  it("keeps roles from common Indian resume layouts", () => {
    const text = `Infosys Limited
Bengaluru, Karnataka
Jan 2020 - Present
Senior Systems Engineer
- Migrated 40 batch jobs to Spark
- Cut nightly run time by 2 hours
- Mentored 3 new joiners
- Wrote runbooks for the support team
- Automated release notes
Systems Engineer
- Supported the payments platform
Tata Consultancy Services Ltd.
Pune | Jun 2018 - Dec 2019
Assistant Systems Engineer`;
    const role = (title: string, employer: string) => ({ title, employer, start: null, end: null, highlights: [] });
    const parsed: Profile = {
      ...base,
      roles: [
        role("Senior Systems Engineer", "Infosys Limited"),
        role("Systems Engineer", "Infosys Limited"),
        role("Assistant Systems Engineer", "Tata Consultancy Services Ltd"),
        role("Team Lead", "Infosys Limited"),
      ],
      skills: [],
      education: [],
      certifications: [],
    };
    const { profile, report } = verifyProfile(parsed, text);
    expect(profile.roles.map((r) => r.title)).toEqual(["Senior Systems Engineer", "Systems Engineer", "Assistant Systems Engineer"]);
    expect(report.droppedRoles).toBe(1);
  });

  it("matches ligatures, styled letters and letters outside the BMP", () => {
    expect(containsPhrase(normalizeForMatch("AWS Certiﬁed"), normalizeForMatch("aws certified"))).toBe(true);
    expect(containsPhrase(normalizeForMatch("𝐏𝐲𝐭𝐡𝐨𝐧, SQL"), "python")).toBe(true);
    expect(containsPhrase("𝒜go", "go")).toBe(false);
  });

  it("treats symbol edges such as C++ and .NET as boundaries", () => {
    expect(containsPhrase("c++, .net and go", "c++")).toBe(true);
    expect(containsPhrase("worked in .net core", ".net")).toBe(true);
    expect(containsPhrase("javascript", "java")).toBe(false);
    expect(containsPhrase("java, javascript", "java")).toBe(true);
    expect(containsPhrase("डेटा विश्लेषण", "डेटा")).toBe(true);
    expect(containsPhrase("डेटा", "डेट")).toBe(false);
  });

  it("normalizes quotes, dashes and spacing", () => {
    expect(normalizeForMatch("  • Jun 2022 – Present’s  \n work")).toBe("jun 2022 - present's work");
  });
});
