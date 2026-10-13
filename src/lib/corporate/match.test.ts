import { describe, expect, it } from "vitest";
import type { Profile } from "@/lib/schemas";
import { applicationPacketFor, jobMatch, matchSummary, publicProfile } from "./match";

// Synthetic person (never a real resume).
const NOW = new Date("2026-10-13T10:00:00Z");
const HIGHLIGHT = "Ran Linux servers and Splunk SIEM dashboards for 30 branches.";
const profile: Profile = {
  headline: null,
  totalYearsExperience: 3,
  roles: [
    { title: "IT support analyst", employer: "Konkan Co-operative Bank", start: "2023-06", end: null, highlights: [HIGHLIGHT] },
    { title: "Intern", employer: "Garuda Logistics", start: "2022-01", end: "2022-06", highlights: ["Imaged 40 laptops."] },
  ],
  skills: [{ name: "Python", lastUsed: "2019", evidence: [] }],
  education: [{ qualification: "B.Sc. IT", institution: "Pune University", year: "2023" }],
  certifications: [{ name: "CompTIA Security+", earned: null, expires: null }],
};
const req = { required: ["linux", "siem", "aws"], oneOf: [["python", "bash"]], nice: ["azure"] };

describe("Match to this job", () => {
  it("reads each requirement in words from the resume sent and accepted proof, never a resume line", () => {
    const m = jobMatch(req, profile, new Set(["siem"]), NOW);
    expect(m.lines).toEqual([
      { label: "Linux command line", state: "on_resume", group: "required" },
      { label: "SIEM and log analysis", state: "proved", group: "required" },
      { label: "AWS", state: "not_on_resume", group: "required" },
      { label: expect.stringMatching(/^One of: Python, /), state: "on_resume", group: "one_of" },
      { label: "Microsoft Azure", state: "not_on_resume", group: "nice" },
    ]);
    expect(m).toMatchObject({ requiredProved: 1, requiredOnResume: 2, requiredTotal: 4 });
    expect(JSON.stringify(m)).not.toContain("branches");
    expect(matchSummary(m)).toBe("1 of 4 required proved · 2 on resume");
  });

  it("a group is proved when any of its skills is", () => {
    const m = jobMatch(req, profile, new Set(["bash"]), NOW);
    expect(m.lines.find((l) => l.group === "one_of")?.state).toBe("proved");
  });

  it("with no resume sent, only proof counts", () => {
    const m = jobMatch(req, null, new Set(["linux"]), NOW);
    expect(m.lines.map((l) => l.state)).toEqual(["proved", "not_on_resume", "not_on_resume", "not_on_resume", "not_on_resume"]);
    expect(matchSummary({ requiredProved: 0, requiredOnResume: 0, requiredTotal: 0 })).toBe("No required skills");
  });
});

describe("the public profile a company sees", () => {
  it("has job titles, employers, dates, education and certificate names, never the lines under a job", () => {
    const p = publicProfile("Priya Nair", profile, NOW);
    expect(p.name).toBe("Priya Nair");
    expect(p.headline).toBe("Working at Konkan Co-operative Bank");
    expect(p.experience[0]).toMatchObject({ title: "IT support analyst", employer: "Konkan Co-operative Bank" });
    expect(p.experience[0].dates).toMatch(/to now/);
    expect(p.education).toEqual([{ qualification: "B.Sc. IT", institution: "Pune University", year: "2023" }]);
    expect(p.certifications).toEqual(["CompTIA Security+"]);
    const text = JSON.stringify(p);
    expect(text).not.toContain("branches");
    expect(text).not.toContain("laptops");
  });

  it("says looking for a next role when no job is current, and nothing more without a resume", () => {
    expect(publicProfile("A", { ...profile, roles: [profile.roles[1]] }, NOW).headline).toBe("Looking for a next role");
    expect(publicProfile("A", null, NOW)).toEqual({ name: "A", headline: null, experience: [], education: [], certifications: [] });
  });
});

describe("the application packet (Express apply)", () => {
  const criteria = { verifiedSkills: ["siem", "aws"], certificates: ["comptia-security-plus"] };

  it("holds the public profile, Match to this job and the criteria, and nothing else", () => {
    const packet = applicationPacketFor({ name: "Priya Nair", profile, requirements: req, criteria, proved: new Set(["siem"]), certificates: new Set(["comptia-security-plus"]) }, NOW);
    expect(Object.keys(packet).sort()).toEqual(["criteria", "match", "profile"]);
    expect(Object.keys(packet.profile).sort()).toEqual(["certifications", "education", "experience", "headline", "name"]);
    expect(packet.criteria).toMatchObject({ met: 2, total: 3 });
    expect(packet.match.requiredProved).toBe(1);
    // Never a resume line, a skill's evidence, gaps or the person's goals.
    const text = JSON.stringify(packet);
    for (const never of ["branches", "laptops", "highlights", "evidence", "gaps", "goal", "lastUsed", "totalYearsExperience"]) expect(text).not.toContain(never);
  });

  it("meets nothing from the resume alone", () => {
    const packet = applicationPacketFor({ name: "Priya Nair", profile, requirements: req, criteria, proved: new Set(), certificates: new Set() }, NOW);
    // SIEM is on the resume and Security+ is a certificate on it, but neither is accepted proof.
    expect(packet.criteria.met).toBe(0);
    expect(packet.profile.certifications).toEqual(["CompTIA Security+"]);
  });
});
