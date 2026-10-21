import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { roleProfiles } from "@/content";
import { createMarket, isExampleSource } from "@/lib/market/query";
import { FEED_SOURCE, INDIA_ROW } from "@/lib/schemas";
import { feedTableFromCsv } from "./feed";
import { market, MARKET_DATA } from "./index";
import { marketStates } from "./places";

// The openings feed loader (src/content/market/feed.ts) over a small synthetic market-rows.csv.
const csv = readFileSync(join(resolve(__dirname, "../../.."), "fixtures/market/market-rows.csv"), "utf8");
const opts = { roles: roleProfiles.map((r) => r.slug), states: marketStates };

describe("market feed loader", () => {
  it("reads market-rows.csv into validated market rows with the feed's source and month", () => {
    const { table } = feedTableFromCsv(csv, opts);
    expect(table.latestMonth).toBe("2026-11");
    expect(table.rows).toHaveLength(16);
    expect(table.rows.find((r) => r.state === "KA" && r.city === null && r.band === "3-5" && r.month === "2026-10")).toEqual({
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

  it("drops the baseline month, a stock count rather than a month's openings", () => {
    const { table, baselineMonth } = feedTableFromCsv(csv, opts);
    expect(baselineMonth).toBe("2026-09");
    expect(table.rows.some((r) => r.month === "2026-09")).toBe(false);
    expect(() => feedTableFromCsv(csv.split("\n").slice(0, 4).join("\n") + "\n", opts)).toThrow(/only the baseline/);
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
    expect(m.months).toEqual(["2026-10", "2026-11"]);
  });

  it("reads India from its own rows, so a posting in two states or only 'India' counts once", () => {
    const { table } = feedTableFromCsv(csv, opts);
    const m = createMarket(table, marketStates);
    // The states add up to 22 in October; the India rows say 19.
    expect(m.cell("data-analyst", { kind: "india" }, "2026-10").openings).toBe(19);
    // Two Remote - India postings count in India but in no state.
    expect(m.cell("full-stack-developer", { kind: "india" }).openings).toBe(5);
    // Without India rows, India still adds up the states.
    const noIndia = createMarket({ ...table, rows: table.rows.filter((r) => r.state !== INDIA_ROW) }, marketStates);
    expect(noIndia.cell("data-analyst", { kind: "india" }, "2026-10").openings).toBe(22);
  });

  it("refuses rows that aren't live roles, known cities or the feed's source", () => {
    const [header, baseline] = csv.split("\n");
    const row = (cells: string[]) => `${header}\n${baseline}\n${cells.map((c) => `"${c}"`).join(",")}\n`;
    const good = ["data-analyst", "KA", "Bengaluru", "3-5", "2", "", "", "", FEED_SOURCE, "2026-10"];
    expect(feedTableFromCsv(row(good), opts).table.rows).toHaveLength(1);
    expect(() => feedTableFromCsv(row(good.with(0, "astronaut")), opts)).toThrow(/not a live role/);
    expect(() => feedTableFromCsv(row(good.with(2, "Pune")), opts)).toThrow(/not a city of KA/);
    expect(() => feedTableFromCsv(row(good.with(1, INDIA_ROW)), opts)).toThrow(/not a city of IN/);
    expect(() => feedTableFromCsv(row(good.with(8, "Example data")), opts)).toThrow(/source/);
    expect(() => feedTableFromCsv(row(good.with(3, "3-6")), opts)).toThrow();
    expect(() => feedTableFromCsv(row(good.with(4, "2.5")), opts)).toThrow(/whole number/);
    expect(() => feedTableFromCsv(row(good.with(1, "XX")), opts)).toThrow();
    expect(() => feedTableFromCsv(`"role","state"\n`, opts)).toThrow(/header/);
    expect(() => feedTableFromCsv(`${header}\n`, opts)).toThrow();
  });

  it("is switched off: the screen reads live counts (docs/plans/market-trends-plan.md), and the static table is the example", () => {
    expect(MARKET_DATA).toBe("live");
    expect(market.rows.every((r) => r.source !== FEED_SOURCE)).toBe(true);
  });
});
