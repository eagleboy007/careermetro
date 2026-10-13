import {
  EXAMPLE_SOURCE,
  INDIA_ROW,
  MARKET_BANDS,
  MARKET_MIN_OPENINGS,
  type MarketBand,
  type MarketMetric,
  type MarketPlace,
  type MarketRow,
  type MarketState,
  type MarketTable,
  type MarketTrend,
  type StateCode,
} from "@/lib/schemas";

/*
 * Market figures (handoff C6, dev/market-plan.md): plain code over the market table. Every figure needs at least
 * MARKET_MIN_OPENINGS openings a month behind it, or it is "Not enough data". India and state figures for pay combine
 * the rows below them weighted by openings.
 */

/**
 * `combined` is true when the figure merges several rows (India, or a state from its parts): then p25, median and p75
 * are openings-weighted averages, not true percentiles, and the screen says "about".
 */
export type Pay = { p25: number; median: number; p75: number; combined: boolean };
export type BandFigure = { openings: number; enough: boolean; pay: Pay | null };
/** Where a card's figures come from: the sources' names and the month they cover. */
export type Sourced = { sources: string[]; month: string };
export type Cell = Sourced & { openings: number; enough: boolean; bands: Record<MarketBand, BandFigure> };

/** The band the map, the state panel and the compare card use for "median pay". */
export const PAY_BAND: MarketBand = "3-5";

export const isExampleSource = (s: Sourced) => s.sources.length > 0 && s.sources.every((n) => n === EXAMPLE_SOURCE);

/** Both sides' sources together, for a card that shows two places. */
export const mergeSources = (a: Sourced, b: Sourced): Sourced => ({ sources: [...new Set([...a.sources, ...b.sources])], month: a.month > b.month ? a.month : b.month });

export type MarketData = ReturnType<typeof createMarket>;

/** Indexes the table once, so each figure reads only its own rows. */
export function createMarket(table: MarketTable, states: MarketState[]) {
  const byKey = new Map<string, MarketRow[]>();
  const key = (role: string, state: string, city: string | null, month: string) => `${role}|${state}|${city ?? ""}|${month}`;
  for (const r of table.rows) {
    const k = key(r.role, r.state, r.city, r.month);
    const list = byKey.get(k);
    if (list) list.push(r);
    else byKey.set(k, [r]);
  }
  const stateByCode = new Map(states.map((s) => [s.code, s]));
  const cityState = new Map(states.flatMap((s) => s.cities.map((c) => [c, s.code] as const)));
  const roles = [...new Set(table.rows.map((r) => r.role))];
  const months = [...new Set(table.rows.map((r) => r.month))].sort().slice(-12);
  // A cell with no rows still names the table's sources, so an empty cell never reads as example data by default.
  const tableSources = [...new Set(table.rows.map((r) => r.source))];

  // India reads its own rows (INDIA_ROW) when the table has them for the role and month, and adds up the states
  // otherwise, so a posting listed in two states is not counted twice.
  const rowsFor = (role: string, place: MarketPlace, month: string): MarketRow[] =>
    place.kind === "india"
      ? (byKey.get(key(role, INDIA_ROW, null, month)) ?? states.flatMap((s) => byKey.get(key(role, s.code, null, month)) ?? []))
      : (byKey.get(key(role, place.state, place.kind === "city" ? place.city : null, month)) ?? []);

  function cell(role: string, place: MarketPlace, month = table.latestMonth): Cell {
    const rows = rowsFor(role, place, month);
    const bands = Object.fromEntries(
      MARKET_BANDS.map((band) => {
        const inBand = rows.filter((r) => r.band === band);
        const openings = inBand.reduce((s, r) => s + r.openings, 0);
        const enough = openings >= MARKET_MIN_OPENINGS;
        const paid = inBand.filter((r) => r.payMedian !== null && r.openings > 0);
        const weight = paid.reduce((s, r) => s + r.openings, 0);
        const avg = (pick: (r: MarketRow) => number | null) => paid.reduce((s, r) => s + pick(r)! * r.openings, 0) / weight;
        // Pay needs 15 openings that carry pay, not just 15 openings in the band.
        const pay =
          weight >= MARKET_MIN_OPENINGS ? { p25: avg((r) => r.payP25), median: avg((r) => r.payMedian), p75: avg((r) => r.payP75), combined: paid.length > 1 } : null;
        return [band, { openings, enough, pay }];
      }),
    ) as Record<MarketBand, BandFigure>;
    const openings = rows.reduce((s, r) => s + r.openings, 0);
    return { openings, enough: openings >= MARKET_MIN_OPENINGS, bands, sources: rows.length ? [...new Set(rows.map((r) => r.source))] : tableSources, month };
  }

  return {
    latestMonth: table.latestMonth,
    months,
    roles,
    states,
    state: (code: StateCode) => stateByCode.get(code)!,
    stateOfCity: (city: string) => cityState.get(city),
    cell,
    /** The tile map: each state's figure for the role, or null when there is not enough data. */
    tiles(role: string, metric: MarketMetric) {
      return states.map((s) => {
        const c = cell(role, { kind: "state", state: s.code });
        const band = c.bands[PAY_BAND];
        const value = metric === "openings" ? (c.enough ? c.openings : null) : (band.pay?.median ?? null);
        return { state: s, value, cell: c };
      });
    },
    /** A state's top roles by openings this month, enough data only. */
    topRoles(state: StateCode, limit = 4) {
      return roles
        .map((role) => ({ role, cell: cell(role, { kind: "state", state }) }))
        .filter((x) => x.cell.enough)
        .sort((a, b) => b.cell.openings - a.cell.openings || a.role.localeCompare(b.role))
        .slice(0, limit);
    },
    /** Cities for the role: all of India's, or one state's. With `keepThin`, cities without enough data stay, last. */
    topCities(role: string, place: MarketPlace, { limit = 6, keepThin = false } = {}) {
      const list = place.kind === "india" ? states.flatMap((s) => s.cities.map((city) => ({ state: s.code, city }))) : stateByCode.get(place.state)!.cities.map((city) => ({ state: place.state, city }));
      return list
        .map((x) => ({ ...x, cell: cell(role, { kind: "city", state: x.state, city: x.city }) }))
        .filter((x) => keepThin || x.cell.enough)
        // Thin cities go last, by name, so their hidden counts don't show through the order.
        .sort((a, b) =>
          a.cell.enough !== b.cell.enough ? Number(b.cell.enough) - Number(a.cell.enough) : a.cell.enough ? b.cell.openings - a.cell.openings || a.city.localeCompare(b.city) : a.city.localeCompare(b.city),
        )
        .slice(0, limit);
    },
    /** Openings a month over the last 12 months, for India or a state (a city reads its state). */
    trend(role: string, place: MarketPlace) {
      const where: MarketPlace = place.kind === "city" ? { kind: "state", state: place.state } : place;
      const series = months.map((month) => cell(role, where, month));
      return { where, ...trendOf(series.map((c) => c.openings)), sources: [...new Set(series.flatMap((c) => c.sources))], month: months.at(-1) ?? table.latestMonth };
    },
  };
}

/**
 * Which way a role is moving: the last three months against the first three. Up 8% or more is Growing, down 8% or
 * more is Shrinking, anything between is Steady. Every month needs enough openings, or there is no trend to show.
 */
export function trendOf(openings: number[]): { points: number[]; enough: boolean; change: number; trend: MarketTrend } {
  const enough = openings.length === 12 && openings.every((o) => o >= MARKET_MIN_OPENINGS);
  const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
  const first = mean(openings.slice(0, 3));
  const change = enough && first > 0 ? mean(openings.slice(-3)) / first - 1 : 0;
  const trend: MarketTrend = change >= 0.08 ? "Growing" : change <= -0.08 ? "Shrinking" : "Steady";
  return { points: openings, enough, change, trend };
}

/** Five heat steps by rank: the lowest fifth of the states with data is step 1, the highest fifth step 5. */
export function heatSteps(values: (number | null)[]): (1 | 2 | 3 | 4 | 5 | null)[] {
  const shown = values.filter((v): v is number => v !== null).sort((a, b) => a - b);
  return values.map((v) => {
    if (v === null) return null;
    const rank = shown.indexOf(v);
    return Math.min(5, Math.floor((rank / shown.length) * 5) + 1) as 1 | 2 | 3 | 4 | 5;
  });
}

/** The lowest and highest value in each heat step, for the legend. Empty steps are null. */
export function heatRanges(values: (number | null)[]): ({ lo: number; hi: number } | null)[] {
  const steps = heatSteps(values);
  return [1, 2, 3, 4, 5].map((step) => {
    const inStep = values.filter((v, i): v is number => v !== null && steps[i] === step);
    return inStep.length ? { lo: Math.min(...inStep), hi: Math.max(...inStep) } : null;
  });
}

/** "₹6.5 L" under ten lakh, "₹14 L" from ten up. */
export const lakh = (v: number) => `₹${v >= 10 ? Math.round(v) : v.toFixed(1)} L`;
/** The median in words, with "about" when it combines several rows. */
export const payText = (p: Pick<Pay, "median" | "combined">) => `${p.combined ? "about " : ""}${lakh(p.median)}`;
/** The middle half in words: "₹5.7 L to ₹9.0 L", with "about" when combined. */
export const middleText = (p: Pay) => `${p.combined ? "about " : ""}${lakh(p.p25)} to ${lakh(p.p75)}`;
export const count = (n: number) => n.toLocaleString("en-IN");
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "2026-09" → "Sep 2026". */
export const monthLabel = (m: string) => `${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;
export const shortMonth = (m: string) => MONTHS[Number(m.slice(5, 7)) - 1]!;

/** "Karnataka", "Bengaluru" or "India". */
export function placeName(place: MarketPlace, market: Pick<MarketData, "state">): string {
  return place.kind === "india" ? "India" : place.kind === "state" ? market.state(place.state).name : place.city;
}

/** The two places compared, in words: "Pune has 40% fewer openings than Bengaluru, and 6% lower pay at 3–5 years." */
export function compareSentence(roleName: string, a: { name: string; cell: Cell }, b: { name: string; cell: Cell }): string | null {
  const pa = a.cell.bands[PAY_BAND].pay;
  const pb = b.cell.bands[PAY_BAND].pay;
  if (!a.cell.enough || !b.cell.enough || !pa || !pb || a.name === b.name) return null;
  const pct = (v: number) => `${Math.abs(Math.round(v * 100))}%`;
  const dO = b.cell.openings / a.cell.openings - 1;
  const dP = pb.median / pa.median - 1;
  const o = Math.abs(dO) < 0.03 ? `about as many openings as ${a.name}` : `${pct(dO)} ${dO > 0 ? "more" : "fewer"} openings than ${a.name}`;
  const p = Math.abs(dP) < 0.03 ? "about the same pay" : `${pct(dP)} ${dP > 0 ? "higher" : "lower"} pay`;
  return `For ${roleName}, ${b.name} has ${o}, and ${p} at 3–5 years.`;
}
