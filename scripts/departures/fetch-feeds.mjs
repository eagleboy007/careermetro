// The daily Departures feed (docs/plans/departures-live-plan.md; .github/workflows/departures.yml). One public GET per
// reviewed board (src/content/job-boards.json) through the job-board APIs of Greenhouse, Lever, Ashby and
// SmartRecruiters only: never a web page, never LinkedIn, Naukri or any site whose terms forbid it. Each answer is
// checked with Zod; posts in India (or remote India) are kept with the skill ids the taxonomy finds by code, and no
// model is called. No post text is stored or logged: the log and the run summary name boards and counts only.
//
// With DATABASE_URL set it upserts job_posts by external id, closes the open posts of each board it read that this run
// didn't see (a board that failed closes nothing; a board taken off the list closes all of its posts) and records the
// run in job_feed_runs. Without it, it reads the boards and prints the counts (a dry run).
// Usage: node scripts/departures/fetch-feeds.mjs
import { appendFileSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import postgres from "postgres";
import { capPosts, FEED_LIMITS, feedUrl, postRow, rawPost, skillMatchersFor, USER_AGENT } from "../../src/lib/departures/feed-rules.mjs";
import { FEED_SCHEMAS, jobBoardsFile, jobPostRow } from "../../src/lib/departures/feed-schemas.mjs";

const root = new URL("../../", import.meta.url);

/** @typedef {import("../../src/lib/departures/feed-rules.mjs").Ats} Ats */
/** @typedef {{ company: string; ats: Ats; token: string }} Board */
/**
 * `capped`: the caps dropped some of this board's posts. `truncated`: the answer may be only part of the board (a full
 * SmartRecruiters page). Either way the board closes nothing this run.
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
 * Every board, read in turn (a few at once), as checked job_posts rows and one result per board. A board whose answer
 * doesn't fit its schema fails as a whole; one posting that doesn't fit is skipped. The caps are applied at the end.
 * @param {Board[]} boards
 * @param {import("../../src/lib/departures/feed-rules.mjs").SkillMatcher[]} matchers
 * @param {{ fetchImpl?: typeof fetch; timeoutMs?: number; maxBytes?: number; concurrency?: number; perBoard?: number; total?: number }} [deps]
 */
export async function collect(boards, matchers, deps = {}) {
  /** @type {BoardResult[]} */
  const results = [];
  /** @type {ReturnType<typeof jobPostRow.parse>[]} */
  const rows = [];
  /** @type {Map<string, BoardResult>} */
  const byKey = new Map();
  let next = 0;
  const one = async (/** @type {Board} */ board) => {
    const got = await getJson(feedUrl(board.ats, board.token), deps);
    if (!got.ok) return results.push({ ats: board.ats, token: board.token, ok: false, posts: 0, error: got.error });
    const schema = FEED_SCHEMAS[board.ats];
    const envelope = schema.board.safeParse(got.data);
    if (!envelope.success) return results.push({ ats: board.ats, token: board.token, ok: false, posts: 0, error: "invalid" });
    let posts = 0;
    const truncated = schema.truncated(envelope.data);
    for (const item of schema.jobs(envelope.data)) {
      const job = schema.job.safeParse(item);
      if (!job.success) continue;
      if (board.ats === "ashby" && job.data.isListed === false) continue;
      const row = postRow(board.ats, board, rawPost(board.ats, job.data, board.token), matchers);
      const checked = row ? jobPostRow.safeParse(row) : null;
      if (!checked?.success) continue;
      rows.push(checked.data);
      posts++;
    }
    /** @type {BoardResult} */
    const result = { ats: board.ats, token: board.token, ok: true, posts, error: null, ...(truncated ? { truncated: true } : {}) };
    results.push(result);
    byKey.set(key(board), result);
  };
  await Promise.all(
    Array.from({ length: Math.max(1, deps.concurrency ?? 4) }, async () => {
      while (next < boards.length) await one(boards[next++]);
    }),
  );
  // Every row checked before the caps counts as seen, so writeRun never closes a live post the caps left out; a board
  // the caps cut is marked so it closes nothing at all.
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
 * digits, - and _ only), so nothing needs quoting.
 */
const pgArray = (/** @type {string[]} */ ids) => `{${ids.join(",")}}`;
const key = (/** @type {{ ats: string; token: string }} */ b) => `${b.ats}:${b.token}`;
const SAFE_KEY = /^[a-z]+:[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/;

/**
 * The boards whose open posts this run may close: each board read whole and kept whole (a board that failed, was cut
 * short or was cut by the caps closes nothing),
 * and, with `unlisted`, every board that still has open posts but is no longer on the reviewed list.
 * @param {string[]} openKeys `ats:token` of the boards with open posts now
 * @param {BoardResult[]} results
 * @param {Board[]} boards
 */
export function boardsToClose(openKeys, results, boards, unlisted = true) {
  const listed = new Set(boards.map(key));
  const read = results.filter((r) => r.ok && !r.capped && !r.truncated).map(key);
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
        from jsonb_to_recordset(${JSON.stringify(chunk)}::jsonb) as x(ats text, board_token text, external_id text, url text,
          title text, company text, city text, work_type text, experience_note text, role_slug text, required_skill_ids text[],
          nice_skill_ids text[], posted_at timestamptz)
        on conflict (ats, board_token, external_id) do update set
          url = excluded.url, title = excluded.title, company = excluded.company, city = excluded.city,
          work_type = excluded.work_type, experience_note = excluded.experience_note, role_slug = excluded.role_slug,
          required_skill_ids = excluded.required_skill_ids, nice_skill_ids = excluded.nice_skill_ids,
          posted_at = coalesce(excluded.posted_at, job_posts.posted_at), last_seen_at = excluded.last_seen_at, closed_at = null`;
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
          select 1 from jsonb_to_recordset(${JSON.stringify(seen)}::jsonb) as s(k text, id text)
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

/** The reviewed board list, checked. */
export function loadBoards(path = new URL("src/content/job-boards.json", root)) {
  return jobBoardsFile.parse(JSON.parse(readFileSync(path, "utf8")));
}

/** Counts and board names only, for the log and the job summary. */
export function summaryLines(/** @type {BoardResult[]} */ results, /** @type {number} */ kept, /** @type {{ open: number; closed: number } | null} */ written) {
  const ok = results.filter((r) => r.ok);
  const lines = [
    `Boards read: ${ok.length} of ${results.length}. Posts kept: ${kept}.`,
    written ? `Open posts: ${written.open}. Closed this run: ${written.closed}.` : "Dry run: DATABASE_URL is not set, so nothing was written.",
  ];
  for (const r of results.filter((x) => !x.ok)) lines.push(`Skipped ${r.ats}/${r.token}: last_error ${r.error}`);
  for (const r of results.filter((x) => x.ok && (x.capped || x.truncated)))
    lines.push(`Kept open ${r.ats}/${r.token}: ${r.truncated ? "answer cut short" : "over the post caps"}, so nothing on it was closed`);
  return lines;
}

export async function main() {
  const startedAt = new Date();
  const boards = loadBoards();
  const skills = JSON.parse(readFileSync(new URL("src/content/skills.json", root), "utf8"));
  const { rows, results, seen } = await collect(boards, skillMatchersFor(skills));
  let written = null;
  if (process.env.DATABASE_URL) {
    const sql = postgres(process.env.DATABASE_URL, { prepare: false, max: 1, onnotice: () => {} });
    try {
      written = await writeRun(sql, { boards, rows, results, seen, startedAt });
    } finally {
      await sql.end();
    }
  }
  const lines = summaryLines(results, rows.length, written);
  for (const line of lines) console.log(line);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## Departures feed\n\n${lines.map((l) => `- ${l}`).join("\n")}\n`);
  // Every board failing is the runner's network or an outage, not the boards: fail so someone looks.
  if (results.length && !results.some((r) => r.ok)) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
