// The board check (.github/workflows/departures-boards-check.yml; docs/plans/departures-live-plan.md). Reads the
// candidate boards Data research collected (scripts/departures/board-candidates.csv) and asks each one once, through
// the same public job-board API address, timeout, size cap, https-only rule and no-redirect rule as the daily feed
// (feedUrl and getJson), then counts its postings and its India posts by the feed's own rules (boardRows). It prints
// one line per board (ats, token, HTTP status or error code, total, India) and a summary, and writes the boards that
// pass (status 200 and at least one India post) as ready-to-paste src/content/job-boards.json entries.
//
// It writes nothing to any database, needs no secret, and logs board tokens and counts only, never post text.
// Usage: node scripts/departures/check-boards.mjs [candidates.csv] [passing.json]
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { careersUrlOf, feedUrl, skillMatchersFor } from "../../src/lib/departures/feed-rules.mjs";
import { ATS, jobBoard } from "../../src/lib/departures/feed-schemas.mjs";
import { boardRows, getJson } from "./fetch-feeds.mjs";

const root = new URL("../../", import.meta.url);

/** Who the passing entries name as having added them. */
export const ADDED_BY = "Data research (checked by the board check)";

/** @typedef {import("../../src/lib/departures/feed-rules.mjs").Ats} Ats */
/** @typedef {{ company: string; ats: Ats; token: string; host?: "eu" }} Candidate */
/**
 * `status`: "200", another HTTP status, or the feed's short error code ("timeout", "too_large", "not_json", "network",
 * "invalid"). `truncated`: more India posts than one SmartRecruiters page, so `total` is a floor.
 * @typedef {{ company: string; ats: Ats; token: string; host?: "eu"; status: string; total: number; india: number; truncated?: boolean }} CheckResult
 */

/**
 * The rows of a CSV file (RFC 4180: quoted fields may hold commas, line breaks and doubled quotes), as objects keyed by
 * the header row. Blank lines are skipped.
 * @param {string} text
 * @returns {Record<string, string>[]}
 */
export function parseCsv(text) {
  /** @type {string[][]} */
  const records = [];
  /** @type {string[]} */
  let record = [];
  let field = "";
  let quoted = false;
  const src = text.replace(/^﻿/, "");
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"' && field === "") quoted = true;
    else if (c === ",") {
      record.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      record.push(field);
      records.push(record);
      record = [];
      field = "";
    } else field += c;
  }
  if (field !== "" || record.length) {
    record.push(field);
    records.push(record);
  }
  const rows = records.filter((r) => r.some((f) => f.trim() !== ""));
  const [header, ...body] = rows;
  if (!header) return [];
  const keys = header.map((h) => h.trim());
  return body.map((r) => Object.fromEntries(keys.map((k, i) => [k, (r[i] ?? "").trim()])));
}

/**
 * The boards to check, from the candidate rows: each with a known ATS and a token the board list accepts, each ATS and
 * token once (as job-boards.json counts them). A Greenhouse row whose api_host_note names the EU host gets `host: "eu"`.
 * Rows that can't be a board are counted, not checked.
 * @param {Record<string, string>[]} rows
 * @returns {{ boards: Candidate[]; skipped: number }}
 */
export function candidatesFrom(rows) {
  /** @type {Candidate[]} */
  const boards = [];
  const seen = new Set();
  let skipped = 0;
  for (const r of rows) {
    const ats = /** @type {Ats} */ ((r.ats ?? "").toLowerCase());
    const host = ats === "greenhouse" && /eu\.greenhouse\.io/i.test(r.api_host_note ?? "") ? /** @type {const} */ ("eu") : undefined;
    const company = r.company ?? "";
    const token = r.token ?? "";
    const key = `${ats}:${token.toLowerCase()}`;
    const valid = ATS.includes(ats) && jobBoard.safeParse(entryOf({ company, ats, token, host }, "2026-01-01")).success;
    if (!valid || seen.has(key)) {
      skipped++;
      continue;
    }
    seen.add(key);
    boards.push({ company, ats, token, ...(host ? { host } : {}) });
  }
  return { boards, skipped };
}

/**
 * One board's job-boards.json entry, keys in the file's order.
 * @param {Candidate} b
 * @param {string} addedOn
 */
export function entryOf(b, addedOn) {
  return {
    company: b.company,
    ats: b.ats,
    token: b.token,
    ...(b.host ? { host: b.host } : {}),
    careersUrl: careersUrlOf(b.ats, b.token, b.host),
    addedBy: ADDED_BY,
    addedOn,
  };
}

/**
 * The boards that pass (status 200 and at least one India post), as checked job-boards.json entries, in the order
 * checked.
 * @param {CheckResult[]} results
 * @param {string} addedOn YYYY-MM-DD
 */
export function passingEntries(results, addedOn) {
  return results.filter((r) => r.status === "200" && r.india >= 1).map((r) => jobBoard.parse(entryOf(r, addedOn)));
}

/**
 * Asks every board once, a few at a time with a pause between one worker's requests, and counts its postings and its
 * India posts as the feed would keep them.
 * @param {Candidate[]} boards
 * @param {import("../../src/lib/departures/feed-rules.mjs").SkillMatcher[]} matchers
 * @param {{ fetchImpl?: typeof fetch; timeoutMs?: number; maxBytes?: number; concurrency?: number; delayMs?: number }} [deps]
 * @returns {Promise<CheckResult[]>}
 */
export async function checkBoards(boards, matchers, deps = {}) {
  const { concurrency = 6, delayMs = 750 } = deps;
  /** @type {(CheckResult | undefined)[]} */
  const results = Array.from({ length: boards.length });
  let next = 0;
  const pause = () => new Promise((done) => setTimeout(done, delayMs));
  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(concurrency, boards.length)) }, async () => {
      let first = true;
      while (next < boards.length) {
        const i = next++;
        if (!first && delayMs > 0) await pause();
        first = false;
        const b = boards[i];
        const base = { company: b.company, ats: b.ats, token: b.token, ...(b.host ? { host: b.host } : {}) };
        const got = await getJson(feedUrl(b.ats, b.token, b.host), deps);
        if (!got.ok) {
          results[i] = { ...base, status: got.error, total: 0, india: 0 };
          continue;
        }
        const read = boardRows(b, got.data, matchers);
        results[i] = read.ok
          ? { ...base, status: "200", total: read.total, india: read.rows.length, ...(read.truncated ? { truncated: true } : {}) }
          : { ...base, status: read.error, total: 0, india: 0 };
      }
    }),
  );
  return /** @type {CheckResult[]} */ (results);
}

/** One line per board and a summary: ats, token, status and counts only. */
export function reportLines(/** @type {CheckResult[]} */ results, /** @type {number} */ passing, /** @type {number} */ skipped) {
  const lines = results.map((r) => [r.ats + (r.host ? "(eu)" : ""), r.token, r.status, `${r.total}${r.truncated ? "+" : ""}`, r.india].join("\t"));
  /** @type {Map<string, number>} */
  const byStatus = new Map();
  for (const r of results) byStatus.set(r.status, (byStatus.get(r.status) ?? 0) + 1);
  lines.push(
    "",
    `Boards checked: ${results.length}. Passing (200 and at least 1 India post): ${passing}. Rows skipped (not a board, or listed twice): ${skipped}.`,
    `By status: ${[...byStatus].sort(([a], [b]) => a.localeCompare(b)).map(([s, n]) => `${s} ${n}`).join(", ")}.`,
  );
  return lines;
}

export async function main(argv = process.argv.slice(2)) {
  const csvPath = argv[0] ?? new URL("scripts/departures/board-candidates.csv", root);
  const outPath = argv[1] ?? "board-check-passing.json";
  const { boards, skipped } = candidatesFrom(parseCsv(readFileSync(csvPath, "utf8")));
  const skills = JSON.parse(readFileSync(new URL("src/content/skills.json", root), "utf8"));
  const results = await checkBoards(boards, skillMatchersFor(skills));
  const passing = passingEntries(results, new Date().toISOString().slice(0, 10));
  writeFileSync(outPath, `${JSON.stringify(passing, null, 2)}\n`);
  console.log(["ats", "token", "status", "total", "india"].join("\t"));
  const lines = reportLines(results, passing.length, skipped);
  for (const line of lines) console.log(line);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## Board check\n\n${lines.slice(-2).join("\n\n")}\n`);
  // Every board failing is the runner's network, not the boards: fail so someone looks.
  if (results.length && !results.some((r) => r.status === "200")) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
