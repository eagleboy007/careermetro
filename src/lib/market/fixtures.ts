import type { LiveInputs } from "./live";

/*
 * Synthetic reads for live counts on /design and in ./live.test.ts: made-up open posts and rollup rows in the shape
 * liveMarketInputs returns, no real board or post. Data Analyst has 15 open in Karnataka (shown) and 14 in Maharashtra
 * (hidden as "Not enough data"); the rollup began in Oct 2026, so the trend says "Counting since Oct 2026".
 */

/** The moment the fixture is read at, and the last feed run before it. */
export const LIVE_FIXTURE_NOW = new Date("2026-10-21T06:00:00Z");

export const liveFixture: LiveInputs = {
  open: [
    { roleSlug: "data-analyst", city: "Bengaluru", experienceNote: "2 to 4 years", posts: 9 },
    { roleSlug: "data-analyst", city: "Bengaluru", experienceNote: null, posts: 4 },
    { roleSlug: "data-analyst", city: "Mysuru", experienceNote: "0 to 2 years", posts: 2 },
    { roleSlug: "data-analyst", city: "Pune", experienceNote: "3+ years", posts: 10 },
    { roleSlug: "data-analyst", city: "Mumbai", experienceNote: null, posts: 4 },
    { roleSlug: "data-analyst", city: "Remote", experienceNote: null, posts: 6 },
    { roleSlug: "data-engineer", city: "Bengaluru", experienceNote: "5+ years", posts: 18 },
    { roleSlug: "data-engineer", city: "Hyderabad", experienceNote: "3 to 5 years", posts: 7 },
  ],
  rollup: [
    { month: "2026-10-01", roleSlug: "data-analyst", state: "IN", band: null, newPosts: 30 },
    { month: "2026-10-01", roleSlug: "data-analyst", state: "KA", band: "3-5", newPosts: 9 },
  ],
  firstMonth: "2026-10-01",
  lastRun: new Date("2026-10-21T01:20:00Z"),
};

/** An empty database (CI's, a new staging): nothing read yet. */
export const liveNothing: LiveInputs = { open: [], rollup: [], firstMonth: null, lastRun: null };
