import { describe, expect, it } from "vitest";
import type { Profile } from "@/lib/schemas";
import { jobPost } from "@/lib/schemas";
import { MIN_FIT_SKILLS, postedWords, postView, TOO_FEW_SKILLS, updatedWords, type FitContext, type StoredPost } from "./fit";
import { filterDepartures, NO_FILTERS } from "./filter";

const NOW = new Date("2026-10-20T14:12:00Z"); // 19:42 in India

// The e2e stand-in profile (e2e/mock-ai.mjs): SQL and Excel used in work, Python last used in 2022, Power BI only listed.
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
    { name: "Python", lastUsed: "2022-05", evidence: ["Used Python (pandas) to merge vendor files"] },
    { name: "Power BI", lastUsed: null, evidence: [] },
  ],
  education: [],
  certifications: [],
};

const post = (over: Partial<StoredPost> = {}): StoredPost => ({
  id: "6f1c2b9e-0000-4000-8000-000000000001",
  title: "Junior data analyst",
  company: "Example Labs",
  city: "Pune",
  workType: "full_time",
  experienceNote: "0 to 2 years",
  roleSlug: "data-analyst",
  requiredSkillIds: ["sql", "excel", "statistics", "power-bi"],
  niceSkillIds: ["tableau"],
  url: "https://boards.greenhouse.io/examplelabs/jobs/4001",
  postedAt: new Date("2026-10-17T04:00:00Z"),
  firstSeenAt: new Date("2026-10-18T01:00:00Z"),
  closedAt: null,
  ...over,
});
const ctx = (over: Partial<FitContext> = {}): FitContext => ({
  profile,
  targetSlug: "data-analyst",
  goalSkillIds: new Set(["statistics"]),
  proved: new Set(),
  ...over,
});

describe("postView", () => {
  it("matches the post's required skills by the plain-code matcher: what you have, the gaps, readiness in goals", () => {
    const view = postView(post(), ctx(), NOW);
    expect(jobPost.safeParse(view).success).toBe(true);
    expect(view.have).toEqual(["SQL", "Excel"]);
    expect(view.gaps.map((g) => g.name)).toEqual(expect.arrayContaining(["Statistics", "Power BI"]));
    expect(view.gaps).toHaveLength(2);
    expect(view.goalsBefore).toBe(2);
    expect(view.destination).toBe(true);
    expect(view.why).toBe("The role your line is built for. One of them is a goal on your line.");
    expect(view).toMatchObject({ role: "Junior data analyst", workType: "Full time", experience: "0 to 2 years", posted: "3 days ago", applyUrl: post().url, closed: false, fitNote: null });
  });

  it("counts proof as having the skill, and says when every gap is a goal", () => {
    const view = postView(post({ roleSlug: "business-analyst" }), ctx({ proved: new Set(["power-bi"]) }), NOW);
    expect(view.have).toEqual(["SQL", "Excel", "Power BI"]);
    expect(view.gaps.map((g) => g.name)).toEqual(["Statistics"]);
    expect(view.destination).toBe(false);
    expect(view.why).toBe("It is a goal on your line. You can still apply now.");
    const ready = postView(post({ requiredSkillIds: ["sql", "excel"] }), ctx(), NOW);
    expect(ready.gaps).toEqual([]);
    expect(ready.why).toBe("Every required skill in the post is on your resume or proved.");
  });

  it(`shows no fit for a post with fewer than ${MIN_FIT_SKILLS} required skills found, and none without a resume`, () => {
    const few = postView(post({ requiredSkillIds: ["sql"], niceSkillIds: ["excel", "python"] }), ctx(), NOW);
    expect(few).toMatchObject({ fitNote: TOO_FEW_SKILLS, gaps: [], have: [] });
    const none = postView(post(), null, NOW);
    expect(none).toMatchObject({ fitNote: null, gaps: [], have: [], goalsBefore: 0 });
  });

  it("marks a closed post, which drops off All and stays in Saved and Applied", () => {
    const closed = postView(post({ closedAt: new Date("2026-10-19T01:00:00Z") }), ctx(), NOW);
    const open = postView(post({ id: "6f1c2b9e-0000-4000-8000-000000000002" }), ctx(), NOW);
    expect(closed.closed).toBe(true);
    const ids = (tab: "all" | "saved" | "applied") => filterDepartures([closed, open], { ...NO_FILTERS, tab }, new Set([closed.id]), new Map([[closed.id, 1]])).map((j) => j.id);
    expect(ids("all")).toEqual([open.id]);
    expect(ids("saved")).toEqual([closed.id]);
    expect(ids("applied")).toEqual([closed.id]);
  });

  it("falls back to the day the feed first saw a post with no posted date, and shows work type and no experience in words", () => {
    const view = postView(post({ postedAt: null, experienceNote: null, workType: "part_time" }), ctx(), NOW);
    expect(view).toMatchObject({ posted: "2 days ago", experience: "", workType: "Part time" });
  });
});

describe("postedWords", () => {
  it("turns at midnight in India", () => {
    expect(postedWords(new Date("2026-10-20T00:00:00Z"), NOW)).toBe("today");
    // 23:59 on the 19th in India.
    expect(postedWords(new Date("2026-10-19T18:29:00Z"), NOW)).toBe("yesterday");
    expect(postedWords(new Date("2026-10-10T10:00:00Z"), NOW)).toBe("10 days ago");
    expect(postedWords(new Date("2026-10-21T10:00:00Z"), NOW)).toBe("today");
  });
});

describe("updatedWords", () => {
  it("shows the last good run's time in India, the date once 36 hours have passed, and nothing before the first run", () => {
    expect(updatedWords(new Date("2026-10-20T14:12:00Z"), NOW)).toBe("Updated 19:42");
    expect(updatedWords(new Date("2026-10-19T02:12:00Z"), NOW)).toBe("Updated 07:42");
    expect(updatedWords(new Date("2026-10-19T02:11:00Z"), NOW)).toBe("Updated 19 Oct");
    expect(updatedWords(null, NOW)).toBeNull();
  });
});
