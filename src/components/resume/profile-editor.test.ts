import { describe, expect, it } from "vitest";
import type { Profile } from "@/lib/schemas";
import { EDITOR_SECTIONS, profileProblems, sectionSummary, sectionWithProblem } from "./profile-editor";

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
    const now = new Date("2026-10-10T00:00:00Z");
    expect(profileProblems({ ...base, certifications: [cert("2024-13", null), cert("2026-11", null), cert("2026", null)] }, now)).toEqual([
      'CISSP: write "2024-13" as YYYY or YYYY-MM, like 2024-03.',
      "CISSP: the pass date is in the future. Add it once you've passed.",
    ]);
  });
});

describe("folded editor sections (C23)", () => {
  it("sums up each closed section in one line", () => {
    const p: Profile = {
      ...base,
      headline: "Data Analyst",
      skills: [
        { name: "SQL", lastUsed: null, evidence: [] },
        { name: " ", lastUsed: null, evidence: [] },
      ],
      education: [...base.education, { qualification: "MBA", institution: "Example School", year: null }],
    };
    expect(EDITOR_SECTIONS.map((s) => sectionSummary(s, p, "3"))).toEqual(["Data Analyst · 3 years", "1 role", "1 skill", "2 degrees", "No certifications yet"]);
    expect(sectionSummary("about", base, " ")).toBe("No headline yet");
    expect(sectionSummary("about", base, "1")).toBe("No headline yet · 1 year");
  });

  it("opens the section that stops the save", () => {
    expect(sectionWithProblem(base, false)).toBeNull();
    expect(sectionWithProblem(base, true)).toBe("about");
    expect(sectionWithProblem({ ...base, roles: [{ ...base.roles[0], employer: "" }] }, false)).toBe("work");
    expect(sectionWithProblem({ ...base, education: [{ qualification: "MBA", institution: "", year: null }] }, false)).toBe("education");
    expect(sectionWithProblem({ ...base, certifications: [{ name: "CISSP", earned: "March 2024", expires: null }] }, false)).toBe("certifications");
  });
});

