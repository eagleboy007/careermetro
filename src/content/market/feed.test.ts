import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { roleProfiles } from "@/content";
import { createMarket, isExampleSource } from "@/lib/market/query";
import { FEED_SOURCE } from "@/lib/schemas";
import { feedTableFromCsv } from "./feed";
import { market, MARKET_DATA } from "./index";
import { marketStates } from "./places";

// The openings feed loader (src/content/market/feed.ts) over a small synthetic market-rows.csv.
const csv = readFileSync(join(resolve(__dirname, "../../.."), "fixtures/market/market-rows.csv"), "utf8");
const opts = { roles: roleProfiles.map((r) => r.slug), states: marketStates };

describe("market feed loader", () => {
  it("reads market-rows.csv into validated market rows with the feed's source and month", () => {
    const { table, baselineMonth } = feedTableFromCsv(csv, opts);
    expect(table.latestMonth).toBe("2026-11");
    expect(baselineMonth).toBe("2026-10");
    expect(table.rows).toHaveLength(9);
    expect(table.rows[0]).toEqual({
      role: "data-analyst",
      state: "KA",
      city: null,
      band: "3-5",
      openings: 16,
      payP25: null,
      payMedian: null,
      payP75: null,
      source: FEED_SOURCE,
      month: "2026-10",
    });
    expect(table.rows.every((r) => r.source === FEED_SOURCE && r.payMedian === null)).toBe(true);
  });

  it("works with the screen's figures, which never call it example data", () => {
    const { table } = feedTableFromCsv(csv, opts);
    const m = createMarket(table, marketStates);
    const ka = m.cell("data-analyst", { kind: "state", state: "KA" }, "2026-10");
    expect(ka.openings).toBe(17);
    expect(ka.enough).toBe(true);
    expect(ka.bands["3-5"].pay).toBeNull();
    expect(isExampleSource(ka)).toBe(false);
    expect(m.cell("product-manager", { kind: "state", state: "HR" }).enough).toBe(false);
  });

  it("refuses rows that aren't live roles, known cities or the feed's source", () => {
    const header = csv.split("\n")[0];
    const row = (cells: string[]) => `${header}\n${cells.map((c) => `"${c}"`).join(",")}\n`;
    const good = ["data-analyst", "KA", "Bengaluru", "3-5", "2", "", "", "", FEED_SOURCE, "2026-10"];
    expect(feedTableFromCsv(row(good), opts).table.rows).toHaveLength(1);
    expect(() => feedTableFromCsv(row(good.with(0, "astronaut")), opts)).toThrow(/not a live role/);
    expect(() => feedTableFromCsv(row(good.with(2, "Pune")), opts)).toThrow(/not a city of KA/);
    expect(() => feedTableFromCsv(row(good.with(8, "Example data")), opts)).toThrow(/source/);
    expect(() => feedTableFromCsv(row(good.with(3, "3-6")), opts)).toThrow();
    expect(() => feedTableFromCsv(row(good.with(4, "2.5")), opts)).toThrow(/whole number/);
    expect(() => feedTableFromCsv(row(good.with(1, "XX")), opts)).toThrow();
    expect(() => feedTableFromCsv(`"role","state"\n`, opts)).toThrow(/header/);
    expect(() => feedTableFromCsv(`${header}\n`, opts)).toThrow();
  });

  it("is switched off: the screen still shows example data", () => {
    expect(MARKET_DATA).toBe("example");
    expect(market.rows.every((r) => r.source !== FEED_SOURCE)).toBe(true);
  });
});
