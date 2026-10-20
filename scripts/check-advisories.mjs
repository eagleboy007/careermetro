// Checks every installed runtime package against GitHub's advisory database, which lists new advisories (Next 16.4.0's,
// 2026-10) before npm audit's database catches up. Fails on a high or critical one.
//
// The packages are every entry of package-lock.json `packages` under node_modules/ that isn't marked `dev`, so nested
// copies and the dependencies of our dependencies count too; the name comes from the path. They go to
// GET /advisories in batches of BATCH as `affects=name@version,…`, once with type=reviewed and once with
// type=unreviewed (new advisories arrive unreviewed first), following the Link header's rel="next" pages. Each
// advisory is matched back to the installed copies it names in `vulnerabilities[].package.name` and whose version is
// in its `vulnerable_version_range`. A 5xx, 403 or 429 is retried twice (after 2 s, then 5 s) before the run fails.
// CI runs it with GITHUB_TOKEN; without a token GitHub allows 60 requests an hour, enough for a run by hand.
import { readFileSync } from "node:fs";

const lock = JSON.parse(readFileSync(new URL("../package-lock.json", import.meta.url), "utf8"));
const token = process.env.GITHUB_TOKEN;
const BLOCKING = new Set(["high", "critical"]);
/** Packages per request: well under the API's 1000 and a URL length any proxy accepts. */
const BATCH = 100;
const RETRY_AFTER_MS = [2000, 5000];

/** name -> installed versions. Scoped names keep their scope: node_modules/a/node_modules/@b/c is "@b/c". */
const installed = new Map();
for (const [path, entry] of Object.entries(lock.packages ?? {})) {
  const at = path.lastIndexOf("node_modules/");
  if (at === -1 || entry.dev === true || !entry.version) continue;
  const name = path.slice(at + "node_modules/".length);
  if (!installed.has(name)) installed.set(name, new Set());
  installed.get(name).add(entry.version);
}
const specs = [...installed].flatMap(([name, versions]) => [...versions].map((v) => `${name}@${v}`)).sort();
if (!specs.length) {
  console.log("FAIL no runtime packages found in package-lock.json");
  process.exit(1);
}

const headers = { accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28", ...(token ? { authorization: `Bearer ${token}` } : {}) };
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** One GET, retried on a 5xx, 403, 429 or a dropped connection. Throws once the retries are spent. */
async function get(url) {
  for (let attempt = 0; ; attempt++) {
    let problem;
    try {
      const res = await fetch(url, { headers });
      if (res.ok) return res;
      if (!(res.status >= 500 || res.status === 403 || res.status === 429)) throw new Error(`GitHub answered ${res.status}`);
      problem = `GitHub answered ${res.status}`;
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("GitHub answered")) throw error;
      problem = `request failed (${error instanceof Error ? error.message : error})`;
    }
    if (attempt >= RETRY_AFTER_MS.length) throw new Error(problem);
    console.log(`retry ${problem}; trying again in ${RETRY_AFTER_MS[attempt] / 1000} s`);
    await wait(RETRY_AFTER_MS[attempt]);
  }
}

const nextPage = (link) => link?.split(",").find((part) => /rel="next"/.test(part))?.match(/<([^>]+)>/)?.[1] ?? null;

/** Every advisory for one batch and one type, across pages. */
async function advisoriesFor(batch, type) {
  const url = new URL("https://api.github.com/advisories");
  url.search = new URLSearchParams({ ecosystem: "npm", type, affects: batch.join(","), per_page: "100" }).toString();
  const out = [];
  for (let next = url.toString(); next; ) {
    const res = await get(next);
    out.push(...(await res.json()));
    next = nextPage(res.headers.get("link"));
  }
  return out;
}

// Version ranges as GitHub writes them: comparators joined by ", " (all must hold), e.g. ">= 16.0.0, < 16.4.1".
const parts = (v) => {
  const [core, pre] = v.replace(/^v/, "").split("-", 2);
  return { nums: core.split(".").map((n) => Number(n) || 0), pre: pre ?? null };
};
function compare(a, b) {
  const x = parts(a);
  const y = parts(b);
  for (let i = 0; i < 3; i++) if ((x.nums[i] ?? 0) !== (y.nums[i] ?? 0)) return (x.nums[i] ?? 0) - (y.nums[i] ?? 0);
  if (x.pre === y.pre) return 0;
  if (x.pre === null) return 1;
  if (y.pre === null) return -1;
  return x.pre < y.pre ? -1 : 1;
}
/** True when `version` is in `range`, and also when the range can't be read, so a hit is never missed. */
function inRange(version, range) {
  if (!range) return true;
  return range.split("||").some((alt) =>
    alt.split(",").every((cmp) => {
      const m = cmp.trim().match(/^(>=|<=|>|<|=)?\s*(\S+)$/);
      if (!m) return true;
      const d = compare(version, m[2]);
      return { ">=": d >= 0, "<=": d <= 0, ">": d > 0, "<": d < 0, "=": d === 0 }[m[1] ?? "="];
    }),
  );
}

const seen = new Set();
const hits = [];
let failed = 0;
for (let i = 0; i < specs.length; i += BATCH) {
  const batch = specs.slice(i, i + BATCH);
  for (const type of ["reviewed", "unreviewed"]) {
    let advisories;
    try {
      advisories = await advisoriesFor(batch, type);
    } catch (error) {
      console.log(`FAIL ${type} advisories for packages ${i + 1} to ${i + batch.length}: ${error.message}`);
      failed++;
      continue;
    }
    for (const a of advisories) {
      if (a.withdrawn_at) continue;
      for (const v of a.vulnerabilities ?? []) {
        const name = v.package?.name;
        for (const version of installed.get(name) ?? []) {
          if (!batch.includes(`${name}@${version}`) || !inRange(version, v.vulnerable_version_range)) continue;
          const key = `${a.ghsa_id} ${name}@${version}`;
          if (seen.has(key)) continue;
          seen.add(key);
          hits.push({ a, name, version, fixed: v.first_patched_version?.identifier ?? v.first_patched_version ?? null });
        }
      }
    }
  }
}

let blocking = 0;
for (const { a, name, version, fixed } of hits.sort((x, y) => x.name.localeCompare(y.name))) {
  const hit = BLOCKING.has(a.severity);
  if (hit) blocking++;
  console.log(`${hit ? "FAIL" : "note"} ${name}@${version}: ${a.severity} ${a.type === "unreviewed" ? "(unreviewed) " : ""}${a.ghsa_id} ${a.summary}${fixed ? ` (fixed in ${fixed})` : ""}`);
}

console.log(`Checked ${specs.length} installed runtime package version(s)`);
if (failed) console.log(`${failed} request(s) failed, so some packages could not be checked`);
console.log(blocking ? `${blocking} high or critical advisory(ies) affect the installed versions` : "No high or critical advisories affect the installed versions");
process.exit(blocking || failed ? 1 : 0);
