import { describe, expect, it } from "vitest";
import type { Profile } from "@/lib/schemas";
import { profileProblems } from "./profile-editor";

const base: Profile = {
  headline: null,
  totalYearsExperience: null,
  roles: [{ title: "Data Analyst", employer: "Example Retail", start: "2022-06", end: null, highlights: [] }],
  skills: [],
  education: [{ qualification: "B.Com", institution: "Example University", year: "2021" }],
  certifications: [],
};

describe("profileProblems", () => {
  it("accepts a complete profile", () => {
    expect(profileProblems(base)).toEqual([]);
  });

  it("names the entry and the fix instead of dropping it", () => {
    const problems = profileProblems({
      ...base,
      roles: [{ ...base.roles[0], employer: " ", start: "Jun 2022" }],
      education: [{ qualification: "MBA", institution: "", year: null }],
    });
    expect(problems).toEqual([
      "Data Analyst: add both a title and an employer, or remove it.",
      'Data Analyst: write "Jun 2022" as YYYY or YYYY-MM, like 2022-06.',
      "MBA: add both a qualification and an institution, or remove it.",
    ]);
  });

  it("checks certificate dates", () => {
    const cert = (earned: string | null, expires: string | null) => ({ name: "CISSP", earned, expires });
    expect(profileProblems({ ...base, certifications: [cert("2024", "2024"), cert("2024-03", "none"), cert(null, null)] })).toEqual([]);
    expect(profileProblems({ ...base, certifications: [cert("March 2024", null), cert("2025-06", "2025-01"), { name: " ", earned: "2024", expires: null }] })).toEqual([
      'CISSP: write "March 2024" as YYYY or YYYY-MM, like 2024-03.',
      "CISSP: it can't expire before it was passed.",
      "Certification 3: add its name, or remove it.",
    ]);
  });
});
