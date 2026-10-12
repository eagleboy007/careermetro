import { describe, expect, it } from "vitest";
import { resumeDocument, type Profile } from "@/lib/schemas";
import { buildResumeDocument, formatRange, resumeFileName } from "./document";

const NOW = new Date("2026-10-12T12:00:00Z");

const profile: Profile = {
  headline: "  Data analyst who turns messy sales data into weekly decisions ",
  totalYearsExperience: 3,
  roles: [
    { title: "Data Analyst", employer: "Example Retail", start: "2023-04", end: null, highlights: ["Built the weekly sales dashboard", "  "] },
    { title: "Analyst Intern", employer: "Example Bank", start: "2022", end: "2022-12", highlights: [] },
  ],
  skills: [
    { name: "SQL", lastUsed: "2026-09", evidence: [] },
    { name: "Python", lastUsed: null, evidence: [] },
    { name: "sql", lastUsed: null, evidence: [] },
  ],
  education: [{ qualification: "B.Com", institution: "Example University", year: "2022" }],
  certifications: [
    { name: "Google Data Analytics", earned: "2023-02", expires: "none" },
    { name: "Old Cloud Cert", earned: "2020-01", expires: "2023-01" },
    { name: "Undated Cert", earned: null, expires: null },
  ],
};

describe("buildResumeDocument", () => {
  const doc = buildResumeDocument(profile, " Priya  Sharma ", NOW);

  it("matches the schema", () => {
    expect(resumeDocument.parse(doc)).toEqual(doc);
  });

  it("keeps the name and headline, trimmed", () => {
    expect(doc.name).toBe("Priya Sharma");
    expect(doc.headline).toBe("Data analyst who turns messy sales data into weekly decisions");
  });

  it("uses the standard section names in reading order", () => {
    expect(doc.sections.map((s) => s.heading)).toEqual(["Experience", "Skills", "Education", "Certifications"]);
  });

  it("words the dates and drops empty highlights", () => {
    const experience = doc.sections[0];
    expect(experience.kind === "entries" && experience.entries).toEqual([
      { title: "Data Analyst", subtitle: "Example Retail", dates: "Apr 2023 – Present", bullets: ["Built the weekly sales dashboard"] },
      { title: "Analyst Intern", subtitle: "Example Bank", dates: "2022 – Dec 2022", bullets: [] },
    ]);
  });

  it("lists each skill once", () => {
    const skills = doc.sections[1];
    expect(skills.kind === "list" && skills.items).toEqual(["SQL", "Python"]);
  });

  it("says when a certification was earned and whether it is still valid", () => {
    const certs = doc.sections[3];
    expect(certs.kind === "list" && certs.items).toEqual([
      "Google Data Analytics (Feb 2023)",
      "Old Cloud Cert (Jan 2020; expired Jan 2023)",
      "Undated Cert",
    ]);
  });

  it("leaves out empty sections and a missing name", () => {
    const empty = buildResumeDocument({ headline: null, totalYearsExperience: null, roles: [], skills: [], education: [], certifications: [] }, null, NOW);
    expect(empty).toEqual({ name: null, headline: null, sections: [] });
  });

  it("says until when a certification that hasn't expired is valid", () => {
    const doc2 = buildResumeDocument({ ...profile, certifications: [{ name: "Cloud", earned: null, expires: "2027-03" }] }, null, NOW);
    expect(doc2.sections.at(-1)).toEqual({ kind: "list", heading: "Certifications", items: ["Cloud (valid until Mar 2027)"] });
  });
});

describe("formatRange", () => {
  it.each([
    [null, null, ""],
    ["2021-01", null, "Jan 2021 – Present"],
    [null, "2021", "2021"],
    ["2019-07", "2021-11", "Jul 2019 – Nov 2021"],
  ])("%s to %s reads %j", (start, end, expected) => {
    expect(formatRange(start, end)).toBe(expected);
  });
});

describe("resumeFileName", () => {
  it("names the file after the person", () => {
    expect(resumeFileName("Priya Sharma", "pdf")).toBe("priya-sharma-resume.pdf");
  });
  it("falls back to a plain name", () => {
    expect(resumeFileName(null, "docx")).toBe("resume.docx");
    expect(resumeFileName("प्रिया", "pdf")).toBe("resume.pdf");
  });
});
