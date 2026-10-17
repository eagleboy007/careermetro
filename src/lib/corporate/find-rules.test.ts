import { describe, expect, it } from "vitest";
import type { Profile } from "@/lib/schemas";
import { bandOf, companyKey, compareFound, currentJobs, findRefusal, inBands, matchesJob, nameMatches, passesFilters, passesText, worksAt, yearsWorked } from "./find-rules";
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
    const analyst = { roleSlug: "data-analyst", city: null, provedSkills: 0 };
    const provedSoc = { roleSlug: "cyber-security-analyst", city: "Pune", provedSkills: 2 };
    const none = { roles: [], cities: [], verified: false };
    expect([analyst, provedSoc].map((p) => passesFilters(none, p))).toEqual([true, true]);
    expect([analyst, provedSoc].map((p) => passesFilters({ ...none, roles: ["data-analyst"] }, p))).toEqual([true, false]);
    expect([analyst, provedSoc].map((p) => passesFilters({ ...none, roles: ["data-analyst", "cyber-security-analyst"] }, p))).toEqual([true, true]);
    expect([analyst, provedSoc].map((p) => passesFilters({ ...none, verified: true }, p))).toEqual([false, true]);
    expect([analyst, provedSoc].map((p) => passesFilters({ ...none, roles: ["data-analyst"], verified: true }, p))).toEqual([false, false]);
    // A city matches only people who gave one of the chosen cities.
    expect([analyst, provedSoc].map((p) => passesFilters({ ...none, cities: ["Pune", "Kochi"] }, p))).toEqual([false, true]);
    expect([analyst, provedSoc].map((p) => passesFilters({ ...none, cities: ["Kochi"] }, p))).toEqual([false, false]);
    expect([analyst, provedSoc].map((p) => passesFilters({ roles: ["cyber-security-analyst"], cities: ["Pune"], verified: true }, p))).toEqual([false, true]);
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

  it("find a name from the start of each word typed, ignoring case, dots and accents", () => {
    expect(nameMatches("priya", "Priya Nair")).toBe(true);
    expect(nameMatches("Pri  NAI", "Priya Nair")).toBe(true);
    expect(nameMatches("nair priya", "Priya Nair")).toBe(true);
    expect(nameMatches("riya", "Priya Nair")).toBe(false);
    expect(nameMatches("priya sharma", "Priya Nair")).toBe(false);
    expect(nameMatches("zoe", "Zoë D'Souza")).toBe(true);
    expect(nameMatches("d souza", "Zoë D'Souza")).toBe(true);
    expect(nameMatches("priya", null)).toBe(false);
  });

  it("read the current employer from open jobs, else the latest one, and compare companies without Pvt Ltd", () => {
    const p = (roles: { employer: string; title?: string; start: string | null; end: string | null }[]) =>
      ({ headline: null, totalYearsExperience: null, roles: roles.map((r) => ({ title: "Analyst", highlights: [], ...r })), skills: [], education: [], certifications: [] }) as Profile;
    expect(currentJobs(p([{ employer: "A", start: "2020", end: "2022" }, { employer: "B", start: "2022", end: null }])).map((r) => r.employer)).toEqual(["B"]);
    expect(currentJobs(p([{ employer: "A", start: "2020", end: "2024-03" }, { employer: "B", start: "2018", end: "2020" }])).map((r) => r.employer)).toEqual(["A"]);
    expect(currentJobs(p([]))).toEqual([]);
    expect(companyKey("Example Labs Pvt. Ltd.")).toBe("example labs");
    const atLabs = p([{ employer: "Example Labs Private Limited", start: "2023", end: null }]);
    expect(worksAt(atLabs, ["Example Labs", null])).toBe(true);
    expect(worksAt(atLabs, ["Other Co", "Other Company Pvt Ltd"])).toBe(false);
    // Only the current job: someone who left Example Labs before their latest job isn't hidden from it.
    expect(worksAt(p([{ employer: "Example Labs", start: "2019", end: "2021" }, { employer: "Garuda", start: "2021", end: null }]), ["Example Labs"])).toBe(false);
    // A company name made only of legal-form words never matches anyone.
    expect(worksAt(p([{ employer: "Pvt Ltd", start: "2023", end: null }]), ["Private Limited"])).toBe(false);
    // The employer as people write it: a unit, a country or the initials still hide them from the company (T54).
    const at = (employer: string) => p([{ employer, start: "2023", end: null }]);
    expect(worksAt(at("Infosys BPM"), ["Infosys Limited"])).toBe(true);
    expect(worksAt(at("Example Labs India"), ["Example Labs"])).toBe(true);
    expect(worksAt(at("TCS"), ["Tata Consultancy Services"])).toBe(true);
    expect(worksAt(at("Tata Consultancy Services"), ["TCS Ltd"])).toBe(true);
    expect(worksAt(at("Wipro Technologies"), ["Wipro"])).toBe(true);
    // A brand run together is hidden like the company search finds it (T71).
    expect(worksAt(at("HCLTech"), ["HCL Technologies Limited"])).toBe(true);
    expect(worksAt(at("InfosysBPM"), ["Infosys"])).toBe(true);
    for (const [employer, company] of [["HCLTech", "HCL"], ["InfosysBPM", "Infosys"]] as const)
      expect(passesText({ name: "", title: "", company }, { name: null, aim: null, profile: at(employer), experienceShown: true })).toBe(worksAt(at(employer), [company]));
    // Different companies that share a common word stay apart.
    expect(worksAt(at("Tata Steel"), ["Tata Consultancy Services"])).toBe(false);
    expect(worksAt(at("Global Services India"), ["Garuda Global"])).toBe(false);
    expect(worksAt(at("Infotech Systems"), ["Infosys"])).toBe(false);
    // Run together only counts at the start of a one-word name (T72).
    expect(worksAt(at("Coca-Cola India"), ["Ola"])).toBe(false);
    expect(worksAt(at("CocaCola"), ["Ola Cabs"])).toBe(false);
    expect(worksAt(at("Ola Cabs"), ["CocaCola"])).toBe(false);
    expect(worksAt(at("HCL Tech"), ["HCLTech"])).toBe(true);
    expect(worksAt(at("Airtel"), ["Air India"])).toBe(true);
  });

  it("search by name, name + role, and name + role + company, never by a part the person hid", () => {
    const profile = {
      headline: null,
      totalYearsExperience: 3,
      roles: [{ title: "Security operations analyst", employer: "Garuda Logistics Pvt Ltd", start: "2023-04", end: null, highlights: [] }],
      skills: [],
      education: [],
      certifications: [],
    } as Profile;
    const arjun = { name: "Arjun Mehta", aim: "Cyber Security Analyst", profile, experienceShown: true };
    const q = (name: string, title = "", company = "") => ({ name, title, company });
    expect(passesText(q(""), arjun)).toBe(true);
    expect(passesText(q("arjun"), arjun)).toBe(true);
    expect(passesText(q("arjun", "security analyst"), arjun)).toBe(true);
    expect(passesText(q("arjun", "operations"), arjun)).toBe(true);
    expect(passesText(q("arjun", "data analyst"), arjun)).toBe(false);
    expect(passesText(q("arjun", "operations", "garuda"), arjun)).toBe(true);
    expect(passesText(q("arjun", "", "Garuda Logistics Ltd"), arjun)).toBe(true);
    expect(passesText(q("arjun", "operations", "konkan"), arjun)).toBe(false);
    // With experience hidden, the job title and employer aren't searchable; the target role still is.
    const hidden = { ...arjun, experienceShown: false };
    expect(passesText(q("arjun", "operations"), hidden)).toBe(false);
    expect(passesText(q("arjun", "cyber security"), hidden)).toBe(true);
    expect(passesText(q("arjun", "", "garuda"), hidden)).toBe(false);
  });
});
