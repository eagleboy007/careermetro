import { exampleNearbyResume, exampleLineSkillIds } from "@/lib/nearby/fixtures";
import type { MatchList } from "@/lib/schemas";
import { matchListFor } from "./build";

/*
 * Example Match for the design page and the preview. The profile is the synthetic MIS Executive of the Nearby lines
 * example, on the Data Analyst line with its first three goals proved; the roles are worked out by the real code over
 * the live role profiles, so every count on screen is one the matcher gives. The open-job counts are made up.
 */

const exampleProved = new Set(exampleLineSkillIds.slice(0, 3));

export const exampleMatch: MatchList = matchListFor({
  profile: exampleNearbyResume,
  targetSlug: "data-analyst",
  resumeId: null,
  weeklyHours: 6,
  proved: exampleProved,
  openJobs: new Map([
    ["data-analyst", 4],
    ["business-analyst", 2],
    ["data-scientist", 1],
  ]),
  now: new Date("2026-10-15T00:00:00Z"),
});
