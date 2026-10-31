// The scale check's timings (docs/scale-check.md), against a production build serving the database the seed filled:
//   1. signs in as a few seeded members (the test sign-in's signed cookie, as src/lib/auth/test-user.ts makes it) and
//      times each main signed-in page, a first visit and then RUNS more, p50 and p95 per page;
//   2. calls each cron in vercel.json with CRON_SECRET, as Vercel Cron does, and times it against its maxDuration;
//   3. runs EXPLAIN (ANALYZE, BUFFERS) on the key queries for one of those members, and lists the slowest statements
//      Postgres saw while the pages and crons ran (pg_stat_statements, when the server preloads it).
// Prints a markdown report, appends it to $GITHUB_STEP_SUMMARY and writes scripts/scale/results/. Exits non-zero when a
// page's p95 is over PAGE_BUDGET_MS, a page answers anything but 200, or a cron fails or takes more than CRON_SHARE of
// its maxDuration.
//
//   BASE=http://localhost:3211 CRON_SECRET=... DATABASE_URL=postgres://... node scripts/scale/time.mjs
//
// Local databases only. Only timings, counts, status codes, query plans and normalised statement text are printed:
// never a page's body, a name, an email, a job, a note, a link or an event.
import { mkdirSync, readdirSync, readFileSync, appendFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";
import { assertLocalDatabase, MEMBER_LIKE, TEST_USER_COOKIE, testUserCookie, TIMED_MEMBERS, typedEmail, memberEmail } from "./common.mjs";

const BASE = process.env.BASE ?? "http://localhost:3211";
const RUNS = Number(process.env.RUNS ?? 5);
/** Server time a page may take at p95: the full HTML, streamed sections included. */
const PAGE_BUDGET_MS = Number(process.env.PAGE_BUDGET_MS ?? 2_500);
/** A cron may use at most this share of its maxDuration. */
const CRON_SHARE = Number(process.env.CRON_SHARE ?? 0.8);
/**
 * A route without `export const maxDuration` runs for Vercel's default. On Hobby that is 10 s without Fluid compute and
 * 300 s with it; the check assumes the stricter one.
 */
const HOBBY_DEFAULT_S = 10;
/** Hobby's function memory (vercel.json sets none, so the default applies). Reported beside the server's peak, not checked. */
const HOBBY_MEMORY_MB = 2_048;
const root = new URL("../../", import.meta.url).pathname;
const OUT = join(root, "scripts/scale/results");
const secret = process.env.CRON_SECRET;
if (!secret) throw new Error("CRON_SECRET is not set");
const url = process.env.DATABASE_URL;
assertLocalDatabase(url);
const sql = postgres(url, { max: 2, onnotice: () => {} });

const lines = [];
const out = (s = "") => lines.push(s);
const failures = [];
const fail = (what) => {
  failures.push(what);
  console.log(`FAIL ${what}`);
  if (process.env.GITHUB_ACTIONS) console.log(`::error title=scale check::${what}`);
};
const pct = (list, p) => {
  if (!list.length) return NaN;
  const s = [...list].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)];
};
const ms = (n) => (Number.isFinite(n) ? `${Math.round(n)}` : "–");
/** A literal for EXPLAIN text. Only ids, skill ids and dates the seed or the database made go through here. */
const lit = (v) => `'${String(v).replace(/'/g, "''")}'`;

/* Peak memory of the app server: the largest VmHWM of the Next.js processes, from /proc (Linux only). */
function serverPeakMb() {
  let peak = 0;
  try {
    for (const pid of readdirSync("/proc").filter((d) => /^\d+$/.test(d))) {
      try {
        const cmd = readFileSync(`/proc/${pid}/cmdline`, "utf8").replace(/\0/g, " ");
        if (!/next-server|next start|next\/dist\/bin\/next/.test(cmd)) continue;
        const hwm = readFileSync(`/proc/${pid}/status`, "utf8").match(/VmHWM:\s+(\d+) kB/);
        if (hwm) peak = Math.max(peak, Number(hwm[1]) / 1024);
      } catch {
        // The process ended, or isn't ours to read.
      }
    }
  } catch {
    return null;
  }
  return peak || null;
}

/* pg_stat_statements: on when the server preloads it (the workflow does); otherwise that part of the report is skipped. */
let statsOn = false;
async function statsReset() {
  try {
    await sql`create extension if not exists pg_stat_statements`;
    await sql`select pg_stat_statements_reset()`;
    statsOn = true;
  } catch {
    statsOn = false;
  }
}
async function statsTop(limit = 12) {
  if (!statsOn) return [];
  return sql`
    select calls::int, round(total_exec_time)::int as total_ms, round(mean_exec_time::numeric, 1)::float as mean_ms,
      round(max_exec_time::numeric, 1)::float as max_ms, rows::bigint as rows, shared_blks_hit + shared_blks_read as blocks,
      query
    from pg_stat_statements
    where dbid = (select oid from pg_database where datname = current_database())
      and query !~* '^\\s*(begin|commit|rollback|set|show|select pg_stat_statements|create extension|explain)'
      and query !~* 'pg_stat_statements'
    order by total_exec_time desc
    limit ${limit}`;
}
/** A statement's text, normalised by Postgres ($1 for every value), on one line and cut short. */
const statement = (q, max = 220) => q.replace(/\s+/g, " ").trim().slice(0, max).replace(/\|/g, "\\|");

async function statsSection(title) {
  const top = await statsTop();
  if (!statsOn) {
    out(`_${title}: pg_stat_statements is not loaded on this server, so the slowest statements aren't listed._`);
    out();
    return;
  }
  out(`#### Slowest statements: ${title}`);
  out();
  out("| calls | total ms | mean ms | max ms | rows | blocks | statement (normalised) |");
  out("|---:|---:|---:|---:|---:|---:|---|");
  for (const r of top) out(`| ${r.calls} | ${r.total_ms} | ${r.mean_ms} | ${r.max_ms} | ${r.rows} | ${r.blocks} | \`${statement(r.query)}\` |`);
  out();
  // The plan shape of the slowest by mean, without values (EXPLAIN GENERIC_PLAN, PostgreSQL 16).
  const slow = [...top].filter((r) => /^\s*(select|with)\b/i.test(r.query)).sort((a, b) => b.mean_ms - a.mean_ms).slice(0, 3);
  for (const r of slow) {
    try {
      const plan = await sql.unsafe(`explain (generic_plan) ${r.query}`);
      out(`<details><summary>Generic plan, mean ${r.mean_ms} ms: <code>${statement(r.query, 100).replace(/</g, "&lt;")}</code></summary>`);
      out();
      out("```");
      for (const p of plan) out(p["QUERY PLAN"]);
      out("```");
      out("</details>");
      out();
    } catch {
      // Not every statement can be planned without its values (a statement that names a type from a value, say).
    }
  }
}

/* The members ----------------------------------------------------------------------------------------------------- */

const timed = [];
for (const n of TIMED_MEMBERS) {
  const [row] = await sql`
    select u.id, u.name, r.id as resume_id, ga.result->>'roleSlug' as role_slug
    from users u
    join resumes r on r.user_id = u.id
    join profiles p on p.resume_id = r.id
    join gap_analyses ga on ga.profile_id = p.id
    where u.email = ${memberEmail(n)} and (ga.result -> 'notChosen') is distinct from 'true'::jsonb
    order by ga.created_at desc
    limit 1`;
  if (!row) throw new Error(`seeded member ${n} not found: run scripts/scale/seed.mjs first`);
  timed.push({ n, id: row.id, resumeId: row.resume_id, slug: row.role_slug, cookie: `${TEST_USER_COOKIE}=${testUserCookie(typedEmail(n), row.name, secret)}` });
}
const [{ members }] = await sql`select count(*)::int as members from users where email like ${MEMBER_LIKE}`;

/** The main signed-in pages, for one member. Gaps and Path build that member's analysis and path on the first visit. */
const pagesFor = (m) => [
  ["Gaps", `/resume/${m.resumeId}/gaps/${m.slug}`],
  ["Path", `/resume/${m.resumeId}/path/${m.slug}`],
  ["Today", "/today"],
  ["Map", "/map"],
  ["Departures", "/departures"],
  ["My jobs", "/departures?tab=mine"],
  ["Timetable", "/timetable"],
  ["Me", "/me"],
  ["Network", "/network"],
];

/** One page load: the whole streamed HTML, timed to its first byte and to its end. Never keeps or prints the body. */
async function load(m, path) {
  const started = performance.now();
  const res = await fetch(BASE + path, { headers: { cookie: m.cookie }, redirect: "manual", signal: AbortSignal.timeout(60_000) });
  const first = performance.now() - started;
  const body = await res.text();
  const total = performance.now() - started;
  const problem =
    res.status !== 200
      ? `HTTP ${res.status}${res.status >= 300 && res.status < 400 ? ` to ${new URL(res.headers.get("location") ?? "/", BASE).pathname}` : ""}`
      : /Something went wrong/.test(body)
        ? "error page"
        : null;
  return { first, total, problem };
}

/* 1. Pages ---------------------------------------------------------------------------------------------------------- */

await statsReset();
const firstVisit = new Map();
const samples = new Map();
const problems = new Map();
const note = (name, problem) => problems.set(name, [...new Set([...(problems.get(name) ?? []), problem])]);
for (const m of timed) {
  for (const [name, path] of pagesFor(m)) {
    try {
      const r = await load(m, path);
      firstVisit.set(name, Math.max(firstVisit.get(name) ?? 0, r.total));
      if (r.problem) note(name, r.problem);
    } catch (e) {
      note(name, e.name === "TimeoutError" ? "timed out" : "request failed");
    }
  }
}
for (let run = 0; run < RUNS; run++) {
  for (const m of timed) {
    for (const [name, path] of pagesFor(m)) {
      try {
        const r = await load(m, path);
        if (r.problem) note(name, r.problem);
        else samples.set(name, [...(samples.get(name) ?? []), { first: r.first, total: r.total }]);
      } catch (e) {
        note(name, e.name === "TimeoutError" ? "timed out" : "request failed");
      }
    }
  }
}
const pagePeak = serverPeakMb();

out(`## Scale check: ${members.toLocaleString("en-IN")} members`);
out();
out(`Production build at ${BASE}, ${timed.length} seeded members, a first visit each and then ${RUNS} runs each (${timed.length * RUNS} samples a page). Server time is the whole streamed page, read on the same machine. Budget: p95 at most ${PAGE_BUDGET_MS} ms.`);
out();
out("| Page | first visit (max) ms | p50 first byte ms | p50 ms | p95 ms | max ms | result |");
out("|---|---:|---:|---:|---:|---:|---|");
for (const [name] of pagesFor(timed[0])) {
  const list = samples.get(name) ?? [];
  const totals = list.map((s) => s.total);
  const p95 = pct(totals, 95);
  const issues = problems.get(name) ?? [];
  let result = "ok";
  if (issues.length) {
    result = issues.join(", ");
    fail(`${name}: ${result}`);
  } else if (!(p95 <= PAGE_BUDGET_MS)) {
    result = `p95 over ${PAGE_BUDGET_MS} ms`;
    fail(`${name}: p95 ${ms(p95)} ms is over ${PAGE_BUDGET_MS} ms`);
  }
  out(`| ${name} | ${ms(firstVisit.get(name))} | ${ms(pct(list.map((s) => s.first), 50))} | ${ms(pct(totals, 50))} | ${ms(p95)} | ${ms(Math.max(...totals))} | ${result} |`);
}
out();
await statsSection("pages");

/* 2. Crons ---------------------------------------------------------------------------------------------------------- */

const vercel = JSON.parse(readFileSync(join(root, "vercel.json"), "utf8"));
/** The route's own maxDuration in seconds, or null when it sets none. */
const maxDurationOf = (path) => {
  try {
    const src = readFileSync(join(root, "src/app", path, "route.ts"), "utf8");
    const m = src.match(/export const maxDuration = (\d+)/);
    return m ? Number(m[1]) : null;
  } catch {
    return null;
  }
};
// The digest runs before the weekly email (as their schedules do), and the cleanup last, since it deletes rows.
const order = ["/api/cron/events-digest", "/api/cron/weekly-email", "/api/cron/events-feed", "/api/cron/cleanup"];
const crons = [...vercel.crons].sort((a, b) => (order.indexOf(a.path) + 1 || 99) - (order.indexOf(b.path) + 1 || 99));
const [{ weeklyOn, digestOn }] = await sql`
  select count(*) filter (where s.email_weekly_summary)::int as "weeklyOn", count(*) filter (where s.events_digest)::int as "digestOn"
  from user_settings s join users u on u.id = s.user_id where u.email like ${MEMBER_LIKE}`;
await statsReset();
out(`### Crons`);
out();
out(`Called as Vercel Cron calls them (GET with the CRON_SECRET bearer), one after another. Budget: ${Math.round(CRON_SHARE * 100)}% of the route's maxDuration (Hobby default ${HOBBY_DEFAULT_S} s when the route sets none). ${weeklyOn} seeded members have the weekly email on and ${digestOn} the events digest; the email sender is a stand-in that answers like Resend.`);
out();
out("| Cron | schedule | maxDuration s | budget s | took s | HTTP | counts | result |");
out("|---|---|---:|---:|---:|---:|---|---|");
for (const cron of crons) {
  const max = maxDurationOf(cron.path);
  const budget = (max ?? HOBBY_DEFAULT_S) * CRON_SHARE;
  const started = performance.now();
  let status = 0;
  let counts = "";
  try {
    const res = await fetch(BASE + cron.path, { headers: { authorization: `Bearer ${secret}` }, signal: AbortSignal.timeout(((max ?? HOBBY_DEFAULT_S) + 30) * 1000) });
    status = res.status;
    const body = await res.json().catch(() => ({}));
    // Counts only: numbers and yes/no, one level down. The crons answer nothing else, but only these are printed.
    const flat = Object.entries(body).flatMap(([k, v]) => (v && typeof v === "object" ? Object.entries(v).map(([k2, v2]) => [`${k}.${k2}`, v2]) : [[k, v]]));
    counts = flat.filter(([, v]) => typeof v === "number" || typeof v === "boolean").map(([k, v]) => `${k} ${v}`).join(", ");
  } catch (e) {
    counts = e.name === "TimeoutError" ? "timed out" : "request failed";
  }
  const took = (performance.now() - started) / 1000;
  let result = "ok";
  if (status !== 200) {
    result = `HTTP ${status || "none"}`;
    fail(`${cron.path}: ${result} (${counts})`);
  } else if (took > budget) {
    result = `over ${budget.toFixed(0)} s`;
    fail(`${cron.path}: took ${took.toFixed(1)} s, over ${Math.round(CRON_SHARE * 100)}% of its ${max ?? HOBBY_DEFAULT_S} s`);
  }
  if (cron.path.includes("digest") && /capped true/.test(counts) && !/sent 20\b/.test(counts)) result += " (stopped by its time limit before the budget: see considered)";
  out(`| ${cron.path} | \`${cron.schedule}\` | ${max ?? `unset (${HOBBY_DEFAULT_S})`} | ${budget.toFixed(0)} | ${took.toFixed(1)} | ${status || "–"} | ${counts.replace(/\|/g, "/")} | ${result} |`);
}
out();
await statsSection("crons");
const cronPeak = serverPeakMb();
out(`Server memory: peak resident ${ms(pagePeak)} MB after the pages and ${ms(cronPeak)} MB after the crons (the whole \`next start\` process, all requests; a Hobby function gets ${HOBBY_MEMORY_MB} MB).`);
out();

/* 3. Key queries ---------------------------------------------------------------------------------------------------- */

const me = timed[0];
const [{ skill: busySkill }] = await sql`select skill_id as skill from user_goals where status = 'active' group by 1 order by count(*) desc limit 1`;
const goalSkills = (await sql`select coalesce(swapped_to, skill_id) as s from user_goals where user_id = ${me.id} and status in ('active', 'renew')`).map((r) => r.s);
const week = (() => {
  const d = new Date(Date.now() + 5.5 * 3_600_000);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - ((d.getUTCDay() + 6) % 7) * 86_400_000).toISOString().slice(0, 10);
})();
const U = lit(me.id);
const currentGaps = (userCol) => `(select ga.result -> 'gaps' from gap_analyses ga
    join profiles gp on gp.id = ga.profile_id join resumes gr on gr.id = gp.resume_id
    where gr.user_id = ${userCol}
      and gp.version = (select max(gp2.version) from profiles gp2 where gp2.resume_id = gp.resume_id)
      and (ga.result -> 'notChosen') is distinct from 'true'::jsonb
    order by coalesce(case when ga.result->>'chosenAt' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T' then (ga.result->>'chosenAt')::timestamptz end, ga.created_at) desc, ga.created_at desc
    limit 1)`;
const shownTo = `users.deletion_requested_at is null and users.suspended_at is null
    and not exists (select 1 from blocks b where (b.blocker_id = users.id and b.blocked_id = ${U}) or (b.blocker_id = ${U} and b.blocked_id = users.id))`;
const connectedTo = `exists (select 1 from connections c where (c.user_low = ${U} and c.user_high = users.id) or (c.user_high = ${U} and c.user_low = users.id))`;
const QUERIES = [
  ["Current analysis (Today, Map, Gaps: every signed-in page)", `select ga.id from gap_analyses ga join profiles p on p.id = ga.profile_id join resumes r on r.id = p.resume_id
    where r.user_id = ${U} and p.version = (select max(p2.version) from profiles p2 where p2.resume_id = p.resume_id)
      and (ga.result -> 'notChosen') is distinct from 'true'::jsonb
    order by coalesce(case when ga.result->>'chosenAt' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T' then (ga.result->>'chosenAt')::timestamptz end, ga.created_at) desc, ga.created_at desc limit 1`],
  [`On your line: count on the busiest goal skill (Today)`, `select count(*) from user_goals
    join users on users.id = user_goals.user_id join user_settings on user_settings.user_id = users.id
    where user_goals.skill_id = ${lit(busySkill)} and user_goals.status = 'active'
      and (user_goals.source = 'user' or coalesce(${currentGaps("user_goals.user_id")} @> jsonb_build_array(jsonb_build_object('skillId', user_goals.skill_id::text)), true))
      and users.id <> ${U} and ${shownTo} and users.name is not null and btrim(users.name) <> ''
      and user_settings.people_can_find = true and user_settings.profile_visibility <> 'only_me'
      and ((user_settings.gaps_visible_to = 'profile' and user_settings.profile_visibility = 'signed_in') or (user_settings.gaps_visible_to in ('profile', 'connections') and ${connectedTo}))`],
  ["Departures: newest 300 open posts", `select id from job_posts where closed_at is null order by coalesce(posted_at, first_seen_at) desc, id limit 300`],
  ["Departures: newest 300 in the member's places", `select id from job_posts where closed_at is null
      and city = any(coalesce((select open_to_work_in from user_settings where user_id = ${U}), '{}'::text[]))
    order by coalesce(posted_at, first_seen_at) desc, id limit 300`],
  ["My jobs list", `select s.id, p.title, c.title, c.description is not null from job_saves s
    left join job_posts p on p.id = s.job_post_id left join job_checks c on c.id = s.job_check_id
    where s.user_id = ${U} order by s.updated_at desc, s.id limit 300`],
  ["Timetable: live events on the member's goals", `select e.id from events e where e.status = 'live' and e.starts_at >= now() - interval '2 hours' and e.starts_at < now() + interval '61 days'
      and exists (select 1 from event_topics t where t.event_id = e.id and t.kind = 'skill' and t.topic = any(${lit(`{${goalSkills.join(",")}}`)}::text[]))
    order by e.starts_at, e.id limit 1000`],
  ["Network: connections tab", `select users.id from connections
    join users on users.id = case when connections.user_low = ${U} then connections.user_high else connections.user_low end
    left join user_settings on user_settings.user_id = users.id
    where (connections.user_low = ${U} or connections.user_high = ${U}) and ${shownTo}
    order by connections.created_at desc, users.id limit 500`],
  ["Network: requests waiting (the nav count on every page)", `select count(*) from connection_requests join users on users.id = connection_requests.from_user
    where connection_requests.to_user = ${U} and connection_requests.status = 'pending' and connection_requests.created_at >= now() - interval '30 days' and ${shownTo}`],
  ["Network: name search for a common first name", `select users.id from users left join user_settings on user_settings.user_id = users.id
    where (user_settings.people_can_find = true or ${connectedTo}) and users.name is not null and btrim(users.name) <> '' and users.id <> ${U} and ${shownTo}
      and position(' priya' in ' ' || btrim(regexp_replace(lower(regexp_replace(normalize(users.name, NFKD), '[̀-ͯ]', '', 'g')), '[^a-z0-9]+', ' ', 'g'))) > 0
    order by ${connectedTo} desc, lower(users.name), users.id limit 40`],
  ["Weekly email: who to send to", `select users.id from user_settings join users on users.id = user_settings.user_id
    where user_settings.email_weekly_summary = true and users.deletion_requested_at is null and users.suspended_at is null
      and not exists (select 1 from weekly_emails w where w.user_id = users.id and w.week = ${lit(week)})
    order by (select max(w2.week) from weekly_emails w2 where w2.user_id = users.id) asc nulls first, users.id`],
  ["Events digest: who to send to", `select users.id from user_settings join users on users.id = user_settings.user_id
    where user_settings.events_digest = true and users.deletion_requested_at is null and users.suspended_at is null
      and not exists (select 1 from events_digests d where d.user_id = users.id and d.week = ${lit(week)})
    order by (select max(d2.week) from events_digests d2 where d2.user_id = users.id) asc nulls first, users.id`],
  ["Cleanup: unsaved job text over 24 hours (as a count)", `select count(*) from job_checks where description is not null and created_at < now() - interval '24 hours'
      and not exists (select 1 from job_saves where job_saves.job_check_id = job_checks.id)`],
  ["Cleanup: old notifications (as a count)", `select count(*) from notifications where read_at < now() - interval '60 days' or created_at < now() - interval '90 days'`],
];
out(`### Key queries (EXPLAIN ANALYZE, BUFFERS) for member ${me.n}`);
out();
out("| Query | execution ms | planning ms | seq scans on |");
out("|---|---:|---:|---|");
const plans = [];
for (const [name, text] of QUERIES) {
  try {
    const plan = (await sql.unsafe(`explain (analyze, buffers) ${text}`)).map((r) => r["QUERY PLAN"]);
    const exec = Number(plan.find((l) => /^Execution Time/.test(l))?.match(/([\d.]+) ms/)?.[1]);
    const planning = Number(plan.find((l) => /^Planning Time/.test(l))?.match(/([\d.]+) ms/)?.[1]);
    const seq = [...new Set(plan.flatMap((l) => [...l.matchAll(/Seq Scan on (\w+)/g)].map((m) => m[1])))].join(", ") || "none";
    out(`| ${name} | ${exec.toFixed(1)} | ${planning.toFixed(1)} | ${seq} |`);
    plans.push([name, plan]);
  } catch (e) {
    out(`| ${name} | failed: ${String(e.message).slice(0, 80).replace(/\|/g, "/")} | | |`);
  }
}
out();
for (const [name, plan] of plans) {
  out(`<details><summary>${name}</summary>`);
  out();
  out("```");
  for (const l of plan) out(l);
  out("```");
  out("</details>");
  out();
}
const [{ size }] = await sql`select pg_size_pretty(pg_database_size(current_database())) as size`;
const tables = await sql`
  select relname as name, n_live_tup::bigint as rows from pg_stat_user_tables
  where relname in ('users', 'user_goals', 'ride_days', 'job_saves', 'job_checks', 'job_posts', 'connections', 'events', 'event_rsvps', 'gap_analyses', 'notifications', 'messages')
  order by n_live_tup desc`;
out(`Database: ${size}. Rows: ${tables.map((t) => `${t.name} ${Number(t.rows).toLocaleString("en-IN")}`).join(", ")}.`);
out();
out(failures.length ? `**${failures.length} over budget or failing:** ${failures.join("; ")}` : "**Every page and cron is inside its budget.**");

const report = lines.join("\n");
console.log(report);
mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, "report.md"), report + "\n");
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, report + "\n");
await sql.end();
if (failures.length) process.exitCode = 1;
