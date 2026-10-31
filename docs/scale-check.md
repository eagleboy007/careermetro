# Scale check

How the app holds up with about 10,000 members: each main signed-in page and each cron, timed against a production
build, with the key queries explained. It runs in CI on its own PostgreSQL only (`.github/workflows/scale.yml`); a
staging run comes later and is wired on its own, once the CI numbers are in.

## What it does

1. **Seed** (`scripts/scale/seed.mjs`): 10,000 synthetic members (`SCALE_MEMBERS`), written in one transaction with
   multi-row inserts, then `ANALYZE`. A fixed-seed generator makes every run write the same rows. Each member gets what a
   few months of use leaves behind:
   - a parsed, confirmed resume and its gap analysis for one of 16 roles (data and software weighted first), about 6% with
     an earlier destination and goals left on that line;
   - a goal per gap (the first few met for active members), sometimes a "Your choice" goal or two, and ride days over the
     last 90 days at one of six activity levels;
   - My jobs: jobs added from other sites (job checks, some with a description) and saved feed posts, with stages, notes and
     interviews, long-tailed (most a few, some near 60); a few unsaved and Gaps-page checks too;
   - Settings for about 90% (visibility, find-me, gaps shown to, weekly email on for about a quarter, the events digest for
     about a fifth, radius, places), Elite for about 30%;
   - Timetable interests and Save or I'm going marks, connections (mostly people on the same line, long-tailed), open and
     old connection requests with their bell notifications, a few chats, past weekly emails and digests (some over 90 days
     old), practice answers (some past 30 days) and roles added on Me.

   Shared rows: 6,000 open and 3,000 closed feed posts (some closed over 180 days ago), 1,200 Timetable events (some ended
   over 90 days ago) with their topics, and one feed run so Departures reads the posts as live.

   Everything is made up: Indian-style names from a short list, companies such as "Kaveri Analytics Pvt Ltd", links on
   `example.com`, emails `scale-<n>@example.invalid` (stored as `scale-<n>@example.invalid.test`, as the test sign-in
   stores them). The seed prints counts only.
2. **Time** (`scripts/scale/time.mjs`), against `next start` of a preview build:
   - signs in as four seeded members spread through the seed (`TIMED_MEMBERS`) with the test sign-in's signed cookie, made
     as `src/lib/auth/test-user.ts` makes it;
   - opens Gaps, Path, Today, Map, Departures, My jobs, Timetable, Me and Network once per member (the first visit, which
     builds the member's current analysis and path), then `RUNS` more times (5): 20 samples a page. Server time is the
     whole streamed HTML read on the same machine; the report gives the first visit, p50 to first byte, p50, p95 and max;
   - calls every cron in `vercel.json` as Vercel Cron does (GET with the `CRON_SECRET` bearer), the events digest before
     the weekly email and the cleanup last, and times each against the route's `maxDuration`. The weekly email and the
     digest run their whole send path: `scripts/scale/resend-stub.mjs`, preloaded into the server in this workflow only,
     answers for Resend, so nothing is sent;
   - runs `EXPLAIN (ANALYZE, BUFFERS)` on 13 key queries for the first member (current analysis, On your line on the
     busiest goal skill, Departures' two open-post reads, the My jobs list, the Timetable read, Network's tabs, request
     count and name search, who the weekly email and the digest go to, two cleanup reads), with the plans in the report;
   - lists the slowest statements Postgres saw during the pages and during the crons (`pg_stat_statements`, which the
     workflow preloads), normalised so no value shows, with generic plans for the slowest three;
   - reports the app server's peak resident memory, database size and row counts.

   The report goes to the job summary and `scripts/scale/results/report.md` (the `scale-results` artifact, with the
   server log).
3. **Clean up** (`scripts/scale/cleanup.mjs`): deletes the members by their reserved emails (everything an account owns
   goes with it), their chats, the posts by their `scale-board-` board tokens, the events by their `scale-event-` source
   keys and the feed run by its fixed id, then checks nothing of the seed is left. The seed runs it first too.

## Limits it checks

| What | Limit | Where it comes from |
|---|---|---|
| A page's p95 server time | 2.5 s (`PAGE_BUDGET_MS`) | Our budget for a signed-in page on Vercel in Mumbai. |
| A page's answer | 200 every time, no error page | Any redirect (such as to sign-in), 404 or 500 fails. |
| A cron's time | 80% of the route's `maxDuration` (`CRON_SHARE`) | Every cron route sets 60 s, the most Hobby allows without Fluid compute (with it, Hobby allows 300). A route that set none would get Hobby's default, 10 s without Fluid compute, which the check assumes. |
| A cron's answer | 200 | A 500 means one of its jobs failed. |
| Memory | Reported, not checked | Hobby gives a function 2 GB (`vercel.json` sets none); the report shows the whole server's peak, an upper bound. |

The weekly email and the digest also stop themselves after 30 s (`RUN_MS`) and at the shared app-email budget (40 a day,
20 for the digest), so their time stays bounded; the report's counts (`considered`, `sent`, `empty`, `capped`) say how far
a run got. A digest that stops on time before sending its 20 is flagged in the table: people with no event that week
get no row, so they stay first in line every run (see Findings).

## Running it

In CI: the workflow runs on pull requests that change `scripts/scale/**` or the workflow, every Monday at 03:30 UTC on
main, and by hand (Actions → Scale check → Run workflow, with the member count and runs as inputs). About 15 minutes.

Locally, with PostgreSQL migrated and seeded (`npm run db:migrate && npm run db:seed`) and `pg_stat_statements` in
`shared_preload_libraries` if you want the statement lists:

```sh
VERCEL_ENV=preview npm run build
node scripts/scale/seed.mjs
node e2e/mock-ai.mjs &
NODE_OPTIONS="--import=file://$PWD/scripts/scale/resend-stub.mjs" VERCEL_ENV=preview ANTHROPIC_API_KEY=sk-e2e \
  ANTHROPIC_BASE_URL=http://127.0.0.1:4011 CRON_SECRET=e2e-only-cron-secret RESEND_API_KEY=re_scale_stand_in \
  EMAIL_FROM="CareerMetro <codes@example.invalid>" PHONE_KEY=e2e-only-phone-key FIND_REF_KEY=e2e-only-find-ref-key \
  NAME_HASH_KEY=e2e-only-name-hash-key npx next start -p 3211 &
BASE=http://localhost:3211 CRON_SECRET=e2e-only-cron-secret node scripts/scale/time.mjs
node scripts/scale/cleanup.mjs
```

All three scripts refuse any database not on this machine, and `VERCEL_ENV=production`.

## What the numbers mean and don't

- The CI runner's PostgreSQL sits on the same machine as the app, with no network between them; on Vercel each query
  crosses from `bom1` to Supabase in `ap-south-1` (about 1 to 2 ms a round trip), and Supabase's small instances have less
  memory and CPU than the runner. Treat CI times as a floor: a page that makes many queries in a row costs more in
  production than here.
- Pages are timed one request at a time, warm. Cold starts and many members at once are the load test's subject
  (`.github/workflows/load.yml`), not this one's.
- Rows the app itself writes while it is timed (its analysis and path for the timed members, rate-limit windows, model-call
  records, the day's app-email count, weekly-email and digest rows) are not seed rows; they stay in the CI database, which
  the job throws away.

## Findings

Read from the code before the first run; the first CI run's report confirms or clears each.

- **Cleanup had no `maxDuration`.** On Hobby without Fluid compute that is 10 s, for 22 jobs over the whole database. It now
  sets 60 s like the other crons (`src/app/api/cron/cleanup/route.ts`).
- **The events digest can starve.** `runEventsDigests` orders people by the last week they got a digest, never-sent first,
  and a person with no matching event that week gets no row. Opted-in people with no match therefore stay at the front of
  every run, each costing a timetable read. If they take more than the run's 30 s, people behind them are never reached.
  The report's `considered` against the opted-in count shows whether that happens at 10,000; the fix (keep an "empty" row,
  or match in SQL) is a product decision and is not in this PR.
- **On your line** filters every other person with an active goal on the skill through `goalOnCurrentLine`, a correlated
  subquery per row. Indexed, but its cost grows with the busiest skill's goal count; its EXPLAIN is in the report.
- No index is added before the numbers: every per-member read the pages make is already indexed (`job_saves_user_updated`,
  `job_posts_open_newest`, `user_goals_skill_status`, the connection and request indexes). A migration follows only if
  the first run shows a slow plan.
