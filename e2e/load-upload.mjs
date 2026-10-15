// Load test of the upload path (launch-readiness (c) 7). Runs against a production build with the stand-in Claude API
// (e2e/mock-ai.mjs) answering after MOCK_AI_DELAY_MS, like a real parse, so it costs nothing. Two phases:
//   burst: BURST uploads sent at the same moment, as when a post about CareerMetro goes out;
//   steady: RATE uploads a second for SECONDS seconds, the launch-day peak we plan for.
// Every upload comes from its own browser session and IP, so the per-person and per-IP limits don't answer instead.
// While it runs it counts the app's database connections (the pool is 5, src/db/index.ts) and opens a saved resume's
// page once a second, to show other database reads still get through.
// It fails on any 5xx other than "crowded", on any network error, on more than 5 app connections, on any "crowded"
// answer in the steady phase, and when more than a quarter of the burst is told it's crowded.
import { mkdirSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import postgres from "postgres";

const BASE = process.env.BASE ?? "http://localhost:3211";
const BURST = Number(process.env.BURST ?? 40);
const RATE = Number(process.env.RATE ?? 2);
const SECONDS = Number(process.env.SECONDS ?? 60);
const POOL = 5;
const pdf = readFileSync(new URL("../fixtures/resumes/priya-sharma.pdf", import.meta.url));
const sql = postgres(process.env.DATABASE_URL, { max: 1, connection: { application_name: "load-sampler" }, onnotice: () => {} });

let ipCounter = 0;
let cookie = null;
let resumeId = null;

async function upload(phase) {
  const n = ++ipCounter;
  const form = new FormData();
  form.set("consent", "yes");
  form.set("file", new Blob([pdf], { type: "application/pdf" }), "resume.pdf");
  const started = Date.now();
  try {
    const res = await fetch(BASE + "/api/resume", {
      method: "POST",
      body: form,
      headers: { origin: BASE, "x-forwarded-for": `10.${(n >> 16) & 255}.${(n >> 8) & 255}.${n & 255}` },
    });
    const body = await res.json().catch(() => ({}));
    if (res.ok && !cookie) {
      cookie = res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
      resumeId = body.resumeId;
    }
    const kind = res.ok ? "ok" : res.status === 503 && /Lots of people/.test(body.error ?? "") ? "crowded" : `http ${res.status}`;
    return { phase, kind, ms: Date.now() - started };
  } catch (error) {
    return { phase, kind: `network ${error.cause?.code ?? error.name}`, ms: Date.now() - started };
  }
}

// The app's connections: postgres.js names itself in application_name.
let maxConnections = 0;
let sampling = true;
const sampler = (async () => {
  while (sampling) {
    const [row] = await sql`select count(*)::int as n from pg_stat_activity where application_name = 'postgres.js'`;
    maxConnections = Math.max(maxConnections, row.n);
    await new Promise((r) => setTimeout(r, 250));
  }
})();

// Another database read while uploads run: the first saved resume's page, with its owner's cookie.
const pageTimes = [];
const pageErrors = [];
const prober = (async () => {
  while (sampling) {
    if (cookie && resumeId) {
      const started = Date.now();
      const res = await fetch(`${BASE}/resume/${resumeId}`, { headers: { cookie } }).catch((e) => ({ status: e.cause?.code ?? "error" }));
      if (res.status === 200) pageTimes.push(Date.now() - started);
      else pageErrors.push(res.status);
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
})();

const results = [];
console.log(`burst: ${BURST} uploads at once`);
results.push(...(await Promise.all(Array.from({ length: BURST }, () => upload("burst")))));

console.log(`steady: ${RATE} a second for ${SECONDS} seconds`);
const steady = [];
for (let i = 0; i < RATE * SECONDS; i++) {
  steady.push(upload("steady"));
  await new Promise((r) => setTimeout(r, 1000 / RATE));
}
results.push(...(await Promise.all(steady)));
sampling = false;
await Promise.all([sampler, prober]);
const [{ parsed }] = await sql`select count(*)::int as parsed from resumes where status = 'parsed'`;
await sql.end();

const pct = (xs, p) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor((xs.length * p) / 100))] : null);
const summary = {};
for (const phase of ["burst", "steady"]) {
  const rs = results.filter((r) => r.phase === phase);
  const kinds = {};
  for (const r of rs) kinds[r.kind] = (kinds[r.kind] ?? 0) + 1;
  const ok = rs.filter((r) => r.kind === "ok").map((r) => r.ms);
  summary[phase] = { sent: rs.length, kinds, okP50Ms: pct(ok, 50), okP95Ms: pct(ok, 95), okMaxMs: pct(ok, 100) };
}
summary.maxAppConnections = maxConnections;
summary.resumesParsed = parsed;
summary.otherPage = { opened: pageTimes.length, p95Ms: pct(pageTimes, 95), maxMs: pct(pageTimes, 100), failed: pageErrors };

const problems = [];
for (const r of results) if (r.kind !== "ok" && r.kind !== "crowded") problems.push(`${r.phase}: ${r.kind}`);
if (maxConnections > POOL) problems.push(`the app opened ${maxConnections} database connections, more than its pool of ${POOL}`);
if (summary.steady.kinds.crowded) problems.push(`${summary.steady.kinds.crowded} steady-phase uploads were told it's crowded`);
if ((summary.burst.kinds.crowded ?? 0) > BURST / 4) problems.push(`${summary.burst.kinds.crowded} of ${BURST} burst uploads were told it's crowded`);
if (pageErrors.length) problems.push(`the resume page failed ${pageErrors.length} times: ${[...new Set(pageErrors)].join(", ")}`);
if (!pageTimes.length) problems.push("the resume page was never opened (no upload succeeded)");

const report = JSON.stringify({ base: BASE, burst: BURST, rate: RATE, seconds: SECONDS, aiDelayMs: Number(process.env.MOCK_AI_DELAY_MS ?? 0), ...summary, problems }, null, 2);
console.log(report);
mkdirSync(new URL("results/", import.meta.url), { recursive: true });
writeFileSync(new URL("results/load.json", import.meta.url), report + "\n");
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, "## Upload load test\n\n```json\n" + report + "\n```\n");
if (problems.length) {
  console.error("Load test failed:\n- " + problems.join("\n- "));
  process.exit(1);
}
