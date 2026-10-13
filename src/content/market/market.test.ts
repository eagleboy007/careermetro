import { describe, expect, it } from "vitest";
import { roleProfiles } from "@/content";
import { createMarket } from "@/lib/market/query";
import { EXAMPLE_SOURCE, STATE_CODES } from "@/lib/schemas";
import { exampleMonths } from "./example";
import { market, marketStates } from "./index";

describe("market places", () => {
  it("has one tile for each state and union territory, no two on the same square", () => {
    expect(marketStates.map((s) => s.code).sort()).toEqual([...STATE_CODES].sort());
    const squares = marketStates.map((s) => `${s.col},${s.row}`);
    expect(new Set(squares).size).toBe(squares.length);
  });

  it("names each city once, so a city link is never ambiguous", () => {
    const cities = marketStates.flatMap((s) => s.cities);
    expect(new Set(cities).size).toBe(cities.length);
  });
});

describe("example market table", () => {
  it("covers the live roles and nothing else", () => {
    expect(new Set(market.rows.map((r) => r.role))).toEqual(new Set(roleProfiles.map((r) => r.slug)));
  });

  it("is all example data, for the 12 months up to the latest", () => {
    expect(market.rows.every((r) => r.source === EXAMPLE_SOURCE)).toBe(true);
    expect(market.latestMonth).toBe("2026-09");
    expect([...new Set(market.rows.map((r) => r.month))].sort()).toEqual(exampleMonths());
    expect(exampleMonths()[0]).toBe("2025-10");
  });

  it("puts each city row in its own state and never above the state's openings", () => {
    const stateRow = new Map(market.rows.filter((r) => r.city === null).map((r) => [`${r.role}|${r.state}|${r.band}|${r.month}`, r.openings]));
    for (const r of market.rows.filter((x) => x.city !== null)) {
      expect(marketStates.find((s) => s.code === r.state)!.cities).toContain(r.city);
      expect(r.month).toBe(market.latestMonth);
      expect(r.openings).toBeLessThanOrEqual(stateRow.get(`${r.role}|${r.state}|${r.band}|${r.month}`) ?? 0);
    }
  });

  it("has thin places as well as full ones, so the screen shows both", () => {
    const m = createMarket(market, marketStates);
    expect(m.cell("data-analyst", { kind: "state", state: "MZ" }).enough).toBe(false);
    expect(m.cell("data-analyst", { kind: "city", state: "KA", city: "Bengaluru" }).enough).toBe(true);
    expect(m.cell("data-analyst", { kind: "city", state: "MH", city: "Pune" }).enough).toBe(true);
    expect(m.trend("data-analyst", { kind: "india" }).enough).toBe(true);
    // Every trend word appears for some role.
    const words = new Set(m.roles.map((role) => m.trend(role, { kind: "india" }).trend));
    expect(words).toEqual(new Set(["Growing", "Steady", "Shrinking"]));
  });
});
