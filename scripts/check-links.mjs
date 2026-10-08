// Checks every link in the resource catalog (FR-17). Prints a GitHub annotation per problem and exits 1 when a link is dead.
// With DATABASE_URL set it also records each result in resource_checks and updates resources.healthy, so new paths
// skip dead links. A site that blocks robots (401, 403, 429) is reported as a warning and leaves healthy unchanged.
// Usage: node scripts/check-links.mjs            (report only)
//        DATABASE_URL=... node scripts/check-links.mjs
import { readFileSync } from "node:fs";
import postgres from "postgres";

const resources = JSON.parse(readFileSync(new URL("../src/content/resources.json", import.meta.url), "utf8"));
const TIMEOUT_MS = 20_000;
const CONCURRENCY = 8;
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

/** @returns {Promise<{ state: "ok" | "blocked" | "dead", detail: string }>} */
async function check(url) {
  try {
    let status = await request(url, "HEAD");
    // Many servers refuse or mishandle HEAD; ask again with GET before calling a link dead.
    if (status >= 400) status = await request(url, "GET");
    if (status < 400) return { state: "ok", detail: `${status}` };
    return { state: BLOCKED.has(status) ? "blocked" : "dead", detail: `${status}` };
  } catch (error) {
    const cause = error?.cause?.code ?? error?.name ?? "error";
    return { state: "dead", detail: cause };
  }
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

if (process.env.DATABASE_URL) {
  const sql = postgres(process.env.DATABASE_URL, { prepare: false, max: 1 });
  try {
    await sql.begin(async (tx) => {
      const rows = await tx`select id, url from resources where url in ${tx(results.map((r) => r.url))}`;
      const idByUrl = new Map(rows.map((r) => [r.url, r.id]));
      const checked = results.filter((r) => idByUrl.has(r.url));
      if (checked.length === 0) return;
      await tx`
        insert into resource_checks ${tx(
          checked.map((r) => ({ resource_id: idByUrl.get(r.url), ok: r.state === "ok", detail: `${r.state} ${r.detail}` })),
          "resource_id", "ok", "detail",
        )}`;
      for (const state of ["ok", "dead"]) {
        const ids = checked.filter((r) => r.state === state).map((r) => idByUrl.get(r.url));
        if (ids.length) await tx`update resources set healthy = ${state === "ok"}, last_checked_at = now() where id in ${tx(ids)}`;
      }
      const blocked = checked.filter((r) => r.state === "blocked").map((r) => idByUrl.get(r.url));
      if (blocked.length) await tx`update resources set last_checked_at = now() where id in ${tx(blocked)}`;
    });
    console.log("Recorded the results in the database.");
  } finally {
    await sql.end();
  }
}

if (count("dead") > 0) process.exit(1);
