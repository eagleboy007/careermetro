import { describe, expect, it } from "vitest";
import { roleProfiles, skills } from "@/content";
import { formatExperience, getRoleView, postingsAnalysed, roleViews } from "./role-view";

describe("role views", () => {
  it("has one view per role profile, sorted by title", () => {
    expect(roleViews).toHaveLength(roleProfiles.length);
    const titles = roleViews.map((r) => r.title);
    expect(titles).toEqual([...titles].sort((a, b) => a.localeCompare(b)));
  });

  it("resolves every skill and certification to a display name", () => {
    for (const r of roleViews) {
      const profile = roleProfiles.find((p) => p.slug === r.slug)!;
      expect(r.required.length + r.niceToHave.length).toBe(profile.skills.length);
      expect(r.certifications).toHaveLength(profile.certifications.length);
      for (const s of [...r.required, ...r.niceToHave]) expect(s.name).toBe(skills.find((k) => k.id === s.skillId)?.name);
    }
  });

  it("lists most-asked skills first", () => {
    for (const r of roleViews) {
      const shares = r.required.map((s) => s.postingShare ?? -1);
      expect(shares).toEqual([...shares].sort((a, b) => b - a));
    }
  });

  it("lists recommended certifications before optional ones", () => {
    for (const r of roleViews) {
      const firstOptional = r.certifications.findIndex((c) => c.importance === "optional");
      if (firstOptional >= 0) expect(r.certifications.slice(firstOptional).every((c) => c.importance === "optional")).toBe(true);
    }
  });

  it("reads the posting count from the source line", () => {
    expect(postingsAnalysed([{ description: "Skill shares measured on 32 public job postings (7 in India).", url: null }])).toBe(32);
    expect(postingsAnalysed([{ description: "Drafted by hand.", url: null }])).toBeNull();
    expect(getRoleView("data-analyst")?.postingsAnalysed).toBeGreaterThan(0);
  });

  it("formats experience bands", () => {
    expect(formatExperience({ minYears: 0, maxYears: 2 })).toBe("Up to 2 years");
    expect(formatExperience({ minYears: 3, maxYears: 8 })).toBe("3 to 8 years");
  });

  it("returns undefined for an unknown slug", () => {
    expect(getRoleView("astronaut")).toBeUndefined();
  });
});
