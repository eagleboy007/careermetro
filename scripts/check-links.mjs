// Checks every link in the resource catalog (FR-17). Prints a GitHub annotation per problem. In report-only mode (pull
// requests) it exits 1 when a link is dead, so a bad new link is caught before merge.
// With DATABASE_URL set it also records each result in resource_checks and updates resources.healthy, so new paths
// skip dead links. A link is marked unhealthy only after two dead checks in a row, and not at all when so many links
// look dead that the runner's network is the likelier cause. A site that blocks robots (401, 403, 429) is reported as
// a warning and leaves healthy unchanged. The recording run exits 0 on dead links: the healthy flag already keeps them
// out of paths, and with over 200 outside sites one timeout would otherwise fail the daily run and send an email. It
// still fails when it could not record the results or when so many links look dead that the run can't be trusted.
// Usage: node scripts/check-links.mjs            (report only)
//        DATABASE_URL=... node scripts/check-links.mjs
import { readFileSync } from "node:fs";
import postgres from "postgres";

const resources = JSON.parse(readFileSync(new URL("../src/content/resources.json", import.meta.url), "utf8"));
const TIMEOUT_MS = 15_000;
const CONCURRENCY = 8;
const ATTEMPTS = 3;
/** Above this share of dead links, skip the healthy updates: a runner network problem must not empty every path. */
const MAX_DEAD_SHARE = 0.2;
const BLOCKED = new Set([401, 403, 429]);
const headers = {
  "user-agent": "Mozilla/5.0 (compatible; CareerMetroLinkCheck/1.0; +https://careermetro.vercel.app)",
  accept: "text/html,application/xhtml+xml,*/*;q=0.8",
};

async function request(url, method) {
  const response = await fetch(url, { method, headers, redirect: "follow", signal: AbortSignal.timeout(TIMEOUT_MS) });
  await response.body?.cancel();
  return response.status;
}

async function once(url) {
  // Many servers refuse, mishandle or hang on HEAD; ask again with GET before calling a link dead.
  try {
    const status = await request(url, "HEAD");
    if (status < 400) return status;
  } catch {
    // fall through to GET
  }
  return request(url, "GET");
}

/** @returns {Promise<{ state: "ok" | "blocked" | "dead", detail: string }>} */
async function check(url) {
  let result;
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    try {
      const status = await once(url);
      if (status < 400) return { state: "ok", detail: `${status}` };
      result = { state: BLOCKED.has(status) ? "blocked" : "dead", detail: `${status}` };
      // A 4xx other than 408 is an answer, not a hiccup; retry only timeouts, network errors and 5xx.
      if (status < 500 && status !== 408) return result;
    } catch (error) {
      result = { state: "dead", detail: error?.cause?.code ?? error?.name ?? "error" };
    }
    if (attempt < ATTEMPTS) await new Promise((resolve) => setTimeout(resolve, 2000 * attempt));
  }
  return result;
}

const results = new Array(resources.length);
let next = 0;
await Promise.all(
  Array.from({ length: CONCURRENCY }, async () => {
    while (next < resources.length) {
      const i = next++;
      results[i] = { url: resources[i].url, ...(await check(resources[i].url)) };
    }
  }),
);

const escape = (s) => s.replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A");
for (const r of results) {
  if (r.state === "dead") console.log(`::error title=Dead link::${escape(`${r.url} (${r.detail})`)}`);
  if (r.state === "blocked") console.log(`::warning title=Blocked link check::${escape(`${r.url} (${r.detail})`)}`);
}
const count = (state) => results.filter((r) => r.state === state).length;
const summary = `${results.length} links: ${count("ok")} ok, ${count("blocked")} blocked the checker, ${count("dead")} dead.`;
console.log(`::notice title=Link check::${summary}`);

let recordFailed = false;
if (process.env.DATABASE_URL) {
  const sql = postgres(process.env.DATABASE_URL, { prepare: false, max: 1 });
  try {
    await sql.begin(async (tx) => {
      const rows = await tx`select id, url from resources where url in ${tx(results.map((r) => r.url))}`;
      const idByUrl = new Map(rows.map((r) => [r.url, r.id]));
      const checked = results.filter((r) => idByUrl.has(r.url));
      if (checked.length === 0) {
        console.log(`::error title=Link check::No catalog link is in the resources table; run the seed first.`);
        recordFailed = true;
        return;
      }
      if (checked.length < results.length) {
        console.log(`::warning title=Link check::${results.length - checked.length} catalog links are not in the resources table.`);
      }
      // The previous check of each link, read before this run's rows go in.
      const previous = await tx`
        select distinct on (resource_id) resource_id, detail from resource_checks
        where resource_id in ${tx(checked.map((r) => idByUrl.get(r.url)))}
        order by resource_id, checked_at desc`;
      const deadBefore = new Set(previous.filter((p) => p.detail?.startsWith("dead")).map((p) => p.resource_id));

      await tx`
        insert into resource_checks ${tx(
          checked.map((r) => ({ resource_id: idByUrl.get(r.url), ok: r.state === "ok", detail: `${r.state} ${r.detail}` })),
          "resource_id", "ok", "detail",
        )}`;
      await tx`update resources set last_checked_at = now() where id in ${tx(checked.map((r) => idByUrl.get(r.url)))}`;

      if (count("dead") > results.length * MAX_DEAD_SHARE) {
        console.log(`::error title=Link check::Too many dead links to trust this run; healthy flags were left unchanged.`);
        recordFailed = true;
        return;
      }
      const ok = checked.filter((r) => r.state === "ok").map((r) => idByUrl.get(r.url));
      const dead = checked.filter((r) => r.state === "dead").map((r) => idByUrl.get(r.url)).filter((id) => deadBefore.has(id));
      if (ok.length) await tx`update resources set healthy = true where id in ${tx(ok)}`;
      if (dead.length) await tx`update resources set healthy = false where id in ${tx(dead)}`;
      console.log(`Marked ${dead.length} links unhealthy after two dead checks in a row.`);
    });
    if (!recordFailed) console.log("Recorded the results in the database.");
  } finally {
    await sql.end();
  }
}

if (recordFailed || (count("dead") > 0 && !process.env.DATABASE_URL)) process.exit(1);
