// Builds the /market openings table from the monthly runs (.github/workflows/jd-mining.yml, dev/market-plan.md).
// Usage: node scripts/jd-mining/accumulate.mjs <prevDir> <outDir>
//   <outDir>/market-postings.csv   this run's India postings (url, role, state, city, band), written by mine.mjs
//   <prevDir>/market/seen.csv      every India posting seen before, with the month it was first seen
// Writes <outDir>/market/seen.csv and <outDir>/market/market-rows.csv (the marketRow shape, pay blank).
// A posting counts as an opening in the month it first appears; a repost of the same URL never counts twice.
// The run on the 1st counts the month that just ended, so its postings are labelled with the previous month
// (MARKET_MONTH=YYYY-MM overrides it). The first month in the table is a baseline: every posting open on that day
// counts as new, so it is a stock count, not a month's flow.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { parseCsvObjects, toCsv } from "../../src/lib/market/csv.mjs";
import { FEED_SOURCE, MARKET_POSTING_COLUMNS } from "./market.mjs";

export const SEEN_COLUMNS = [...MARKET_POSTING_COLUMNS, "month"];
export const ROW_COLUMNS = ["role", "state", "city", "band", "openings", "payP25", "payMedian", "payP75", "source", "month"];
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

/** The month before `date`'s, in UTC, as YYYY-MM. */
export function previousMonth(date) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() - 1, 1));
  return d.toISOString().slice(0, 7);
}

/**
 * Adds this run's postings to the ones seen before and counts openings: one row per role × state [× city] × band ×
 * month. A posting listing two cities in one state counts once in the state row. Postings that state no years have
 * no band and are left out of the rows (the row shape needs a band); postings with no city are left out too.
 */
export function accumulate({ seen: before, postings, month }) {
  if (!MONTH.test(month)) throw new Error(`month must be YYYY-MM, got ${month}`);
  const key = (p) => `${p.url}|${p.city}`;
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
  const stateSeen = new Set();
  const noBand = new Set();
  for (const s of seen) {
    if (!s.state) continue;
    if (!s.band) {
      noBand.add(s.url);
      continue;
    }
    const st = `${s.url}|${s.state}`;
    if (!stateSeen.has(st)) {
      stateSeen.add(st);
      add([s.role, s.state, "", s.band, s.month].join("|"));
    }
    if (s.city) add([s.role, s.state, s.city, s.band, s.month].join("|"));
  }
  // Sorted by role, state, city (the state row first), month and band.
  const order = (r) => [r[0], r[1], r[2], r[9], r[3]];
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

const readObjects = (file) => (existsSync(file) ? parseCsvObjects(readFileSync(file, "utf8")) : []);

function main() {
  const [prevDir, outDir] = process.argv.slice(2);
  if (!prevDir || !outDir) throw new Error("usage: accumulate.mjs <prevDir> <outDir>");
  const month = process.env.MARKET_MONTH || previousMonth(new Date());
  const postingsFile = join(outDir, "market-postings.csv");
  if (!existsSync(postingsFile)) throw new Error(`${postingsFile} is missing; run mine.mjs first`);
  const { seen, rows, stats } = accumulate({ seen: readObjects(join(prevDir, "market/seen.csv")), postings: readObjects(postingsFile), month });
  mkdirSync(join(outDir, "market"), { recursive: true });
  writeFileSync(join(outDir, "market/seen.csv"), toCsv([SEEN_COLUMNS, ...seen.map((s) => SEEN_COLUMNS.map((c) => s[c]))]));
  writeFileSync(join(outDir, "market/market-rows.csv"), toCsv([ROW_COLUMNS, ...rows]));
  console.log(
    `Market ${month}: ${stats.added} new India postings, ${stats.seen} seen in all, ${stats.rows} rows, ${stats.atLeast15} at 15 or more, ` +
      `${stats.noBand} postings without stated years. Baseline month: ${stats.baselineMonth}${stats.baselineMonth === month ? " (this run is the baseline: a stock count, not new openings)" : ""}.`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
