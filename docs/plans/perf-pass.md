# Performance pass: Today, Map and Departures (2026-10-20)

Target: a mid-range phone on a mobile network. A code-level pass only: no build, Lighthouse or `EXPLAIN` could run
here (no node_modules, no database), so query counts below are counted from the code and are approximate. Behaviour is
unchanged: the same rows are read and the same values reach the page; only when reads start, and how often, changed.

## What a request did

The signed-in layout reads about ten small things in parallel on every page: the account (cached), last seen, the
streak (2 queries), Inbox, company and Network counts, Elite, the Arrivals count, the job search switch and the bell.
The pool is 5 connections per server process (`src/db/index.ts`), so these and the page's parallel reads queue on it.

| Page | Before | After |
| --- | --- | --- |
| Today (returning, job search on) | `currentAnalysis` read 3 times (Today state, the ride's tracked analysis, the board's fit), the job search row twice (layout and page). About 17 database round trips one after another: the analysis twice, the goal sync transaction (about 8), then the held certificates, path, steps, courses and added resources each in turn, then the board, fit and On your line. | The analysis is read once, in parallel with the switch, and handed on. The held certificates, the path with its steps and courses, and the added resources are read beside the goal sync. The board's 300 open posts start reading beside the ride; fit and On your line still read after the ride, since fit reads the goals the ride syncs. About 12 in turn. |
| Map | `currentAnalysis` twice (role line and Life line). About 14 in turn: the sync, then the held certificates, path, steps, courses, swaps, then the resume and proof. | The analysis once, handed to both lines. The sync, held certificates, path chain, resume and proof read together. About 10 in turn. |
| Departures | The analysis, then the posted jobs, then everything else: about 4 in turn. `currentAnalysis` 3 times (page, fit, apply states), the job search row and Elite twice each (layout and page). | Every read starts at once; fit waits only for the analysis, apply states and criteria only for the posted jobs. About 2 to 3 in turn. The analysis is handed to fit, and the switch and Elite are read once per request. |

## What changed

- `src/lib/gaps/current.ts`: the `CurrentAnalysis` type. `todayStateFor`, `todayRideFor` (option `analysis`),
  `rideGoalsFor` (option `analysis`), `trackedCurrentAnalysis` (4th argument `read`), `fitContextFor`, `mapLineFor`
  and `lifeLineFor` take an analysis already read in the request; left out (`undefined`) they read it as before, and
  `null` means none. Every other caller is unchanged.
- `rideGoalsFor` and `mapLineFor` read their independent parts with `Promise.all`. The sync writes only goals and the
  steps' goal links, which none of the parallel reads use; proof and the resume are not written by it either.
- `todayBoardFor` takes `{ analysis, posts }`: Today starts `departuresBoard(null)` before the ride and hands the
  promise in. A no-op `catch` keeps a failed read from counting as unhandled while the ride runs; the board still sees
  the failure and logs `today_board_failed` as before.
- `src/lib/request-reads.ts`: `jobSearchForRequest` and `eliteOnRequest`, wrapped in React `cache` like
  `currentAccount`, used by the layout, Today and Departures only. Actions and stores call the store functions, so a
  write is never answered from a read made before it.
- Migration 0046 `job_posts_open_newest` (below).
- Tests: Today's state, the Map's lines and Departures' fit give the same result from a handed-in analysis, and none
  for `null` (`src/lib/today/state.test.ts`, `src/lib/map/store.test.ts`, `src/lib/departures/store.test.ts`).

## Indexes

Checked every `WHERE` and `ORDER BY` on these three pages, and every foreign key of the tables from 0040 to 0045.

- Added, 0046: `job_posts_open_newest` on `(coalesce(posted_at, first_seen_at)) WHERE closed_at is null`. Departures
  and every Today view with job search on read the newest 300 open posts of up to 10,000 (#194) ordered by that
  expression; `job_posts_closed_role` and `job_posts_open_role_city` find open posts but not in that order, so each
  request read and sorted every open post. Read backwards, the new index gives the order and the read stops at 300;
  the tie on `id` is an incremental sort within equal times. One column, ascending: a backward scan gives exactly
  `DESC NULLS FIRST`, the query's own order, so a descending index would add nothing. The
  `?role=` read keeps using `job_posts_open_role_city` (one role's posts are few).
- Already covered: `job_saves` by its primary key (user first) and `job_saves_job_post`; `job_feed_runs_finished`;
  `ride_days` by its primary key (user, day) for the count, the week and `doneBefore`; `user_goals` by
  `user_goals_skill` (user first) and `user_goals_skill_status` for On your line; `notifications_user_unread` for the
  bell; `user_resources` by its primary key; `connections` and `blocks` pair lookups by their primary keys;
  `gap_proofs_user_skill`; `paths_gap_analysis`; `path_steps_position`; `profiles_resume_version`;
  `gap_analyses_profile`; `resumes_user`; `applications_user`; `jobs_status_created` for posted jobs; `user_settings`
  by its primary key (0045 added columns only).
- Foreign keys from 0040 to 0045 all have an index except `resource_reports.decided_by` and
  `resource_suggestions.decided_by`, left unindexed on purpose by 0041 (never queried by; only an admin account's
  deletion scans them, on two small tables).

## Client bundle

`src/lib/client-bundle.test.ts` already fails the build if a client module reaches zod, `@/lib/schemas` (other than
constants), `@/content`, server-only code or drizzle. Tracing the client trees of Today (`today-preview`), the Map
(`metro-map`) and Departures (`departures-view`, `posted-jobs`) and the shell found no content JSON, no zod and no
wholesale icon imports (each `lucide-react` icon is imported by name); the certificate form and the Map's heavy parts
are already loaded with `next/dynamic`. Nothing to change.

## Left, with reasons

- The goal sync runs on every Today and Map view: a transaction with an advisory lock and about 8 round trips, even
  when nothing changed. Skipping it when the goals already match the analysis is the biggest remaining win, but it is
  in `src/lib/goals/store.ts`, which only one branch may touch at a time, and its rules decide proof; it needs its own
  plan and DB tests.
- The streak is read by the layout and again by Today's ride (2 primary-key queries, in parallel, with different
  clocks). Sharing it means threading the stats through `todayRideFor`; small gain.
- Departures' apply states read `currentAnalysis` once more, in parallel (`src/lib/corporate/applications-store.ts`,
  shared with Express apply). The job search switch and "Open to work in" are two parallel primary-key reads of the
  same `user_settings` row. The role line and the Life line each read the resume's profile, in parallel. Each is one
  query that costs no waiting.
- The pool of 5 connections per process: the layout's reads and the page's parallel reads queue on it. Raising it
  needs the Supabase pooler's limits checked; not a code-only change.
- Today's board reads 300 posts to show 5 rows, because fit is the matcher in code (`postView`) and the rows must
  agree with `/departures`. Departures sends those 300 posts to the browser as props by design (#194).
- Per-person reads without a `LIMIT` (goals, saved posts, ride days before today, the ride-day count) grow by a row
  a day or a goal at a time and stay small.
- `resources` is matched by `skill_ids && ...` without a GIN index; the catalog is about 440 rows.
- `today-preview` imports `USER_STATE_LABELS` from `src/lib/today/fixtures.ts`, the example-data module; production
  tree-shaking drops its unused exports, so it is not moved.
