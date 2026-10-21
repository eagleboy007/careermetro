import { describe, expect, it } from "vitest";
import { roleProfiles } from "@/content";
import { marketStates } from "@/content/market/places";
import { LIVE_SOURCE, liveMarketTable, MARKET_BANDS, MARKET_MIN_OPENINGS, type MarketRow } from "@/lib/schemas";
import { LIVE_FIXTURE_NOW, liveFixture, liveNothing } from "./fixtures";
import {
  addMonths,
  dayLabel,
  floorText,
  liveHeadline,
  liveMarket,
  liveSourceLine,
  MARKET_CARDS,
  marketCards,
  openingsWords,
  openRows,
  PAY_LATER,
  trendMonths,
  trendFrom,
  trendRows,
  trendWaitText,
  UNDERCOUNT_NOTE,
  type LiveInputs,
  type OpenGroup,
  type RollupGroup,
} from "./live";
import { isExampleSource } from "./query";

// Live counts on /market (docs/plans/market-trends-plan.md PR 2) over synthetic reads only: no board, no database.
const roles = roleProfiles.map((r) => r.slug);
const opts = { now: LIVE_FIXTURE_NOW, roles, states: marketStates };
const open = (o: Partial<OpenGroup>): OpenGroup => ({ roleSlug: "data-analyst", city: "Pune", experienceNote: "2 to 4 years", posts: 1, ...o });
const inputs = (o: Partial<LiveInputs>): LiveInputs => ({ ...liveNothing, lastRun: new Date("2026-10-21T01:20:00Z"), ...o });

describe("the live table", () => {
  it("takes rows with no band (posts that state no years) and may be empty", () => {
    const row: MarketRow = { role: "data-analyst", state: "KA", city: null, band: null, openings: 3, payP25: null, payMedian: null, payP75: null, source: LIVE_SOURCE, month: "2026-10" };
    expect(liveMarketTable.safeParse({ latestMonth: "2026-10", rows: [row] }).success).toBe(true);
    expect(liveMarketTable.safeParse({ latestMonth: "2026-10", rows: [] }).success).toBe(true);
    expect(liveMarketTable.safeParse({ latestMonth: "2026-10", rows: [row, { ...row, openings: 4 }] }).success).toBe(false);
    expect(liveMarketTable.safeParse({ latestMonth: "2026-10", rows: [{ ...row, state: "XX" }] }).success).toBe(false);
  });

  it("puts every city row in its city's state, as the rollup counts it", () => {
    const row: MarketRow = { role: "data-analyst", state: "MH", city: "Pune", band: "3-5", openings: 3, payP25: null, payMedian: null, payP75: null, source: LIVE_SOURCE, month: "2026-10" };
    expect(liveMarketTable.safeParse({ latestMonth: "2026-10", rows: [row] }).success).toBe(true);
    const wrong = liveMarketTable.safeParse({ latestMonth: "2026-10", rows: [{ ...row, state: "KA" }] });
    expect(wrong.success).toBe(false);
    expect(JSON.stringify(wrong.error?.issues)).toMatch(/Pune is not a city of KA/);
    expect(liveMarketTable.safeParse({ latestMonth: "2026-10", rows: [{ ...row, city: "Atlantis" }] }).success).toBe(false);
  });
});

describe("open posts as market rows", () => {
  it("counts a post in its city, its state and India; Remote and India in India only; with no pay", () => {
    const { rows } = openRows([open({ posts: 2 }), open({ city: "Remote", experienceNote: null, posts: 3 })], { month: "2026-10", roles });
    const at = (state: string, city: string | null, band: MarketRow["band"]) => rows.find((r) => r.state === state && r.city === city && r.band === band)?.openings;
    expect(at("IN", null, "0-2")).toBe(2);
    expect(at("MH", null, "0-2")).toBe(2);
    expect(at("MH", "Pune", "0-2")).toBe(2);
    expect(at("IN", null, null)).toBe(3);
    expect(rows).toHaveLength(4);
    expect(rows.every((r) => r.payP25 === null && r.payMedian === null && r.payP75 === null && r.source === LIVE_SOURCE)).toBe(true);
  });

  it("leaves out a role the Market doesn't offer, and counts what it left out", () => {
    const { rows, dropped } = openRows([open({ roleSlug: "astronaut", posts: 4 }), open({})], { month: "2026-10", roles });
    expect(dropped).toBe(4);
    expect(rows.every((r) => r.role === "data-analyst")).toBe(true);
  });
});

describe("the floor of 15 (D6)", () => {
  it("hides 14 open posts as Not enough data and shows 15", () => {
    const { market } = liveMarket(inputs({ open: [open({ posts: 14 }), open({ city: "Bengaluru", posts: 15 })] }), opts);
    const mh = market.cell("data-analyst", { kind: "state", state: "MH" });
    const ka = market.cell("data-analyst", { kind: "state", state: "KA" });
    expect([mh.openings, mh.enough]).toEqual([14, false]);
    expect([ka.openings, ka.enough]).toEqual([15, true]);
    const tiles = new Map(market.tiles("data-analyst", "openings").map((t) => [t.state.code, t.value]));
    expect(tiles.get("MH")).toBeNull();
    expect(tiles.get("KA")).toBe(15);
    expect(MARKET_MIN_OPENINGS).toBe(15);
  });

  it("counts posts with no stated years in the total but in no band", () => {
    const { market } = liveMarket(inputs({ open: [open({ city: "Bengaluru", posts: 10 }), open({ city: "Bengaluru", experienceNote: null, posts: 5 })] }), opts);
    const ka = market.cell("data-analyst", { kind: "state", state: "KA" });
    expect(ka.openings).toBe(15);
    expect(ka.enough).toBe(true);
    expect(MARKET_BANDS.reduce((s, b) => s + ka.bands[b].openings, 0)).toBe(10);
    expect(ka.bands["0-2"].enough).toBe(false);
  });

  it("reads India from its own rows, so a Remote post counts once there and in no state", () => {
    const { market } = liveMarket(liveFixture, opts);
    expect(market.cell("data-analyst", { kind: "india" }).openings).toBe(35);
    expect(market.cell("data-analyst", { kind: "state", state: "KA" }).enough).toBe(true);
    expect(market.cell("data-analyst", { kind: "state", state: "MH" }).enough).toBe(false);
    expect(market.topRoles("KA").map((x) => x.role)).toEqual(["data-engineer", "data-analyst"]);
  });

  it("reads an empty database as Not enough data everywhere, with no pay and no trend", () => {
    const { market } = liveMarket(liveNothing, opts);
    expect(market.tiles("data-analyst", "openings").every((t) => t.value === null)).toBe(true);
    expect(market.cell("data-analyst", { kind: "india" }).enough).toBe(false);
    expect(market.topCities("data-analyst", { kind: "india" })).toEqual([]);
    expect(market.trend("data-analyst", { kind: "india" }).enough).toBe(false);
    expect(market.live).toEqual({ asOf: null, countingSince: null, failed: false });
  });

  it("shows only Nearby lines when the counts couldn't be read, never Not enough data", () => {
    const { market } = liveMarket(liveNothing, { ...opts, failed: true });
    expect(market.live?.failed).toBe(true);
    expect(marketCards(market.live)).toEqual(["nearby"]);
    expect(marketCards(liveMarket(liveNothing, opts).market.live)).toEqual(MARKET_CARDS);
    expect(marketCards(null)).toEqual(MARKET_CARDS);
    expect(MARKET_CARDS).toEqual(["map", "trend", "pay", "cities", "compare", "nearby"]);
  });
});

describe("no pay on live counts (D3 (a))", () => {
  it("has no pay figure in any cell, band or map tile", () => {
    const { market } = liveMarket(liveFixture, opts);
    for (const role of ["data-analyst", "data-engineer"])
      for (const place of [{ kind: "india" as const }, { kind: "state" as const, state: "KA" as const }]) {
        const c = market.cell(role, place);
        expect(MARKET_BANDS.every((b) => c.bands[b].pay === null)).toBe(true);
      }
    expect(market.tiles("data-analyst", "pay").every((t) => t.value === null)).toBe(true);
    expect(PAY_LATER).toBe("Pay comes later: company job boards in India rarely state pay.");
  });
});

describe("the trend's months", () => {
  it("drops the rollup's first (baseline) month and the month not over yet, and keeps the latest 12", () => {
    expect(trendMonths(null, LIVE_FIXTURE_NOW)).toEqual([]);
    expect(trendMonths("2026-10-01", new Date("2026-10-21T00:00:00Z"))).toEqual([]);
    expect(trendMonths("2026-10-01", new Date("2026-12-02T00:00:00Z"))).toEqual(["2026-11"]);
    const long = trendMonths("2026-10-01", new Date("2028-03-05T00:00:00Z"));
    expect(long).toHaveLength(12);
    expect([long[0], long.at(-1)]).toEqual(["2027-03", "2028-02"]);
    expect(addMonths("2026-12", 1)).toBe("2027-01");
    expect(addMonths("2027-01", -1)).toBe("2026-12");
  });

  it("reads new posts a month for the trend months only", () => {
    const rollup: RollupGroup[] = [
      { month: "2026-10-01", roleSlug: "data-analyst", state: "IN", band: null, newPosts: 90 },
      { month: "2026-11-01", roleSlug: "data-analyst", state: "IN", band: "0-2", newPosts: 20 },
      { month: "2026-11-01", roleSlug: "astronaut", state: "IN", band: null, newPosts: 20 },
    ];
    expect(trendRows(rollup, { months: ["2026-11"], roles })).toEqual([
      expect.objectContaining({ role: "data-analyst", state: "IN", month: "2026-11", openings: 20, payMedian: null }),
    ]);
  });

  it("shows a trend once 12 months each have 15 new posts, and not with a month at 14", () => {
    const now = new Date("2027-11-03T00:00:00Z");
    const months = trendMonths("2026-10-01", now);
    const rollup = (n: (i: number) => number): RollupGroup[] => months.map((m, i) => ({ month: `${m}-01`, roleSlug: "data-analyst", state: "IN", band: null, newPosts: n(i) }));
    const at = (n: (i: number) => number) => liveMarket(inputs({ rollup: rollup(n), firstMonth: "2026-10-01" }), { ...opts, now }).market.trend("data-analyst", { kind: "india" });
    expect(months).toHaveLength(12);
    expect(at(() => 15).enough).toBe(true);
    expect(at((i) => (i === 4 ? 14 : 15)).enough).toBe(false);
    // A month with no rows reads as zero, not as a missing month.
    expect(at((i) => (i === 4 ? 0 : 20)).enough).toBe(false);
  });
});

describe("the words on live counts", () => {
  const live = { asOf: "2026-10-20", countingSince: "2026-10", failed: false };
  const none = { asOf: null, countingSince: null, failed: false };

  it("names the boards and the day in the header and the source lines, never example data", () => {
    expect(dayLabel("2026-10-20")).toBe("20 Oct 2026");
    expect(liveHeadline(live)).toBe("Open roles on public company job boards (Greenhouse, Lever, Ashby, SmartRecruiters), as of 20 Oct 2026.");
    expect(liveSourceLine("open", live)).toBe("Source: Open on public company job boards (Greenhouse, Lever, Ashby, SmartRecruiters) · 20 Oct 2026");
    expect(liveSourceLine("new", live)).toBe("Source: New each month on public company job boards (Greenhouse, Lever, Ashby, SmartRecruiters) · counting since Oct 2026");
    expect(liveSourceLine("pay", live)).toBe("Source: none yet");
    expect(liveSourceLine("open", none)).toMatch(/not read yet$/);
    expect(liveSourceLine("new", none)).toMatch(/not counted yet$/);
    for (const words of [liveHeadline(live), liveSourceLine("open", live), liveSourceLine("new", live), UNDERCOUNT_NOTE]) expect(words).not.toMatch(/example/i);
    const { market } = liveMarket(liveFixture, opts);
    expect(isExampleSource(market.cell("data-analyst", { kind: "india" }))).toBe(false);
    expect(isExampleSource(market.cell("ui-ux-designer", { kind: "india" }))).toBe(false);
    expect(market.live).toEqual({ asOf: "2026-10-21", countingSince: "2026-10", failed: false });
  });

  it("says counting since the first month and the month the trend shows from, then the floor", () => {
    expect(trendWaitText(live, [], null)).toBe("Counting since Oct 2026; the trend shows from Nov 2027.");
    expect(trendWaitText(live, ["2026-11"], "Karnataka")).toBe("Counting since Oct 2026; the trend shows from Nov 2027.");
    expect(trendWaitText({ ...live, countingSince: "2026-12" }, [], null)).toBe("Counting since Dec 2026; the trend shows from Jan 2028.");
    expect(trendWaitText(none, [], null)).toBe("Counting hasn't started yet; the trend shows 13 months after it starts.");
    // The month it names is the first month the trend's 12 months are all over: counting since Oct 2026, the trend
    // reads Nov 2026 to Oct 2027, so it shows from Nov 2027 and not before.
    expect(trendFrom("2026-10")).toBe("2027-11");
    // October 2027 ends at midnight IST, 18:30 UTC on 31 October (India months, monthOf in ./rollup.mjs).
    expect(trendMonths("2026-10-01", new Date("2027-10-31T18:29:00Z"))).toHaveLength(11);
    expect(trendMonths("2026-10-01", new Date("2027-10-31T18:30:00Z"))).toHaveLength(12);
    expect(trendMonths("2026-10-01", new Date("2027-10-31T18:30:00Z")).at(-1)).toBe("2027-10");
    const twelve = trendMonths("2026-10-01", new Date("2027-11-03T00:00:00Z"));
    expect(trendWaitText(live, twelve, "Karnataka")).toBe("A trend needs at least 15 new roles in each of the last 12 months in Karnataka.");
  });

  it("carries the undercount note: company boards only, skewed to tech, portals not read", () => {
    expect(UNDERCOUNT_NOTE).toMatch(/undercount/);
    expect(UNDERCOUNT_NOTE).toMatch(/only the companies on our list of public Greenhouse, Lever, Ashby and SmartRecruiters boards, so they lean to/);
    expect(UNDERCOUNT_NOTE).toMatch(/Remote posts count in India only\./);
    expect(UNDERCOUNT_NOTE).toMatch(/job portals/);
    expect(UNDERCOUNT_NOTE).toMatch(/first city it lists/);
  });

  it("says open roles, not a month's openings, and the floor in the same words", () => {
    expect(openingsWords(1240, true)).toBe("1,240 open now");
    expect(openingsWords(1240, false)).toBe("1,240 a month");
    expect(floorText(true)).toBe("We show a figure only when at least 15 open roles back it.");
    expect(floorText(false)).toBe("We show a figure only when at least 15 openings a month back it.");
  });
});
