import { describe, expect, it } from "vitest";
import type { Profile } from "@/lib/schemas";
import { bandOf, compareFound, findRefusal, inBands, matchesJob, passesFilters, yearsWorked } from "./find-rules";
import type { JobMatchView, MatchLineView } from "./types";

const line = (state: MatchLineView["state"], group: MatchLineView["group"] = "required"): MatchLineView => ({ label: "x", state, group });
const match = (lines: MatchLineView[]): JobMatchView => {
  const required = lines.filter((l) => l.group !== "nice");
  return {
    lines,
    requiredProved: required.filter((l) => l.state === "proved").length,
    requiredOnResume: required.filter((l) => l.state === "on_resume").length,
    requiredTotal: required.length,
  };
};
const profile = (roles: { start: string | null; end: string | null }[], total: number | null = null): Profile => ({
  headline: null,
  totalYearsExperience: total,
  roles: roles.map((r) => ({ title: "Analyst", employer: "Example Co", highlights: [], ...r })),
  skills: [],
  education: [],
  certifications: [],
});

describe("find rules (pending item 19)", () => {
  it("let Recruiter admins and Hiring HR on the job search a verified company's open jobs, never Interviewers", () => {
    const base = { role: "admin" as const, onJobTeam: false, orgStatus: "verified" as const, jobStatus: "open" };
    expect(findRefusal(base)).toBeNull();
    expect(findRefusal({ ...base, role: "hiring", onJobTeam: true })).toBeNull();
    expect(findRefusal({ ...base, role: "hiring" })).toBe("not_on_job");
    expect(findRefusal({ ...base, role: "interviewer", onJobTeam: true })).toBe("interviewer");
    expect(findRefusal({ ...base, orgStatus: "pending" })).toBe("not_verified");
    expect(findRefusal({ ...base, orgStatus: "suspended" })).toBe("not_verified");
    for (const jobStatus of ["draft", "paused", "closed"]) expect(findRefusal({ ...base, jobStatus })).toBe("job_not_open");
  });

  it("count years worked as the profile does, overlapping roles once", () => {
    const now = new Date("2026-10-13T00:00:00Z");
    expect(yearsWorked(profile([{ start: "2020-01", end: "2023-01" }, { start: "2022-01", end: "2024-01" }]), now)).toBeCloseTo(4, 1);
    expect(yearsWorked(profile([{ start: "2025-10", end: null }]), now)).toBeCloseTo(1, 1);
    // No dates: the resume's own total, else none.
    expect(yearsWorked(profile([{ start: null, end: null }], 6), now)).toBe(6);
    expect(yearsWorked(profile([]), now)).toBe(0);
  });

  it("put years in bands, and match a band only when experience shows on the profile", () => {
    expect([0, 1.9, 2, 4.99, 5, 9.9, 10, 25].map(bandOf)).toEqual(["0-2", "0-2", "2-5", "2-5", "5-10", "5-10", "10+", "10+"]);
    expect(inBands([], 3, false)).toBe(true);
    expect(inBands(["2-5"], 3, true)).toBe(true);
    expect(inBands(["2-5"], 3, false)).toBe(false);
    expect(inBands(["5-10"], 3, true)).toBe(false);
    // Several bands match any one of them.
    expect(inBands(["0-2", "5-10"], 7, true)).toBe(true);
    expect(inBands(["0-2", "5-10"], 3, true)).toBe(false);
    expect(inBands(["0-2", "5-10"], 7, false)).toBe(false);
  });

  it("filter by target roles and verified profiles, alone or together (T44)", () => {
    const analyst = { roleSlug: "data-analyst", provedSkills: 0 };
    const provedSoc = { roleSlug: "cyber-security-analyst", provedSkills: 2 };
    const none = { roles: [], verified: false };
    expect([analyst, provedSoc].map((p) => passesFilters(none, p))).toEqual([true, true]);
    expect([analyst, provedSoc].map((p) => passesFilters({ roles: ["data-analyst"], verified: false }, p))).toEqual([true, false]);
    expect([analyst, provedSoc].map((p) => passesFilters({ roles: ["data-analyst", "cyber-security-analyst"], verified: false }, p))).toEqual([true, true]);
    expect([analyst, provedSoc].map((p) => passesFilters({ roles: [], verified: true }, p))).toEqual([false, true]);
    expect([analyst, provedSoc].map((p) => passesFilters({ roles: ["data-analyst"], verified: true }, p))).toEqual([false, false]);
  });

  it("list only people who have at least one required skill, proved or on the resume", () => {
    expect(matchesJob(match([line("not_on_resume"), line("on_resume", "nice")]))).toBe(false);
    expect(matchesJob(match([line("not_on_resume"), line("on_resume", "one_of")]))).toBe(true);
    expect(matchesJob(match([line("proved")]))).toBe(true);
  });

  it("rank proved skills first, then the resume, then nice to have, then the stable ref", () => {
    const people = [
      { ref: "e", match: match([line("on_resume"), line("on_resume"), line("not_on_resume")]) },
      { ref: "a", match: match([line("proved"), line("not_on_resume"), line("not_on_resume")]) },
      { ref: "d", match: match([line("on_resume"), line("on_resume"), line("not_on_resume"), line("proved", "nice")]) },
      { ref: "c", match: match([line("proved"), line("on_resume"), line("not_on_resume")]) },
      { ref: "b", match: match([line("proved"), line("on_resume"), line("not_on_resume")]) },
    ];
    expect([...people].sort(compareFound).map((p) => p.ref)).toEqual(["b", "c", "a", "d", "e"]);
  });
});
