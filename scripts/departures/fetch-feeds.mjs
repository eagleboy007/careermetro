// The daily Departures feed (docs/plans/departures-live-plan.md; .github/workflows/departures.yml). One public GET per
// reviewed board (src/content/job-boards.json) through the job-board APIs of Greenhouse, Lever, Ashby and
// SmartRecruiters only: never a web page, never LinkedIn, Naukri or any site whose terms forbid it. Each answer is
// checked with Zod; posts in India (or remote India) are kept with the skill ids the taxonomy finds by code, and no
// model is called. No post text is stored or logged: the log and the run summary name boards and counts only.
//
// With DATABASE_URL set it upserts job_posts by external id, closes the open posts of each board it read that this run
// didn't see (a board that failed closes nothing; a board taken off the list closes all of its posts) and records the
// run in job_feed_runs. Then, in its own transaction, it rewrites this month's market_openings_monthly rows from
// job_posts (writeRollup, docs/plans/market-trends-plan.md), and last month's too when its rollup missed its last run,
// so the Market's counts outlive the 180-day purge of closed posts; the daily cleanup never deletes rollups. Without DATABASE_URL, it reads the boards and prints the counts (a
// dry run).
// Usage: node scripts/departures/fetch-feeds.mjs
import { appendFileSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import postgres from "postgres";
import { capPosts, FEED_LIMITS, feedUrl, FUTURE_SKEW_MS, postRow, rawPost, skillMatchersFor, USER_AGENT } from "../../src/lib/departures/feed-rules.mjs";
import { FEED_SCHEMAS, jobBoardsFile, jobPostRow, TOKEN_PATTERN } from "../../src/lib/departures/feed-schemas.mjs";
import { monthBounds, monthOf, rollupMonth } from "../../src/lib/market/rollup.mjs";

const root = new URL("../../", import.meta.url);

/** @typedef {import("../../src/lib/departures/feed-rules.mjs").Ats} Ats */
/** @typedef {{ company: string; ats: Ats; token: string; host?: import("../../src/lib/departures/feed-rules.mjs").BoardHost }} Board */
/**
 * `capped`: the caps dropped some of this board's posts. The board was still read whole, so it closes posts that left
 * it; the ones the caps dropped were seen and stay open (T79). `truncated`: the answer may be only part of the board (a
 * full SmartRecruiters page), so the board closes nothing this run.
 * @typedef {{ ats: Ats; token: string; ok: boolean; posts: number; error: string | null; capped?: boolean; truncated?: boolean }} BoardResult
 */

/**
 * The board's answer as JSON, read with a time limit and a size cap. Fails with a short code only ("404", "timeout",
 * "too_large", "not_json", "network"), never with text from the answer.
 * @param {string} url
 * @param {{ fetchImpl?: typeof fetch; timeoutMs?: number; maxBytes?: number }} [deps]
 * @returns {Promise<{ ok: true; data: unknown } | { ok: false; error: string }>}
 */
export async function getJson(url, { fetchImpl = fetch, timeoutMs = FEED_LIMITS.timeoutMs, maxBytes = FEED_LIMITS.maxBytes } = {}) {
  const signal = AbortSignal.timeout(timeoutMs);
  try {
    const res = await fetchImpl(url, { headers: { "user-agent": USER_AGENT, accept: "application/json" }, redirect: "error", signal });
    if (res.url && !res.url.startsWith("https://")) {
      await res.body?.cancel();
      return { ok: false, error: "network" };
    }
    if (!res.ok) {
      await res.body?.cancel();
      return { ok: false, error: String(res.status) };
    }
    if (Number(res.headers.get("content-length") ?? 0) > maxBytes) {
      await res.body?.cancel();
      return { ok: false, error: "too_large" };
    }
    if (!res.body) return { ok: false, error: "not_json" };
    const reader = res.body.getReader();
    /** @type {Uint8Array[]} */
    const chunks = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        return { ok: false, error: "too_large" };
      }
      chunks.push(value);
    }
    try {
      return { ok: true, data: JSON.parse(Buffer.concat(chunks).toString("utf8")) };
    } catch {
      return { ok: false, error: "not_json" };
    }
  } catch (error) {
    const name = /** @type {{ name?: string }} */ (error)?.name;
    return { ok: false, error: name === "TimeoutError" || name === "AbortError" ? "timeout" : "network" };
  }
}

/**
 * One board's answer as checked job_posts rows (India and remote India only), with the number of postings it listed
 * (Ashby's unlisted ones left out) and whether it may be only part of the board. An answer that doesn't fit the
 * board's schema fails as a whole ("invalid"); one posting that doesn't fit is skipped. The board check
 * (check-boards.mjs) counts with this too, so a board it passes reads the same in the feed.
 * @param {Board} board
 * @param {unknown} data
 * @param {import("../../src/lib/departures/feed-rules.mjs").SkillMatcher[]} matchers
 * @param {Date} [now] the run's time, so every post in a run is checked against the same clock
 * @returns {{ ok: true; rows: ReturnType<typeof jobPostRow.parse>[]; total: number; truncated: boolean } | { ok: false; error: "invalid" }}
 */
export function boardRows(board, data, matchers, now = new Date()) {
  const schema = FEED_SCHEMAS[board.ats];
  const envelope = schema.board.safeParse(data);
  if (!envelope.success) return { ok: false, error: "invalid" };
  /** @type {ReturnType<typeof jobPostRow.parse>[]} */
  const rows = [];
  let total = 0;
  for (const item of schema.jobs(envelope.data)) {
    const job = schema.job.safeParse(item);
    if (job.success && board.ats === "ashby" && job.data.isListed === false) continue;
    total++;
    if (!job.success) continue;
    const row = postRow(board.ats, board, rawPost(board.ats, job.data, board.token), matchers, now);
    const checked = row ? jobPostRow.safeParse(row) : null;
    if (checked?.success) rows.push(checked.data);
  }
  return { ok: true, rows, total, truncated: schema.truncated(envelope.data) };
}

/**
 * Every board, read in turn (a few at once), as checked job_posts rows and one result per board. A board whose answer
 * doesn't fit its schema fails as a whole; one posting that doesn't fit is skipped. The caps are applied at the end.
 * @param {Board[]} boards
 * @param {import("../../src/lib/departures/feed-rules.mjs").SkillMatcher[]} matchers
 * @param {{ fetchImpl?: typeof fetch; timeoutMs?: number; maxBytes?: number; concurrency?: number; perBoard?: number; total?: number; now?: Date }} [deps]
 */
export async function collect(boards, matchers, deps = {}) {
  /** @type {BoardResult[]} */
  const results = [];
  /** @type {ReturnType<typeof jobPostRow.parse>[]} */
  const rows = [];
  /** @type {Map<string, BoardResult>} */
  const byKey = new Map();
  let next = 0;
  const now = deps.now ?? new Date();
  const one = async (/** @type {Board} */ board) => {
    const got = await getJson(feedUrl(board.ats, board.token, board.host), deps);
    if (!got.ok) return results.push({ ats: board.ats, token: board.token, ok: false, posts: 0, error: got.error });
    const read = boardRows(board, got.data, matchers, now);
    if (!read.ok) return results.push({ ats: board.ats, token: board.token, ok: false, posts: 0, error: read.error });
    rows.push(...read.rows);
    const posts = read.rows.length;
    /** @type {BoardResult} */
    const result = { ats: board.ats, token: board.token, ok: true, posts, error: null, ...(read.truncated ? { truncated: true } : {}) };
    results.push(result);
    byKey.set(key(board), result);
  };
  await Promise.all(
    Array.from({ length: Math.max(1, deps.concurrency ?? 4) }, async () => {
      while (next < boards.length) await one(boards[next++]);
    }),
  );
  // Every row checked before the caps counts as seen, so writeRun never closes a live post the caps left out, while a
  // board the caps cut still closes posts it no longer lists (T79). It is marked for the summary.
  const seen = rows.map((r) => ({ k: `${r.ats}:${r.boardToken}`, id: r.externalId }));
  const kept = capPosts(rows, deps.perBoard, deps.total);
  /** @type {Map<string, number>} */
  const keptPer = new Map();
  for (const r of kept) keptPer.set(`${r.ats}:${r.boardToken}`, (keptPer.get(`${r.ats}:${r.boardToken}`) ?? 0) + 1);
  for (const [k, result] of byKey) if ((keptPer.get(k) ?? 0) < result.posts) result.capped = true;
  return { rows: kept, results, seen };
}

/**
 * A Postgres array literal of ids already checked as slugs or `ats:token` keys (feed-schemas.mjs allows letters,
 * digits, -, _ and a single . between them only), so nothing needs quoting.
 */
const pgArray = (/** @type {string[]} */ ids) => `{${ids.join(",")}}`;
const key = (/** @type {{ ats: string; token: string }} */ b) => `${b.ats}:${b.token}`;
const SAFE_KEY = new RegExp(`^[a-z]+:${TOKEN_PATTERN}$`);

/**
 * The boards whose open posts this run may close: each board read whole (a board that failed or was cut short closes
 * nothing; one the caps cut was read whole, and writeRun keeps every post it saw open, T79),
 * and, with `unlisted`, every board that still has open posts but is no longer on the reviewed list.
 * @param {string[]} openKeys `ats:token` of the boards with open posts now
 * @param {BoardResult[]} results
 * @param {Board[]} boards
 */
export function boardsToClose(openKeys, results, boards, unlisted = true) {
  const listed = new Set(boards.map(key));
  const read = results.filter((r) => r.ok && !r.truncated).map(key);
  // Only well-formed keys go into the array literal below.
  return [...new Set([...read, ...(unlisted ? openKeys.filter((k) => !listed.has(k)) : [])])].filter((k) => SAFE_KEY.test(k)).sort();
}

/**
 * Writes one run in a single transaction: the run row, the posts (new ones inserted, seen ones updated and reopened),
 * then closes what this run didn't see on a board it read, and every open post of a board no longer on the list.
 * @param {import("postgres").Sql} sql
 * `closeUnlisted` false leaves boards off the list alone (for tests sharing a database).
 * @param {{ boards: Board[]; rows: ReturnType<typeof jobPostRow.parse>[]; results: BoardResult[]; seen?: { k: string; id: string }[]; startedAt: Date; now?: Date; closeUnlisted?: boolean }} run
 * `seen`: every post read this run before the caps (from collect); none of them is closed.
 */
export async function writeRun(sql, { boards, rows, results, seen = [], startedAt, now = new Date(), closeUnlisted = true }) {
  return sql.begin(async (tx) => {
    const [run] = await tx`insert into job_feed_runs (started_at) values (${startedAt}) returning id`;
    for (let i = 0; i < rows.length; i += 1000) {
      const chunk = rows.slice(i, i + 1000).map((r) => ({
        ats: r.ats,
        board_token: r.boardToken,
        external_id: r.externalId,
        url: r.url,
        title: r.title,
        company: r.company,
        city: r.city,
        work_type: r.workType,
        experience_note: r.experienceNote,
        role_slug: r.roleSlug,
        required_skill_ids: r.requiredSkillIds,
        nice_skill_ids: r.niceSkillIds,
        posted_at: r.postedAt?.toISOString() ?? null,
      }));
      await tx`
        insert into job_posts (ats, board_token, external_id, url, title, company, city, work_type, experience_note, role_slug,
          required_skill_ids, nice_skill_ids, posted_at, first_seen_at, last_seen_at)
        select x.ats, x.board_token, x.external_id, x.url, x.title, x.company, x.city, x.work_type::job_work_type, x.experience_note,
          x.role_slug, x.required_skill_ids, x.nice_skill_ids, x.posted_at, ${now}, ${now}
        from jsonb_to_recordset(${JSON.stringify(chunk)}::text::jsonb) as x(ats text, board_token text, external_id text, url text,
          title text, company text, city text, work_type text, experience_note text, role_slug text, required_skill_ids text[],
          nice_skill_ids text[], posted_at timestamptz)
        on conflict (ats, board_token, external_id) do update set
          url = excluded.url, title = excluded.title, company = excluded.company, city = excluded.city,
          work_type = excluded.work_type, experience_note = excluded.experience_note, role_slug = excluded.role_slug,
          required_skill_ids = excluded.required_skill_ids, nice_skill_ids = excluded.nice_skill_ids,
          posted_at = case when job_posts.posted_at > ${new Date(now.getTime() + FUTURE_SKEW_MS)} then excluded.posted_at
            else coalesce(excluded.posted_at, job_posts.posted_at) end, last_seen_at = excluded.last_seen_at, closed_at = null`;
    }
    const open = await tx`select distinct ats || ':' || board_token as key from job_posts where closed_at is null`;
    const closing = boardsToClose(
      open.map((r) => r.key),
      results,
      boards,
      closeUnlisted,
    );
    const closed = await tx`
      update job_posts set closed_at = ${now}
      where closed_at is null and last_seen_at < ${startedAt} and (ats || ':' || board_token) = any(${pgArray(closing)}::text[])
        and not exists (
          select 1 from jsonb_to_recordset(${JSON.stringify(seen)}::text::jsonb) as s(k text, id text)
          where s.k = job_posts.ats || ':' || job_posts.board_token and s.id = job_posts.external_id)
      returning id`;
    const [{ count }] = await tx`select count(*)::int as count from job_posts where closed_at is null`;
    const ok = results.filter((r) => r.ok).length;
    await tx`
      update job_feed_runs set finished_at = ${now}, boards_ok = ${ok}, boards_failed = ${results.length - ok},
        posts_open = ${count}, posts_closed = ${closed.length}
      where id = ${run.id}`;
    return { runId: String(run.id), open: Number(count), closed: closed.length };
  });
}

/**
 * One month's market_openings_monthly rows, rewritten from job_posts as of `now` inside `tx`: every cell the posts give
 * is upserted (month, role, state, city, band; nulls not distinct) and every other row of that month is deleted (a
 * post's role or note changed). Only posts first seen in the month or open at `now` are read, and of those only the
 * role, city, experience note and dates: never a title, company, URL or skill. `boards_ok` is the month's lowest
 * board count over its finished runs up to `now` that read at least one board (a run where every board failed is the
 * runner's network, not the boards); 0 when there is none.
 * @param {import("postgres").TransactionSql} tx
 * @param {string} month YYYY-MM-01
 * @param {Date} now
 */
async function rewriteMonth(tx, month, now) {
  const { start, end } = monthBounds(month);
  const found = await tx`
    select city, experience_note, role_slug, first_seen_at, closed_at from job_posts
    where first_seen_at <= ${now} and (closed_at is null or closed_at > ${now} or (first_seen_at >= ${start} and first_seen_at < ${end}))`;
  const [{ low }] = await tx`
    select min(boards_ok)::int as low from job_feed_runs
    where boards_ok > 0 and finished_at >= ${start} and finished_at < ${end} and finished_at <= ${now}`;
  const boardsOk = low ?? 0;
  const { rows, stats } = rollupMonth({
    posts: found.map((p) => ({
      city: p.city,
      experienceNote: p.experience_note,
      roleSlug: p.role_slug,
      firstSeenAt: new Date(p.first_seen_at),
      closedAt: p.closed_at ? new Date(p.closed_at) : null,
    })),
    month,
    boardsOk,
    computedAt: now,
  });
  const cells = JSON.stringify(
    rows.map((r) => ({ role_slug: r.roleSlug, state: r.state, city: r.city, band: r.band, new_posts: r.newPosts, open_at_end: r.openAtEnd })),
  );
  // NOT IN over the cell with nulls as '' (no stored city or band is ''), so Postgres can hash the month's cells.
  await tx`
    delete from market_openings_monthly m
    where m.month = ${month}::date
      and (m.role_slug, m.state, coalesce(m.city, ''), coalesce(m.band, '')) not in (
        select x.role_slug, x.state, coalesce(x.city, ''), coalesce(x.band, '')
        from jsonb_to_recordset(${cells}::text::jsonb) as x(role_slug text, state text, city text, band text))`;
  await tx`
    insert into market_openings_monthly (month, role_slug, state, city, band, new_posts, open_at_end, boards_ok, computed_at)
    select ${month}::date, x.role_slug, x.state, x.city, x.band, x.new_posts, x.open_at_end, ${boardsOk}::int, ${now}::timestamptz
    from jsonb_to_recordset(${cells}::text::jsonb) as x(role_slug text, state text, city text, band text, new_posts int, open_at_end int)
    on conflict (month, role_slug, state, city, band) do update set
      new_posts = excluded.new_posts, open_at_end = excluded.open_at_end, boards_ok = excluded.boards_ok, computed_at = excluded.computed_at`;
  return stats;
}

/**
 * The Market's monthly rollup, after writeRun, in one transaction of its own. It rewrites the current month (an India
 * calendar month, Asia/Kolkata: monthOf and monthBounds in src/lib/market/rollup.mjs) as of `now`, so a re-run of a
 * day gives the same rows, and no month but the current one and the one before is ever written.
 *
 * The month before is rewritten too when it is behind: when it has rows and its last finished run is later than
 * their computed_at (that run wrote its posts but its rollup failed). It is then rewritten as of that run's
 * finished_at, the month's real last run, so the month is final. A month with no rows is never filled in afterwards
 * (no backfill before the table existed), and a month whose last day had no run at all stays as its last rollup left
 * it: there are no posts to add.
 *
 * Known limit of the catch-up (T120): it reads job_posts as they are today, and job_posts keeps only a post's latest
 * close. A post that was closed at last month's last run and has reopened since (writeRun sets closed_at back to null,
 * and a later close overwrites it) reads as open at that run, so its open_at_end can count it. new_posts is exact
 * (first_seen_at never changes). Reopens are rare and the catch-up runs only after a failed rollup, so this is left as
 * is; fixing it would need the close history kept per post.
 * @param {import("postgres").Sql} sql
 * @param {{ now?: Date }} [opts] `now`: the run's time (writeRun's `now`), no earlier than any post's first_seen_at
 * @returns {Promise<{ month: string; rows: number; counted: number; unmatched: number; indiaOnly: number; previous: string | null }>}
 */
export async function writeRollup(sql, { now = new Date() } = {}) {
  const month = monthOf(now);
  const { start } = monthBounds(month);
  const before = monthOf(new Date(start.getTime() - 1));
  return sql.begin(async (tx) => {
    const [{ last, computed }] = await tx`
      select
        (select max(finished_at) from job_feed_runs where finished_at >= ${monthBounds(before).start} and finished_at < ${start}) as last,
        (select max(computed_at) from market_openings_monthly where month = ${before}::date) as computed`;
    let previous = null;
    if (last && computed && new Date(computed) < new Date(last)) {
      await rewriteMonth(tx, before, new Date(last));
      previous = before;
    }
    const stats = await rewriteMonth(tx, month, now);
    return { ...stats, previous };
  });
}

/**
 * A rollup failure as a short code only, for the log: a Postgres SQLSTATE, else the error's name. Never its message,
 * which can quote values.
 */
export function failureCode(/** @type {unknown} */ error) {
  const e = /** @type {{ code?: unknown; name?: unknown } | null | undefined} */ (error);
  if (typeof e?.code === "string" && /^[0-9A-Z]{5}$/.test(e.code)) return e.code;
  if (typeof e?.name === "string" && /^[A-Za-z]{1,40}$/.test(e.name)) return e.name;
  return "error";
}

/** The reviewed board list, checked. */
export function loadBoards(path = new URL("src/content/job-boards.json", root)) {
  return jobBoardsFile.parse(JSON.parse(readFileSync(path, "utf8")));
}

/** Counts and board names only, for the log and the job summary. */
export function summaryLines(
  /** @type {BoardResult[]} */ results,
  /** @type {number} */ kept,
  /** @type {{ open: number; closed: number } | null} */ written,
  /** @type {{ month: string; rows: number; counted: number; unmatched: number; indiaOnly: number; previous?: string | null } | { failed: string } | null | undefined} */ rollup = undefined,
) {
  const ok = results.filter((r) => r.ok);
  const lines = [
    `Boards read: ${ok.length} of ${results.length}. Posts kept: ${kept}.`,
    written ? `Open posts: ${written.open}. Closed this run: ${written.closed}.` : "Dry run: DATABASE_URL is not set, so nothing was written.",
  ];
  if (rollup && "failed" in rollup) lines.push(`Market rollup failed (${rollup.failed}): this month's market_openings_monthly rows were not updated.`);
  else if (rollup) {
    lines.push(
      `Market ${rollup.month.slice(0, 7)}: ${rollup.rows} rows from ${rollup.counted} posts new this month or open; ` +
        `${rollup.unmatched} matched no live role and are left out; ${rollup.indiaOnly} counted in India only (Remote, India or a city off the list).`,
    );
    if (rollup.previous) lines.push(`Market ${rollup.previous.slice(0, 7)} was behind its last run, so it was rewritten as of that run.`);
  }
  for (const r of results.filter((x) => !x.ok)) lines.push(`Skipped ${r.ats}/${r.token}: last_error ${r.error}`);
  for (const r of results.filter((x) => x.ok && x.truncated)) lines.push(`Kept open ${r.ats}/${r.token}: answer cut short, so nothing on it was closed`);
  for (const r of results.filter((x) => x.ok && x.capped && !x.truncated))
    lines.push(`Capped ${r.ats}/${r.token}: over the post caps, so posts it still lists stay open and only ones it dropped were closed`);
  return lines;
}

/**
 * The kept posts by place, for the summary: "Posts kept by place: Bengaluru 120, Mumbai 40, Remote 10, India (no city) 5".
 * Every kept post is in India or remote India, so the counts add up to the posts kept. Place names only, never post text.
 */
export function placeLine(/** @type {{ city: string }[]} */ rows, top = 10) {
  if (!rows.length) return null;
  const count = new Map();
  for (const r of rows) count.set(r.city, (count.get(r.city) ?? 0) + 1);
  const named = [...count.entries()].filter(([c]) => c !== "Remote" && c !== "India").sort(([a, x], [b, y]) => y - x || a.localeCompare(b));
  const shown = named.slice(0, top).map(([c, n]) => `${c} ${n}`);
  const rest = named.slice(top).reduce((sum, [, n]) => sum + n, 0);
  if (rest) shown.push(`other cities ${rest}`);
  if (count.get("Remote")) shown.push(`Remote ${count.get("Remote")}`);
  if (count.get("India")) shown.push(`India (no city) ${count.get("India")}`);
  return `Posts kept by place: ${shown.join(", ")}.`;
}

export async function main() {
  const startedAt = new Date();
  const boards = loadBoards();
  const skills = JSON.parse(readFileSync(new URL("src/content/skills.json", root), "utf8"));
  const { rows, results, seen } = await collect(boards, skillMatchersFor(skills), { now: startedAt });
  let written = null;
  /** @type {Awaited<ReturnType<typeof writeRollup>> | { failed: string } | null} */
  let rollup = null;
  if (process.env.DATABASE_URL) {
    const sql = postgres(process.env.DATABASE_URL, { prepare: false, max: 1, onnotice: () => {} });
    try {
      const now = new Date();
      written = await writeRun(sql, { boards, rows, results, seen, startedAt, now });
      // Its own transaction: a rollup that fails leaves today's posts written, and the next run catches the month up.
      try {
        rollup = await writeRollup(sql, { now });
      } catch (error) {
        rollup = { failed: failureCode(error) };
      }
    } finally {
      await sql.end();
    }
  }
  const lines = summaryLines(results, rows.length, written, rollup);
  const places = placeLine(rows);
  if (places) lines.splice(1, 0, places);
  for (const line of lines) console.log(line);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## Departures feed\n\n${lines.map((l) => `- ${l}`).join("\n")}\n`);
  // Every board failing is the runner's network or an outage, not the boards: fail so someone looks.
  if (results.length && !results.some((r) => r.ok)) process.exitCode = 1;
  if (rollup && "failed" in rollup) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
