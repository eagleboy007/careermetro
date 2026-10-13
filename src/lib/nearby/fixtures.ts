import type { NearbyLines, Profile } from "@/lib/schemas";
import { nearbyLinesFor } from "./build";

/*
 * Example Nearby lines for the design page and the preview. The profile is synthetic, but the lines are worked out by
 * the real code over the live role profiles, so every count on screen is one the matcher gives.
 */

export const exampleNearbyResume: Profile = {
  headline: "MIS Executive",
  totalYearsExperience: 2.3,
  roles: [
    {
      title: "MIS Executive",
      employer: "Konkan Co-operative Bank",
      start: "2024-06",
      end: null,
      highlights: [
        "Built Excel dashboards with pivot tables for 3 branch managers",
        "Cleaned duplicate customer records before each monthly report",
        "Gathered reporting requirements from the branch managers and wrote them up as user stories",
        "Presented the monthly branch summary to the regional head",
        "Trained a machine learning model to flag loans likely to miss a repayment",
        "Evaluated the model with precision and recall on six months of held-out loans",
        "Ran an A/B test on two reminder SMS wordings across 4 branches",
      ],
    },
  ],
  skills: [
    { name: "SQL", lastUsed: null, evidence: [] },
    { name: "Python", lastUsed: null, evidence: [] },
    { name: "Excel", lastUsed: null, evidence: ["Built Excel dashboards with pivot tables for 3 branch managers"] },
    { name: "Data cleaning", lastUsed: null, evidence: ["Cleaned duplicate customer records before each monthly report"] },
    { name: "Requirements gathering", lastUsed: null, evidence: ["Gathered reporting requirements from the branch managers and wrote them up as user stories"] },
    { name: "Power BI", lastUsed: null, evidence: [] },
  ],
  education: [{ qualification: "B.Com", institution: "Savitribai Phule Pune University", year: "2023" }],
  certifications: [],
};

/** The goals of the example Data Analyst line (src/lib/map/fixtures.ts), in line order, and the ones proved there. */
export const exampleLineSkillIds = ["excel", "sql", "statistics", "sql-window-functions", "power-bi", "python", "data-storytelling"];
const exampleProved = new Set(["excel", "sql", "statistics"]);

export const exampleNearby: NearbyLines = nearbyLinesFor({
  profile: exampleNearbyResume,
  targetSlug: "data-analyst",
  proved: exampleProved,
  lineSkillIds: exampleLineSkillIds,
  now: new Date("2026-10-13T00:00:00Z"),
});
