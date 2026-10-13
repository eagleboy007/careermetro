import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { headingFlags } from "@/lib/schemas";
import { detectHeadings, readHeading } from "./sections";

describe("readHeading", () => {
  it("reads standard names in any case, with colons, bullets or letter spacing", () => {
    expect(readHeading("WORK EXPERIENCE")).toEqual({ key: "experience", state: "standard" });
    expect(readHeading("Education:")).toEqual({ key: "education", state: "standard" });
    expect(readHeading("• Technical Skills")).toEqual({ key: "skills", state: "standard" });
    expect(readHeading("S K I L L S")).toEqual({ key: "skills", state: "standard" });
    expect(readHeading("Skills: SQL, Excel, Power BI")).toEqual({ key: "skills", state: "standard" });
  });

  it("reads known other names as renamed", () => {
    expect(readHeading("Professional Journey")).toEqual({ key: "experience", state: "renamed" });
    expect(readHeading("Career Objective")).toEqual({ key: "summary", state: "renamed" });
    expect(readHeading("ACADEMIC BACKGROUND")).toEqual({ key: "education", state: "renamed" });
    expect(readHeading("Where I’ve worked")).toEqual({ key: "experience", state: "renamed" });
  });

  it("never reads a sentence or a label inside a job as a heading", () => {
    expect(readHeading("Built Excel dashboards with pivot tables for regional managers")).toBeNull();
    expect(readHeading("Tools: Jira, Git")).toBeNull();
    expect(readHeading("Training: onboarded 12 new analysts")).toBeNull();
    expect(readHeading("Experience with SQL and Python")).toBeNull();
    // Everyday words that also head sub-lists are never section headings.
    for (const word of ["Tools", "Training", "Learning", "Career", "Jobs", "Roles", "About", "Studies"]) expect(readHeading(word)).toBeNull();
  });
});

describe("detectHeadings", () => {
  it("finds the sample resume's standard headings", () => {
    const flags = detectHeadings(readFileSync("fixtures/resumes/priya-sharma.txt", "utf8"));
    expect(flags).toEqual({
      summary: "standard",
      experience: "standard",
      education: "standard",
      skills: "standard",
      projects: "not_found",
      certifications: "standard",
    });
    expect(headingFlags.parse(flags)).toEqual(flags);
  });

  it("marks renamed sections, and a standard heading anywhere wins", () => {
    const text = ["About Me", "Analyst.", "Professional Journey", "Analyst at Example", "Core Competencies", "SQL", "Skills", "Excel"].join("\n");
    expect(detectHeadings(text)).toMatchObject({ summary: "renamed", experience: "renamed", skills: "standard", education: "not_found" });
  });
});
