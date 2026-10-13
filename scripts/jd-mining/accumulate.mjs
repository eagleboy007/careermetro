// Builds the /market openings table from the monthly runs (.github/workflows/jd-mining.yml, dev/market-plan.md).
// Usage: node scripts/jd-mining/accumulate.mjs <marketDir> <postingsCsv>
//   <postingsCsv>          this run's India postings (url, role, state, city, band), written by mine.mjs
//   <marketDir>/seen.csv   every India posting seen before, with the month it was first seen (the data/market branch)
// Updates <marketDir>/seen.csv and writes <marketDir>/market-rows.csv (the marketRow shape, pay blank).
// A posting counts as an opening in the month it first appears; a repost of the same URL never counts twice.
// The run on the 1st counts the month that just ended, so its postings are labelled with the previous month
// (MARKET_MONTH=YYYY-MM overrides it). The first month in the table is a baseline: every posting open on that day
// counts as new, so it is a stock count, not a month's flow. Without seen.csv the run refuses to start a new baseline
// unless MARKET_BASELINE=1 says it is the first run, so a lost file never silently restarts the history.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { parseCsvObjects, toCsv } from "../../src/lib/market/csv.mjs";
import { FEED_SOURCE, MARKET_POSTING_COLUMNS } from "./market.mjs";

export const SEEN_COLUMNS = [...MARKET_POSTING_COLUMNS, "month"];
export const ROW_COLUMNS = ["role", "state", "city", "band", "openings", "payP25", "payMedian", "payP75", "source", "month"];
/** The state code of the all-India row (INDIA_ROW in src/lib/schemas/market.ts). */
export const INDIA_ROW = "IN";
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

/** The month before `date`'s, in UTC, as YYYY-MM. */
export function previousMonth(date) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() - 1, 1));
  return d.toISOString().slice(0, 7);
}

/**
 * Adds this run's postings to the ones seen before and counts openings: one row per role × place × band × month.
 * The India row ("IN") counts each posting once, wherever it lists and including "Remote - India". A state row counts
 * a posting once however many of its cities it lists; a city row counts it per city. Postings that state no years
 * have no band and are left out of the rows (the row shape needs a band).
 */
export function accumulate({ seen: before, postings, month }) {
  if (!MONTH.test(month)) throw new Error(`month must be YYYY-MM, got ${month}`);
  const key = (p) => `${p.url}|${p.state}|${p.city}`;
  const seen = before.map((s) => ({ ...s }));
  const known = new Set(seen.map(key));
  let added = 0;
  for (const p of postings) {
    if (known.has(key(p))) continue;
    known.add(key(p));
    seen.push({ url: p.url, role: p.role, state: p.state, city: p.city, band: p.band, month });
    added++;
  }

  const counts = new Map();
  const add = (k) => counts.set(k, (counts.get(k) ?? 0) + 1);
  const once = new Set();
  const first = (k) => !once.has(k) && once.add(k);
  const noBand = new Set();
  for (const s of seen) {
    if (!s.band) {
      noBand.add(s.url);
      continue;
    }
    if (first(s.url)) add([s.role, INDIA_ROW, "", s.band, s.month].join("|"));
    if (!s.state) continue;
    if (first(`${s.url}|${s.state}`)) add([s.role, s.state, "", s.band, s.month].join("|"));
    if (s.city) add([s.role, s.state, s.city, s.band, s.month].join("|"));
  }
  // Sorted by role, place (India, then each state followed by its cities), month and band.
  const order = (r) => [r[0], r[1] === INDIA_ROW ? "" : r[1], r[2], r[9], r[3]];
  const rows = [...counts]
    .map(([k, n]) => {
      const [role, state, city, band, m] = k.split("|");
      return [role, state, city, band, n, "", "", "", FEED_SOURCE, m];
    })
    .sort((a, b) => {
      const [x, y] = [order(a), order(b)];
      const i = x.findIndex((v, j) => v !== y[j]);
      return i < 0 ? 0 : x[i] < y[i] ? -1 : 1;
    });
  const months = [...new Set(seen.map((s) => s.month))].sort();
  return { seen, rows, stats: { seen: seen.length, added, rows: rows.length, atLeast15: rows.filter((r) => r[4] >= 15).length, noBand: noBand.size, baselineMonth: months[0] ?? month } };
}

/**
 * The command line: reads seen.csv from marketDir and this run's postings, and writes both files back to marketDir.
 * @param {string[]} argv
 * @param {Record<string, string | undefined>} env
 */
export function main(argv = process.argv.slice(2), env = process.env) {
  const [marketDir, postingsFile] = argv;
  if (!marketDir || !postingsFile) throw new Error("usage: accumulate.mjs <marketDir> <postingsCsv>");
  if (!existsSync(marketDir)) throw new Error(`${marketDir} is missing`);
  if (!existsSync(postingsFile)) throw new Error(`${postingsFile} is missing; run mine.mjs first`);
  const seenFile = join(marketDir, "seen.csv");
  const baseline = !existsSync(seenFile);
  if (baseline && env.MARKET_BASELINE !== "1")
    throw new Error(`${seenFile} is missing. Set MARKET_BASELINE=1 only for the very first run; otherwise restore the file from the data/market branch.`);
  const month = env.MARKET_MONTH || previousMonth(new Date());
  const read = (file) => parseCsvObjects(readFileSync(file, "utf8"));
  const { seen, rows, stats } = accumulate({ seen: baseline ? [] : read(seenFile), postings: read(postingsFile), month });
  writeFileSync(seenFile, toCsv([SEEN_COLUMNS, ...seen.map((s) => SEEN_COLUMNS.map((c) => s[c]))]));
  writeFileSync(join(marketDir, "market-rows.csv"), toCsv([ROW_COLUMNS, ...rows]));
  console.log(
    `Market ${month}: ${stats.added} new India postings, ${stats.seen} seen in all, ${stats.rows} rows, ${stats.atLeast15} at 15 or more, ` +
      `${stats.noBand} postings without stated years. Baseline month: ${stats.baselineMonth}${stats.baselineMonth === month ? " (this run is the baseline: a stock count, not new openings)" : ""}.`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
