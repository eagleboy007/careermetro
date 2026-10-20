// Checks the installed version of every runtime dependency against GitHub's advisory database, which lists new
// advisories (Next 16.4.0's, 2026-10) before npm audit's database catches up. Fails on a high or critical one.
// CI runs it with GITHUB_TOKEN; without a token GitHub allows 60 requests an hour, enough for a run by hand.
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const lock = JSON.parse(readFileSync(new URL("../package-lock.json", import.meta.url), "utf8"));
const token = process.env.GITHUB_TOKEN;
const BLOCKING = new Set(["high", "critical"]);

let blocking = 0;
let failed = 0;
for (const name of Object.keys(pkg.dependencies ?? {}).sort()) {
  const version = lock.packages?.[`node_modules/${name}`]?.version;
  if (!version) {
    console.log(`FAIL ${name}: not in package-lock.json`);
    failed++;
    continue;
  }
  const url = `https://api.github.com/advisories?ecosystem=npm&affects=${encodeURIComponent(`${name}@${version}`)}&per_page=100`;
  const res = await fetch(url, {
    headers: { accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28", ...(token ? { authorization: `Bearer ${token}` } : {}) },
  });
  if (!res.ok) {
    console.log(`FAIL ${name}@${version}: GitHub answered ${res.status}`);
    failed++;
    continue;
  }
  const advisories = (await res.json()).filter((a) => !a.withdrawn_at);
  for (const a of advisories) {
    const hit = BLOCKING.has(a.severity);
    if (hit) blocking++;
    const fixed = (a.vulnerabilities ?? []).filter((v) => v.package?.name === name).map((v) => v.first_patched_version).filter(Boolean);
    console.log(`${hit ? "FAIL" : "note"} ${name}@${version}: ${a.severity} ${a.ghsa_id} ${a.summary}${fixed.length ? ` (fixed in ${[...new Set(fixed)].join(", ")})` : ""}`);
  }
  if (!advisories.length) console.log(`ok   ${name}@${version}`);
}

if (failed) console.log(`${failed} package(s) could not be checked`);
console.log(blocking ? `${blocking} high or critical advisory(ies) affect the installed versions` : "No high or critical advisories affect the installed versions");
process.exit(blocking || failed ? 1 : 0);
