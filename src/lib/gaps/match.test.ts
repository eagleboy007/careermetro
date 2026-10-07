import { describe, expect, it } from "vitest";
import { roleProfiles } from "@/content";
import type { Profile } from "@/lib/schemas";
import { matchProfile, matchResult, MATCHER_VERSION } from "./match";

const dataAnalyst = roleProfiles.find((r) => r.slug === "data-analyst")!;
const now = new Date("2026-10-07T00:00:00Z");

const profile = (patch: Partial<Profile>): Profile => ({
  headline: null,
  totalYearsExperience: 3,
  roles: [],
  skills: [],
  education: [],
  certifications: [],
  ...patch,
});

const statusOf = (r: ReturnType<typeof matchProfile>, id: string) => [...r.gaps, ...r.met, ...r.niceToHave].find((s) => s.skillId === id)?.status;

describe("matchProfile", () => {
  it("meets a skill shown in a recent job, citing the line", () => {
    const r = matchProfile(
      profile({
        roles: [{ title: "Analyst", employer: "Example Retail", start: "2023-01", end: null, highlights: ["Wrote SQL queries for weekly sales reports"] }],
      }),
      dataAnalyst,
      now,
    );
    expect(r.met.find((s) => s.skillId === "sql")).toMatchObject({ status: "met", resumeQuote: "Wrote SQL queries for weekly sales reports" });
    expect(matchResult.parse(r).matcherVersion).toBe(MATCHER_VERSION);
  });

  it("calls a skill that is only listed weak evidence", () => {
    const r = matchProfile(profile({ skills: [{ name: "SQL", lastUsed: null, evidence: ["SKILLS: SQL, Excel, Power BI"] }] }), dataAnalyst, now);
    expect(r.gaps.find((g) => g.skillId === "sql")).toMatchObject({ status: "weak", resumeQuote: "SKILLS: SQL, Excel, Power BI" });
  });

  it("calls a skill last used more than four years ago outdated", () => {
    const r = matchProfile(
      profile({
        roles: [{ title: "MIS Executive", employer: "Example Bank", start: "2014-01", end: "2019-03", highlights: ["Built Python scripts to merge branch reports"] }],
      }),
      dataAnalyst,
      now,
    );
    expect(statusOf(r, "python")).toBe("outdated");
  });

  it("marks a skill with no evidence missing, with no quote", () => {
    const r = matchProfile(profile({}), dataAnalyst, now);
    expect(r.gaps.find((g) => g.skillId === "statistics")).toMatchObject({ status: "missing", resumeQuote: null });
    expect(r.readiness).toMatchObject({ requiredMet: 0, requiredTotal: r.gaps.length });
  });

  it("orders gaps by how often postings ask for them, and only required skills are gaps", () => {
    const r = matchProfile(profile({}), dataAnalyst, now);
    const shares = r.gaps.map((g) => g.postingShare ?? -1);
    expect(shares).toEqual([...shares].sort((a, b) => b - a));
    const required = new Set(dataAnalyst.skills.filter((s) => s.importance === "required").map((s) => s.skillId));
    expect(r.gaps.every((g) => required.has(g.skillId))).toBe(true);
    expect(r.niceToHave.length).toBe(dataAnalyst.skills.length - required.size);
  });

  it("doesn't find short names like Go or ML inside sentences, but trusts them when listed with an example", () => {
    const devops = roleProfiles.find((r) => r.slug === "devops-engineer")!;
    const sentence = profile({ roles: [{ title: "Admin", employer: "X", start: null, end: null, highlights: ["Ran go-live checks for 12 servers"] }] });
    expect(statusOf(matchProfile(sentence, devops, now), "go")).toBe("missing");
    const listed = profile({ skills: [{ name: "Go", lastUsed: null, evidence: ["Wrote a log shipper in Go for 12 servers"] }] });
    expect(statusOf(matchProfile(listed, devops, now), "go")).toBe("met");
  });

  it("gives the same result for the same input", () => {
    const p = profile({ skills: [{ name: "Excel", lastUsed: null, evidence: ["Built pivot tables for the monthly payables report"] }] });
    expect(matchProfile(p, dataAnalyst, now)).toEqual(matchProfile(p, dataAnalyst, now));
  });
});
