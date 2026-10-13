import { describe, expect, it } from "vitest";
import { marketPlace, marketRow, marketState, marketTable, STATE_CODES, type MarketRow } from "./market";

const row: MarketRow = {
  role: "data-analyst",
  state: "KA",
  city: "Bengaluru",
  band: "3-5",
  openings: 40,
  payP25: 6.2,
  payMedian: 7.5,
  payP75: 9.4,
  source: "Example data",
  month: "2026-09",
};

describe("market row", () => {
  it("takes the one shape: role × state [× city] × band, openings, p25, median, p75, source, month", () => {
    expect(marketRow.parse(row)).toEqual(row);
    expect(marketRow.parse({ ...row, city: null }).city).toBeNull();
    expect(marketRow.safeParse({ ...row, extra: 1 }).success).toBe(false);
  });

  it("refuses an unknown state, band or month", () => {
    expect(marketRow.safeParse({ ...row, state: "XX" }).success).toBe(false);
    expect(marketRow.safeParse({ ...row, band: "5-7" }).success).toBe(false);
    expect(marketRow.safeParse({ ...row, month: "2026-13" }).success).toBe(false);
    expect(marketRow.safeParse({ ...row, month: "Sep 2026" }).success).toBe(false);
  });

  it("needs whole openings and pay in order, all three figures or none", () => {
    expect(marketRow.safeParse({ ...row, openings: -1 }).success).toBe(false);
    expect(marketRow.safeParse({ ...row, openings: 1.5 }).success).toBe(false);
    expect(marketRow.safeParse({ ...row, payP25: 8 }).success).toBe(false);
    expect(marketRow.safeParse({ ...row, payP75: 7 }).success).toBe(false);
    expect(marketRow.safeParse({ ...row, payMedian: null }).success).toBe(false);
    expect(marketRow.safeParse({ ...row, payP25: null, payMedian: null, payP75: null }).success).toBe(true);
    expect(marketRow.safeParse({ ...row, source: "" }).success).toBe(false);
  });

  it("lists the 28 states and 8 union territories once each", () => {
    expect(STATE_CODES).toHaveLength(36);
    expect(new Set(STATE_CODES).size).toBe(36);
  });
});

describe("market table", () => {
  it("refuses a duplicate cell and a row after the latest month", () => {
    expect(marketTable.safeParse({ latestMonth: "2026-09", rows: [row] }).success).toBe(true);
    expect(marketTable.safeParse({ latestMonth: "2026-09", rows: [row, { ...row, openings: 3 }] }).success).toBe(false);
    expect(marketTable.safeParse({ latestMonth: "2026-08", rows: [row] }).success).toBe(false);
    expect(marketTable.safeParse({ latestMonth: "2026-09", rows: [] }).success).toBe(false);
  });
});

describe("market places and tiles", () => {
  it("parses India, a state and a city", () => {
    expect(marketPlace.parse({ kind: "india" })).toEqual({ kind: "india" });
    expect(marketPlace.safeParse({ kind: "state", state: "TN" }).success).toBe(true);
    expect(marketPlace.safeParse({ kind: "city", state: "TN", city: "Chennai" }).success).toBe(true);
    expect(marketPlace.safeParse({ kind: "city", state: "TN" }).success).toBe(false);
  });

  it("keeps tiles on the 9 × 7 grid", () => {
    expect(marketState.safeParse({ code: "KA", name: "Karnataka", col: 1, row: 5, cities: ["Bengaluru"] }).success).toBe(true);
    expect(marketState.safeParse({ code: "KA", name: "Karnataka", col: 9, row: 5, cities: [] }).success).toBe(false);
    expect(marketState.safeParse({ code: "KA", name: "Karnataka", col: 1, row: 7, cities: [] }).success).toBe(false);
  });
});
