import { describe, expect, it } from "vitest";
import { roleProfiles } from "@/content";
import { matchProfile } from "@/lib/gaps/match";
import { postingRole } from "@/lib/jobs/groups";
import { screeningView, type Profile, type ResumeScreening, type ScreeningView } from "@/lib/schemas";
import { buildScreeningView, headingsView, layoutView, missingKeywords, screeningSummary } from "./screening";

const now = new Date("2026-10-13T00:00:00Z");
const role = (slug: string) => roleProfiles.find((r) => r.slug === slug)!;

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
  ],
  education: [{ qualification: "B.Com", institution: "Example University", year: "2021" }],
  certifications: [],
};

const allStandard = { summary: "standard", experience: "standard", education: "standard", skills: "standard", projects: "not_found", certifications: "not_found" } as const;
const stored = (patch: Partial<ResumeScreening> = {}): ResumeScreening => ({
  version: 1,
  layout: { fileType: "docx", tables: 0, columns: false, images: 0, textBoxes: 0, headerFooterText: false },
  headings: allStandard,
  ...patch,
});

describe("missingKeywords", () => {
  it("lists exactly the Gaps matcher's missing required skills, never weak or met ones", () => {
    const da = role("data-analyst");
    const { asked, missing } = missingKeywords(profile, da, now);
    const match = matchProfile(profile, da, now);
    expect(asked).toBe(match.readiness.requiredTotal);
    expect(missing.map((k) => k.skillId)).toEqual(match.gaps.filter((g) => g.status === "missing").map((g) => g.skillId));
    expect(missing.map((k) => k.skillId)).not.toContain("sql");
    expect(missing.map((k) => k.skillId)).toContain("python");
  });

  it("stops listing a skill once the person confirms it, which leaves it a weak gap", () => {
    const da = role("data-analyst");
    const confirmed: Profile = { ...profile, skills: [...profile.skills, { name: "Python", lastUsed: null, evidence: [] }] };
    expect(missingKeywords(confirmed, da, now).missing.map((k) => k.skillId)).not.toContain("python");
    expect(matchProfile(confirmed, da, now).gaps.find((g) => g.skillId === "python")?.status).toBe("weak");
  });

  it("offers every skill of a missing 'one of these' group", () => {
    const cloud = role("cloud-engineer");
    const { missing } = missingKeywords(profile, cloud, now);
    const group = missing.find((k) => k.options.length > 1);
    expect(group?.options.map((o) => o.skillId).sort()).toEqual(["aws", "azure", "gcp"]);
  });

  it("works for a pasted job through the same matcher", () => {
    const job = postingRole({ requiredSkillIds: ["sql", "tableau", "statistics"], niceSkillIds: ["dbt"] }, now);
    const { asked, missing } = missingKeywords(profile, job, now);
    expect(asked).toBe(3);
    expect(missing.map((k) => k.skillId)).toEqual(["tableau", "statistics"]);
  });
});

describe("layoutView", () => {
  it("never guesses for a resume uploaded before the check", () => {
    expect(layoutView(null)).toEqual({ state: "unknown" });
    expect(headingsView(null, profile)).toEqual({ state: "unknown" });
  });

  it("says pasted text has no layout", () => {
    expect(layoutView(stored({ layout: "pasted" }))).toEqual({ state: "pasted" });
    expect(layoutView(stored({ layout: "unread" }))).toEqual({ state: "unknown" });
  });

  it("lists what was found and what a PDF can't tell", () => {
    expect(layoutView(stored({ layout: { fileType: "pdf", tables: null, columns: true, images: 2, textBoxes: null, headerFooterText: null } }))).toEqual({
      state: "checked",
      fileType: "pdf",
      issues: [
        { kind: "columns", count: null },
        { kind: "images", count: 2 },
      ],
      unchecked: ["tables", "text_boxes", "header_footer"],
    });
    expect(layoutView(stored({ layout: { fileType: "docx", tables: 1, columns: false, images: 0, textBoxes: 0, headerFooterText: true } }))).toMatchObject({
      issues: [
        { kind: "tables", count: 1 },
        { kind: "header_footer", count: null },
      ],
      unchecked: [],
    });
  });
});

describe("headingsView", () => {
  it("flags renamed headings, and missing ones only where the resume has that content", () => {
    const view = headingsView(
      stored({ headings: { summary: "renamed", experience: "not_found", education: "standard", skills: "standard", projects: "not_found", certifications: "not_found" } }),
      profile,
    );
    expect(view).toEqual({
      state: "checked",
      issues: [
        { section: "summary", problem: "renamed" },
        { section: "experience", problem: "not_found" },
      ],
    });
  });
});

describe("screeningSummary", () => {
  it("is words, never a percentage", () => {
    const view = buildScreeningView({ target: { roleSlug: "data-analyst" }, profileVersion: 2, profile, role: role("data-analyst"), stored: stored(), now });
    expect(screeningView.parse(view)).toEqual(view);
    const summary = screeningSummary(view);
    expect(JSON.stringify(summary)).not.toMatch(/%|score/i);
    expect(summary.headline).toMatch(/^\d+ things? to look at before you apply\.$/);
    expect(summary.parts.map((p) => p.label)).toEqual(["Keywords", "Layout", "Headings"]);
  });

  it("says ready only when everything was checked and nothing is left", () => {
    const done: ScreeningView = {
      against: "job",
      target: { checkId: "8f0c2a5e-3b1d-4c6e-9a7f-1d2e3f4a5b6c" },
      profileVersion: 2,
      keywords: { asked: 2, missing: [] }, layout: { state: "checked", fileType: "docx", issues: [], unchecked: [] }, headings: { state: "checked", issues: [] } };
    expect(screeningSummary(done).headline).toBe("Nothing to fix for screening software.");
    expect(screeningSummary({ ...done, layout: { state: "unknown" } }).headline).toBe("Nothing to fix in what we could check.");
    expect(screeningSummary({ ...done, layout: { state: "unknown" } }).parts[1].text).toMatch(/Upload your file again/);
  });
});
