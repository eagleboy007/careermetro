import { describe, expect, it } from "vitest";
import type { MarketRow, MarketState, MarketTable } from "@/lib/schemas";
import { compareSentence, count, createMarket, heatRanges, heatSteps, isExampleSource, lakh, mergeSources, middleText, monthLabel, payText, trendOf } from "./query";

const states: MarketState[] = [
  { code: "KA", name: "Karnataka", col: 1, row: 5, cities: ["Bengaluru", "Mysuru"] },
  { code: "MZ", name: "Mizoram", col: 7, row: 5, cities: ["Aizawl"] },
];
const r = (o: Partial<MarketRow>): MarketRow => ({
  role: "data-analyst",
  state: "KA",
  city: null,
  band: "3-5",
  openings: 20,
  payP25: 8,
  payMedian: 10,
  payP75: 12,
  source: "Example data",
  month: "2026-09",
  ...o,
});
const table: MarketTable = {
  latestMonth: "2026-09",
  rows: [
    r({}),
    r({ band: "0-2", openings: 10, payP25: 4, payMedian: 5, payP75: 6 }),
    r({ city: "Bengaluru", openings: 16 }),
    r({ city: "Mysuru", openings: 4 }),
    r({ state: "MZ", openings: 14 }),
    r({ role: "qa-automation-engineer", openings: 40 }),
  ],
};
const market = createMarket(table, states);

describe("market cells", () => {
  it("adds openings across bands and shows a figure only from 15 a month", () => {
    const ka = market.cell("data-analyst", { kind: "state", state: "KA" });
    expect(ka.openings).toBe(30);
    expect(ka.enough).toBe(true);
    expect(ka.bands["3-5"].pay).toEqual({ p25: 8, median: 10, p75: 12, combined: false });
    // 10 openings at 0-2 years: under the line, so no pay for that band.
    expect(ka.bands["0-2"]).toEqual({ openings: 10, enough: false, pay: null });
    expect(ka.sources).toEqual(["Example data"]);
    expect(ka.month).toBe("2026-09");
  });

  it("says not enough below 15, and for a place with no rows at all", () => {
    expect(market.cell("data-analyst", { kind: "state", state: "MZ" }).enough).toBe(false);
    expect(market.cell("data-analyst", { kind: "city", state: "KA", city: "Mysuru" }).enough).toBe(false);
    const none = market.cell("ui-ux-designer", { kind: "india" });
    // An empty cell names the table's sources rather than defaulting to example data.
    expect([none.openings, none.enough, none.sources]).toEqual([0, false, ["Example data"]]);
  });

  it("combines India from the state rows, never adding city rows on top, with pay weighted by openings", () => {
    const india = market.cell("data-analyst", { kind: "india" });
    expect(india.openings).toBe(44);
    const pay = india.bands["3-5"].pay!;
    expect(pay.median).toBeCloseTo(10);
    const mixed = createMarket({ latestMonth: "2026-09", rows: [r({}), r({ state: "MZ", openings: 60, payP25: 16, payMedian: 20, payP75: 24 })] }, states);
    expect(mixed.cell("data-analyst", { kind: "india" }).bands["3-5"].pay!.median).toBeCloseTo((20 * 10 + 60 * 20) / 80);
  });

  it("needs 15 openings that carry pay before it shows pay, and says when pay is combined", () => {
    const thinPay = createMarket(
      { latestMonth: "2026-09", rows: [r({ openings: 3 }), r({ state: "MZ", openings: 20, payP25: null, payMedian: null, payP75: null })] },
      states,
    );
    const band = thinPay.cell("data-analyst", { kind: "india" }).bands["3-5"];
    expect([band.openings, band.enough, band.pay]).toEqual([23, true, null]);
    const both = createMarket({ latestMonth: "2026-09", rows: [r({}), r({ state: "MZ", openings: 20 })] }, states);
    expect(both.cell("data-analyst", { kind: "india" }).bands["3-5"].pay!.combined).toBe(true);
    expect(both.cell("data-analyst", { kind: "state", state: "KA" }).bands["3-5"].pay!.combined).toBe(false);
  });

  it("colours the map by openings or by the median at 3-5 years, null where data is thin", () => {
    expect(market.tiles("data-analyst", "openings").map((t) => [t.state.code, t.value])).toEqual([["KA", 30], ["MZ", null]]);
    expect(market.tiles("data-analyst", "pay").map((t) => t.value)).toEqual([10, null]);
  });

  it("ranks a state's roles and a role's cities, leaving out thin ones unless asked", () => {
    expect(market.topRoles("KA").map((x) => x.role)).toEqual(["qa-automation-engineer", "data-analyst"]);
    expect(market.topCities("data-analyst", { kind: "state", state: "KA" }).map((x) => x.city)).toEqual(["Bengaluru"]);
    expect(market.topCities("data-analyst", { kind: "state", state: "KA" }, { keepThin: true }).map((x) => [x.city, x.cell.enough])).toEqual([
      ["Bengaluru", true],
      ["Mysuru", false],
    ]);
    expect(market.topCities("data-analyst", { kind: "india" }).map((x) => x.city)).toEqual(["Bengaluru"]);
  });

  it("puts thin cities last by name, so their hidden counts don't show through the order", () => {
    const m = createMarket({ latestMonth: "2026-09", rows: [r({ city: "Mysuru", openings: 9 }), r({ city: "Bengaluru", openings: 2 })] }, states);
    expect(m.topCities("data-analyst", { kind: "state", state: "KA" }, { keepThin: true }).map((x) => x.city)).toEqual(["Bengaluru", "Mysuru"]);
  });

  it("reads a city's trend from its state", () => {
    expect(market.trend("data-analyst", { kind: "city", state: "KA", city: "Bengaluru" }).where).toEqual({ kind: "state", state: "KA" });
  });
});

describe("trend", () => {
  const flat = Array(12).fill(100);
  it("calls 8% up Growing, 8% down Shrinking and anything between Steady", () => {
    expect(trendOf(flat).trend).toBe("Steady");
    expect(trendOf([...Array(9).fill(100), 108, 108, 108]).trend).toBe("Growing");
    expect(trendOf([...Array(9).fill(100), 92, 91, 91]).trend).toBe("Shrinking");
    expect(trendOf([...Array(9).fill(100), 105, 105, 105]).trend).toBe("Steady");
  });

  it("needs 12 months of at least 15 openings each", () => {
    expect(trendOf(flat).enough).toBe(true);
    expect(trendOf([...Array(11).fill(100), 14]).enough).toBe(false);
    expect(trendOf(Array(11).fill(100)).enough).toBe(false);
  });
});

describe("heat steps", () => {
  it("splits the states with data into five steps by rank, and leaves thin ones out", () => {
    expect(heatSteps([10, 20, 30, 40, 50, null])).toEqual([1, 2, 3, 4, 5, null]);
    expect(heatSteps([5, 5, 100])).toEqual([1, 1, 4]);
    expect(heatSteps([null, null])).toEqual([null, null]);
  });

  it("gives each step its range for the legend", () => {
    expect(heatRanges([10, 20, 30, 40, 50, 60, null])).toEqual([{ lo: 10, hi: 20 }, { lo: 30, hi: 30 }, { lo: 40, hi: 40 }, { lo: 50, hi: 50 }, { lo: 60, hi: 60 }]);
    expect(heatRanges([7])).toEqual([{ lo: 7, hi: 7 }, null, null, null, null]);
  });
});

describe("words", () => {
  it("says example only when every source is the example, and merges two cards' sources", () => {
    expect(isExampleSource({ sources: ["Example data"], month: "2026-09" })).toBe(true);
    expect(isExampleSource({ sources: [], month: "2026-09" })).toBe(false);
    expect(isExampleSource({ sources: ["Example data", "Licensed feed"], month: "2026-09" })).toBe(false);
    expect(mergeSources({ sources: ["Example data"], month: "2026-08" }, { sources: ["Licensed feed", "Example data"], month: "2026-09" })).toEqual({
      sources: ["Example data", "Licensed feed"],
      month: "2026-09",
    });
  });

  it("says about for combined pay", () => {
    expect(payText({ median: 7.24, combined: true })).toBe("about ₹7.2 L");
    expect(payText({ median: 7.24, combined: false })).toBe("₹7.2 L");
    expect(middleText({ p25: 5.7, median: 7, p75: 9, combined: true })).toBe("about ₹5.7 L to ₹9.0 L");
  });

  it("formats pay, counts and months", () => {
    expect([lakh(6.54), lakh(14.4), count(12345), monthLabel("2026-09")]).toEqual(["₹6.5 L", "₹14 L", "12,345", "Sep 2026"]);
  });

  it("compares two places in one sentence, and says nothing when either is thin", () => {
    const a = { name: "Bengaluru", cell: market.cell("data-analyst", { kind: "state", state: "KA" }) };
    const b = { name: "Pune", cell: { ...a.cell, openings: 18, bands: { ...a.cell.bands, "3-5": { openings: 18, enough: true, pay: { p25: 9, median: 11, p75: 13, combined: false } } } } };
    expect(compareSentence("Data Analyst", a, b)).toBe("For Data Analyst, Pune has 40% fewer openings than Bengaluru, and 10% higher pay at 3–5 years.");
    expect(compareSentence("Data Analyst", a, { name: "Pune", cell: a.cell })).toBe(
      "For Data Analyst, Pune has about as many openings as Bengaluru, and about the same pay at 3–5 years.",
    );
    expect(compareSentence("Data Analyst", a, { name: "Mizoram", cell: market.cell("data-analyst", { kind: "state", state: "MZ" }) })).toBeNull();
    expect(compareSentence("Data Analyst", a, a)).toBeNull();
  });
});
