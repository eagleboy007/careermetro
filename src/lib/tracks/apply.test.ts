import { describe, expect, it } from "vitest";
import { roleProfiles, roleTracks } from "@/content";
import type { GapAnalysis, RoleProfile, RoleTrack } from "@/lib/schemas";
import { allowedTracks, applyTrack, orderForTrack, trackGapExplanation, trackPickerFor } from "./apply";

const role: Pick<RoleProfile, "title" | "skills" | "groups"> = {
  title: "Data Analyst",
  groups: [{ id: "cloud", label: "A cloud platform (AWS or Azure)" }],
  skills: [
    { skillId: "sql", importance: "required", expectation: "Write joins on real tables", postingShare: null },
    { skillId: "python", importance: "required", expectation: "Use Python for analysis", postingShare: null },
    { skillId: "excel", importance: "required", expectation: "Clean rows in Excel", postingShare: null },
    { skillId: "statistics", importance: "required", expectation: "Explain averages", postingShare: null },
    { skillId: "aws", importance: "required", expectation: "Use a cloud", postingShare: null, oneOf: "cloud" },
    { skillId: "azure", importance: "required", expectation: "Use a cloud", postingShare: null, oneOf: "cloud" },
    { skillId: "power-bi", importance: "nice_to_have", expectation: "Build a Power BI dashboard", postingShare: null },
    { skillId: "tableau", importance: "nice_to_have", expectation: "Build a Tableau dashboard", postingShare: null },
    { skillId: "dbt", importance: "nice_to_have", expectation: "Model data in dbt", postingShare: null },
  ],
};

const gap = (skillId: string, status: "missing" | "weak" = "missing", groupId?: string) => ({
  skillId,
  skillName: skillId.toUpperCase(),
  status,
  resumeQuote: status === "weak" ? "used it once" : null,
  requirement: "r",
  explanation: "e",
  ...(groupId ? { groupId } : {}),
});

// SQL is met; Python, Excel, statistics and the cloud group are gaps. Power BI is missing, Tableau met, dbt weak.
const base: GapAnalysis = {
  roleSlug: "data-analyst",
  gaps: [gap("python"), gap("excel", "weak"), gap("statistics"), gap("aws", "missing", "cloud")],
  metSkillIds: ["sql"],
  niceToHave: [
    { skillId: "power-bi", skillName: "Power BI", status: "missing" },
    { skillId: "tableau", skillName: "Tableau", status: "met" },
    { skillId: "dbt", skillName: "dbt", status: "weak" },
  ],
  readiness: { headline: "h", explanation: "e", estimatedHours: 40 },
};

const track = (over: Partial<RoleTrack> = {}): RoleTrack => ({
  id: "bi-reporting",
  name: "BI and reporting",
  blurb: "Dashboards, Power BI",
  description: "Dashboards.",
  add: [],
  drop: [],
  first: [],
  reviewed: false,
  ...over,
});

describe("applyTrack", () => {
  it("leaves the analysis as it is with no track", () => {
    expect(applyTrack(base, role, null)).toBe(base);
  });

  it("drops gaps the track doesn't ask for, keeping them as nice to have", () => {
    const t = applyTrack(base, role, track({ drop: ["python", "sql"] }));
    expect(t.gaps.map((g) => g.skillId)).toEqual(["excel", "statistics", "aws"]);
    expect(t.niceToHave).toEqual(expect.arrayContaining([
      { skillId: "python", skillName: "PYTHON", status: "missing" },
      { skillId: "sql", skillName: "SQL", status: "met" },
    ]));
    // A met skill stays met, so its goal doesn't open again.
    expect(t.metSkillIds).toEqual(["sql"]);
  });

  it("adds nice-to-haves as gaps in their own words, or as met when the resume shows them", () => {
    const t = applyTrack(base, role, track({ add: ["power-bi", "tableau", "dbt"] }));
    expect(t.gaps.map((g) => [g.skillId, g.status])).toEqual([
      ["python", "missing"],
      ["excel", "weak"],
      ["statistics", "missing"],
      ["aws", "missing"],
      ["power-bi", "missing"],
      ["dbt", "weak"],
    ]);
    const powerBi = t.gaps.find((g) => g.skillId === "power-bi")!;
    expect(powerBi).toMatchObject({ skillName: "Power BI", resumeQuote: null, requirement: "Build a Power BI dashboard" });
    expect(powerBi.explanation).toBe("Nothing in your resume shows Power BI. This track expects you to build a Power BI dashboard.");
    expect(t.metSkillIds).toEqual(["sql", "tableau"]);
    expect(t.niceToHave.map((n) => n.skillId)).toEqual([]);
  });

  it("puts the track's first skills first, in its order, and never touches a group's gap", () => {
    const t = applyTrack(base, role, track({ add: ["power-bi"], drop: ["aws"], first: ["power-bi", "statistics"] }));
    expect(t.gaps.map((g) => g.skillId)).toEqual(["power-bi", "statistics", "python", "excel", "aws"]);
  });

  it("is the same every time", () => {
    const t = track({ add: ["dbt"], drop: ["excel"], first: ["dbt"] });
    expect(applyTrack(base, role, t)).toEqual(applyTrack(base, role, t));
  });
});

describe("trackGapExplanation", () => {
  it("says plainly why, for each state", () => {
    expect(trackGapExplanation("dbt", "weak", "Model data in dbt.")).toBe("Your resume mentions dbt, but not enough to count it as shown. This track expects you to model data in dbt.");
    expect(trackGapExplanation("dbt", "outdated", "Model data in dbt")).toBe("The latest use of dbt on your resume is more than 4 years old. This track expects you to model data in dbt.");
  });
});

describe("orderForTrack", () => {
  it("moves the track's first skills ahead and keeps the rest in their order", () => {
    const goals = ["a", "b", "c", "d"].map((skillId) => ({ skillId }));
    expect(orderForTrack(goals, track({ first: ["c", "a"] })).map((g) => g.skillId)).toEqual(["c", "a", "b", "d"]);
    expect(orderForTrack(goals, null)).toEqual(goals);
  });
});

describe("allowedTracks", () => {
  const all = [{ roleSlug: "data-analyst", tracks: [track(), track({ id: "checked", name: "Checked", reviewed: true })] }];
  it("offers unreviewed tracks only where unreviewed content is allowed", () => {
    expect(allowedTracks("data-analyst", true, all).map((t) => t.id)).toEqual(["bi-reporting", "checked"]);
    expect(allowedTracks("data-analyst", false, all).map((t) => t.id)).toEqual(["checked"]);
    expect(allowedTracks("no-role", true, all)).toEqual([]);
  });

  it("offers nothing in production while the content waits for review", () => {
    expect(roleProfiles.flatMap((r) => allowedTracks(r.slug, false))).toEqual([]);
    expect(allowedTracks("data-analyst", true).length).toBe(roleTracks.find((r) => r.roleSlug === "data-analyst")!.tracks.length);
  });
});

describe("trackPickerFor", () => {
  const tracks = [track({ add: ["power-bi", "tableau"], drop: ["python"], first: ["power-bi"] }), track({ id: "product", name: "Product analytics", blurb: "Funnels", add: ["dbt"] })];

  it("lists the whole role first, then each track with its goals, met ones and first open goals", () => {
    const picker = trackPickerFor({ base, role, tracks, current: "bi-reporting", provedSkillIds: new Set() })!;
    expect(picker.role).toBe("Data Analyst");
    expect(picker.current).toBe("bi-reporting");
    expect(picker.options).toEqual([
      // SQL met; Python, Excel, statistics and the cloud group open.
      { id: null, name: "Data Analyst", blurb: "Every skill the role profile asks for", goals: 5, met: 1, firstGoals: ["PYTHON", "EXCEL", "STATISTICS"], moreGoals: 1 },
      // No Python; Power BI first; Tableau met from the resume.
      { id: "bi-reporting", name: "BI and reporting", blurb: "Dashboards, Power BI", goals: 6, met: 2, firstGoals: ["Power BI", "EXCEL", "STATISTICS"], moreGoals: 1 },
      { id: "product", name: "Product analytics", blurb: "Funnels", goals: 6, met: 1, firstGoals: ["PYTHON", "EXCEL", "STATISTICS"], moreGoals: 2 },
    ]);
  });

  it("counts proof as met, for a skill of a group too", () => {
    const picker = trackPickerFor({ base, role, tracks, current: null, provedSkillIds: new Set(["azure", "python"]) })!;
    expect(picker.options[0]).toMatchObject({ goals: 5, met: 3, firstGoals: ["EXCEL", "STATISTICS"], moreGoals: 0 });
  });

  it("reads a track that isn't offered as the whole role, and offers nothing without tracks", () => {
    expect(trackPickerFor({ base, role, tracks, current: "gone", provedSkillIds: new Set() })!.current).toBeNull();
    expect(trackPickerFor({ base, role, tracks: [], current: null, provedSkillIds: new Set() })).toBeNull();
  });
});
