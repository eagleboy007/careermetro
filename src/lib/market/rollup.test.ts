import { describe, expect, it } from "vitest";
import { marketStates } from "@/content/market/places";
import { INDIA_ROW as APP_INDIA_ROW, MARKET_BANDS, STATE_CODES } from "@/lib/schemas";
import { experienceBand } from "../../../scripts/jd-mining/market.mjs";
import { experienceNoteOf } from "../departures/feed-rules.mjs";
import { addMonths, bandOfNote, INDIA_ROW, marketRollupRow, monthBounds, monthOf, placesOfPost, ROLLUP_BANDS, rollupMonth, STATE_OF_CITY } from "./rollup.mjs";

// The monthly openings rollup the daily feed writes (docs/plans/market-trends-plan.md, migration 0048), over synthetic
// posts only: no board, no database.
type Post = { city: string; experienceNote: string | null; roleSlug: string | null; firstSeenAt: Date; closedAt: Date | null };
const day = (iso: string) => new Date(`${iso}T01:00:00.000Z`);
const post = (over: Partial<Post> = {}): Post => ({
  city: "Pune",
  experienceNote: "2 to 4 years",
  roleSlug: "data-analyst",
  firstSeenAt: day("2026-10-05"),
  closedAt: null,
  ...over,
});
const at = day("2026-10-21");
const run = (posts: Post[], computedAt = at, boardsOk = 140) => rollupMonth({ posts, month: monthOf(computedAt), boardsOk, computedAt });
const cell = (rows: ReturnType<typeof run>["rows"], state: string, city: string | null, band: string | null = "0-2", role = "data-analyst") =>
  rows.find((r) => r.roleSlug === role && r.state === state && r.city === city && r.band === band);

const good = {
  month: "2026-10-01",
  roleSlug: "data-analyst",
  state: "MH",
  city: "Pune",
  band: "3-5",
  newPosts: 3,
  openAtEnd: 5,
  boardsOk: 140,
  computedAt: at,
};

describe("a rollup row (schema)", () => {
  it("takes a city, state or India row", () => {
    expect(marketRollupRow.parse(good)).toEqual(good);
    expect(marketRollupRow.safeParse({ ...good, city: null }).success).toBe(true);
    expect(marketRollupRow.safeParse({ ...good, state: "IN", city: null, band: null }).success).toBe(true);
    expect(marketRollupRow.safeParse({ ...good, newPosts: 0 }).success).toBe(true);
  });

  it("refuses a row that breaks the table's rules", () => {
    for (const bad of [
      { ...good, month: "2026-10-02" },
      { ...good, month: "2026-13-01" },
      { ...good, state: "IN" },
      { ...good, state: "KA" },
      { ...good, state: "XX", city: null },
      { ...good, city: "Springfield" },
      { ...good, band: "2-4" },
      { ...good, newPosts: -1 },
      { ...good, openAtEnd: 1.5 },
      { ...good, newPosts: 0, openAtEnd: 0 },
      { ...good, roleSlug: "Data Analyst" },
      { ...good, title: "Data Analyst" },
    ])
      expect(marketRollupRow.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
  });

  it("uses the app's bands, India code, states and the Market's cities", () => {
    expect([...ROLLUP_BANDS]).toEqual([...MARKET_BANDS]);
    expect(INDIA_ROW).toBe(APP_INDIA_ROW);
    for (const state of STATE_OF_CITY.values()) expect(STATE_CODES).toContain(state);
    const mapCities = marketStates.flatMap((s) => s.cities.map((c) => `${s.code}|${c}`)).sort();
    expect([...STATE_OF_CITY].map(([city, state]) => `${state}|${city}`).sort()).toEqual(mapCities);
  });
});

describe("city to state", () => {
  it("counts a city in itself, its state and India; Remote, India and a city off the list in India only", () => {
    expect(placesOfPost("Bengaluru")).toEqual([
      { state: "IN", city: null },
      { state: "KA", city: null },
      { state: "KA", city: "Bengaluru" },
    ]);
    expect(placesOfPost("New Delhi")).toEqual([
      { state: "IN", city: null },
      { state: "DL", city: null },
      { state: "DL", city: "New Delhi" },
    ]);
    expect(placesOfPost("Remote")).toEqual([{ state: "IN", city: null }]);
    expect(placesOfPost("India")).toEqual([{ state: "IN", city: null }]);
    expect(placesOfPost("Springfield")).toEqual([{ state: "IN", city: null }]);
  });
});

describe("band from experience_note", () => {
  it("reads the notes the feed stores, on the Market's cut-offs", () => {
    expect(bandOfNote("0 to 2 years")).toBe("0-2");
    expect(bandOfNote("2 to 4 years")).toBe("0-2");
    expect(bandOfNote("3+ years")).toBe("3-5");
    expect(bandOfNote("5 to 8 years")).toBe("3-5");
    expect(bandOfNote("6+ years")).toBe("6-10");
    expect(bandOfNote("9 to 12 years")).toBe("6-10");
    expect(bandOfNote("10+ years")).toBe("10+");
    expect(bandOfNote("15+ years")).toBe("10+");
  });

  it("is null for no note or one in another shape, never guessed", () => {
    for (const note of [null, undefined, "", "Senior", "five years", "20+ years", "about 3 years"]) expect(bandOfNote(note)).toBeNull();
  });

  it("agrees with the band /market reads from the same text", () => {
    for (const text of [
      "2-4 years of experience in analytics",
      "5+ years of professional experience",
      "8+ years of experience, including 2+ years with Kafka",
      "Minimum 1 year of experience",
      "10+ years of industry experience",
      "3 to 5 years of relevant experience",
    ]) {
      const note = experienceNoteOf(text);
      expect(note, text).not.toBeNull();
      expect(bandOfNote(note), text).toBe(experienceBand(`${note} of experience`));
    }
  });
});

describe("the month's rows", () => {
  it("counts a post once in its city, once in its state and once in India", () => {
    const { rows, stats } = run([post(), post({ city: "Mumbai" }), post({ city: "Pune", firstSeenAt: day("2026-09-20") })]);
    expect(cell(rows, "IN", null)).toMatchObject({ newPosts: 2, openAtEnd: 3 });
    expect(cell(rows, "MH", null)).toMatchObject({ newPosts: 2, openAtEnd: 3 });
    expect(cell(rows, "MH", "Pune")).toMatchObject({ newPosts: 1, openAtEnd: 2 });
    expect(cell(rows, "MH", "Mumbai")).toMatchObject({ newPosts: 1, openAtEnd: 1 });
    expect(rows).toHaveLength(4);
    expect(stats).toMatchObject({ month: "2026-10-01", rows: 4, counted: 3, unmatched: 0, indiaOnly: 0 });
    for (const r of rows) expect(r).toMatchObject({ month: "2026-10-01", boardsOk: 140, computedAt: at });
  });

  it('counts "Remote" and "India" in India only', () => {
    const { rows, stats } = run([post({ city: "Remote" }), post({ city: "India" }), post({ city: "Hyderabad" })]);
    expect(cell(rows, "IN", null)).toMatchObject({ newPosts: 3, openAtEnd: 3 });
    expect(rows.filter((r) => r.state !== "IN").map((r) => [r.state, r.city])).toEqual([
      ["TG", null],
      ["TG", "Hyderabad"],
    ]);
    expect(stats.indiaOnly).toBe(2);
  });

  it("splits by band, keeps posts with no stated years under a null band, and leaves out posts with no live role", () => {
    const { rows, stats } = run([
      post({ experienceNote: "6+ years" }),
      post({ experienceNote: null }),
      post({ roleSlug: null }),
      post({ roleSlug: "devops-engineer", city: "Remote" }),
    ]);
    expect(cell(rows, "MH", "Pune", "6-10")).toMatchObject({ newPosts: 1 });
    expect(cell(rows, "MH", "Pune", null)).toMatchObject({ newPosts: 1 });
    expect(cell(rows, "IN", null, "0-2", "devops-engineer")).toMatchObject({ newPosts: 1, openAtEnd: 1 });
    expect(rows.some((r) => r.roleSlug === null)).toBe(false);
    expect(stats).toMatchObject({ counted: 3, unmatched: 1 });
  });

  it("counts a repost under a new URL again (a new job_posts row)", () => {
    const { rows } = run([post(), post()]);
    expect(cell(rows, "MH", "Pune")).toMatchObject({ newPosts: 2, openAtEnd: 2 });
  });

  it("counts a post first seen and closed in the month as new but not open, and leaves out one that closed before now", () => {
    const { rows } = run([
      post({ closedAt: day("2026-10-12") }),
      post({ firstSeenAt: day("2026-08-01"), closedAt: day("2026-09-30") }),
      post({ firstSeenAt: day("2026-08-01"), closedAt: day("2026-10-15") }),
    ]);
    expect(cell(rows, "MH", "Pune")).toMatchObject({ newPosts: 1, openAtEnd: 0 });
    // A post first seen before the month and still open counts as open only.
    const open = run([post({ firstSeenAt: day("2026-08-01") })]);
    expect(cell(open.rows, "MH", "Pune")).toMatchObject({ newPosts: 0, openAtEnd: 1 });
    expect(run([]).rows).toEqual([]);
  });

  it("gives the same rows when a day is re-run, whatever order the posts come in", () => {
    const posts = [post(), post({ city: "Remote", experienceNote: "10+ years" }), post({ city: "Chennai", roleSlug: "devops-engineer" }), post({ firstSeenAt: day("2026-09-03") })];
    const first = run(posts);
    const again = run([...posts].reverse());
    expect(again).toEqual(first);
    // Sorted by role, then India, then each state with its cities, then band.
    expect(first.rows.map((r) => `${r.roleSlug}|${r.state}|${r.city ?? ""}|${r.band ?? ""}`)).toEqual([
      "data-analyst|IN||0-2",
      "data-analyst|IN||10+",
      "data-analyst|MH||0-2",
      "data-analyst|MH|Pune|0-2",
      "devops-engineer|IN||0-2",
      "devops-engineer|TN||0-2",
      "devops-engineer|TN|Chennai|0-2",
    ]);
  });

  it("rolls over at the month's end on the India day: a new month counts only its own new posts, and still counts what is open", () => {
    // Midnight IST on 1 November is 18:30 UTC on 31 October.
    const lastOfOctober = new Date("2026-10-31T18:29:59.999Z");
    const firstOfNovember = new Date("2026-10-31T18:30:00.000Z");
    const posts = [post({ firstSeenAt: day("2026-10-31") }), post({ firstSeenAt: firstOfNovember }), post({ firstSeenAt: day("2026-10-10"), closedAt: day("2026-10-30") })];
    const october = run(posts, lastOfOctober);
    expect(october.stats.month).toBe("2026-10-01");
    // The November post is not seen yet at 23:59 IST on 31 October.
    expect(cell(october.rows, "MH", "Pune")).toMatchObject({ month: "2026-10-01", newPosts: 2, openAtEnd: 1 });
    const november = run(posts, day("2026-11-01"));
    expect(november.stats.month).toBe("2026-11-01");
    // The post first seen at 18:30 UTC on 31 October is November's.
    expect(cell(november.rows, "MH", "Pune")).toMatchObject({ month: "2026-11-01", newPosts: 1, openAtEnd: 2 });
    // December wraps the year; the bounds are midnight IST.
    expect(monthBounds("2026-12-01")).toEqual({ start: new Date("2026-11-30T18:30:00.000Z"), end: new Date("2026-12-31T18:30:00.000Z") });
    expect(() => monthBounds("2026-12-15")).toThrow();
  });

  it("cuts months on the India day (Asia/Kolkata, UTC+05:30), not UTC", () => {
    expect(monthOf(new Date("2026-10-31T18:29:00Z"))).toBe("2026-10-01"); // 23:59 IST on 31 October
    expect(monthOf(new Date("2026-10-31T18:30:00Z"))).toBe("2026-11-01"); // 00:00 IST on 1 November
    expect(monthOf(new Date("2026-12-31T18:29:59.999Z"))).toBe("2026-12-01");
    expect(monthOf(new Date("2026-12-31T18:30:00Z"))).toBe("2027-01-01"); // the year turns in India first
    expect(monthOf(new Date("2026-11-01T01:00:00Z"))).toBe("2026-11-01"); // the feed's 01:00 UTC run, 06:30 IST
    // No daylight saving: the same offset in every month, and a month's end is the next month's start.
    const oct = monthBounds("2026-10-01");
    expect(oct).toEqual({ start: new Date("2026-09-30T18:30:00.000Z"), end: new Date("2026-10-31T18:30:00.000Z") });
    expect(monthBounds("2026-11-01").start).toEqual(oct.end);
    expect(monthBounds("2027-06-01").start).toEqual(new Date("2027-05-31T18:30:00.000Z"));
    expect(monthOf(oct.start)).toBe("2026-10-01");
    expect(monthOf(new Date(oct.end.getTime() - 1))).toBe("2026-10-01");
    expect(addMonths("2026-12", 1)).toBe("2027-01");
    expect(addMonths("2026-01", -1)).toBe("2025-12");
  });

  it("names no post: rows hold only the role, place, band and counts", () => {
    const { rows } = run([post()]);
    for (const r of rows) expect(Object.keys(r).sort()).toEqual(["band", "boardsOk", "city", "computedAt", "month", "newPosts", "openAtEnd", "roleSlug", "state"]);
  });
});
