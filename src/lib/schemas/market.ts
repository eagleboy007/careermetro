import { z } from "zod";

/*
 * Market (handoff C6, dev/market-plan.md). One row shape for every market figure, so Data research's licensed tables
 * can replace the example rows without touching the screen: role × state [× city] × experience band, with openings a
 * month and pay as the middle half (p25 to p75) and the median, plus the source and the month it covers.
 */

/** Below this many openings a month a figure shows "Not enough data" instead of a number (C6). */
export const MARKET_MIN_OPENINGS = 15;

/** Experience bands, as Data research's salary tables give them (data/market/salaries.csv). */
export const MARKET_BANDS = ["0-2", "3-5", "6-10", "10+"] as const;
export type MarketBand = (typeof MARKET_BANDS)[number];
export const MARKET_BAND_LABELS: Record<MarketBand, string> = { "0-2": "0–2 yrs", "3-5": "3–5 yrs", "6-10": "6–10 yrs", "10+": "10+ yrs" };

/** The source every example row carries. The screen labels any row with it EXAMPLE DATA. */
export const EXAMPLE_SOURCE = "Example data";

/** India's 28 states and 8 union territories, by their usual two-letter codes. */
export const STATE_CODES = [
  "AN", "AP", "AR", "AS", "BR", "CG", "CH", "DH", "DL", "GA", "GJ", "HP", "HR", "JH", "JK", "KA", "KL", "LA",
  "LD", "MH", "ML", "MN", "MP", "MZ", "NL", "OD", "PB", "PY", "RJ", "SK", "TG", "TN", "TR", "UK", "UP", "WB",
] as const;
export const stateCode = z.enum(STATE_CODES);
export type StateCode = z.infer<typeof stateCode>;

const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "month is YYYY-MM");
/** Pay in lakh rupees a year, before tax. */
const lakh = z.number().positive().max(500);

export const marketRow = z
  .object({
    /** A live role profile's slug (a content test checks it). */
    role: z.string().regex(/^[a-z0-9-]+$/),
    state: stateCode,
    /** Null for the whole state. A city row is part of its state's row, never added to it. */
    city: z.string().min(1).max(60).nullable(),
    band: z.enum(MARKET_BANDS),
    /** Openings a month for this cell. */
    openings: z.number().int().min(0),
    /** Null when the source gives no pay for the cell. */
    payP25: lakh.nullable(),
    payMedian: lakh.nullable(),
    payP75: lakh.nullable(),
    source: z.string().min(1).max(120),
    month,
  })
  .strict()
  .refine((r) => [r.payP25, r.payMedian, r.payP75].every((v) => v === null) || [r.payP25, r.payMedian, r.payP75].every((v) => v !== null), {
    message: "pay is all three figures or none",
  })
  .refine((r) => r.payP25 === null || (r.payP25 <= r.payMedian! && r.payMedian! <= r.payP75!), { message: "p25 ≤ median ≤ p75" });
export type MarketRow = z.infer<typeof marketRow>;

/** A place a person can pick: all of India, a state or a city. */
export const marketPlace = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("india") }).strict(),
  z.object({ kind: z.literal("state"), state: stateCode }).strict(),
  z.object({ kind: z.literal("city"), state: stateCode, city: z.string().min(1).max(60) }).strict(),
]);
export type MarketPlace = z.infer<typeof marketPlace>;

/** A state's tile on the tile map: one square, placed roughly where the state is. */
export const marketState = z
  .object({
    code: stateCode,
    name: z.string().min(1).max(60),
    col: z.number().int().min(0).max(8),
    row: z.number().int().min(0).max(6),
    cities: z.array(z.string().min(1).max(60)).max(6),
  })
  .strict();
export type MarketState = z.infer<typeof marketState>;

/** The whole table: rows plus the latest month they cover. Validated once when the module loads. */
export const marketTable = z
  .object({
    latestMonth: month,
    rows: z.array(marketRow).min(1),
  })
  .strict()
  .superRefine((t, ctx) => {
    const seen = new Set<string>();
    for (const r of t.rows) {
      const key = `${r.role}|${r.state}|${r.city ?? ""}|${r.band}|${r.month}`;
      if (seen.has(key)) {
        ctx.addIssue({ code: "custom", message: `duplicate row ${key}` });
        return;
      }
      seen.add(key);
      if (r.month > t.latestMonth) {
        ctx.addIssue({ code: "custom", message: `row after the latest month: ${key}` });
        return;
      }
    }
  });
export type MarketTable = z.infer<typeof marketTable>;

/** The map can be coloured by openings or by the median pay at 3 to 5 years. */
export const MARKET_METRICS = ["openings", "pay"] as const;
export type MarketMetric = (typeof MARKET_METRICS)[number];

/** Which way a role is moving over 12 months. */
export const MARKET_TRENDS = ["Growing", "Steady", "Shrinking"] as const;
export type MarketTrend = (typeof MARKET_TRENDS)[number];
