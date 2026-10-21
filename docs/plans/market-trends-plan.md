# Market trends, role switches and state-wise jobs and pay (pending item 24) (2026-10-20)

**Status: PR 1 and PR 2 built; PR 3 approved.** Milin proposed item 24 on 2026-10-12 and decided D1 to D6 on
2026-10-21: D1 yes (live counts, PR 2), D2 hold, D3 (a) no role pay for now, D4 yes (retire the accumulate step,
PR 3), D5 park, D6 keep the floor of 15 and a 12-month trend. PR 4 and PR 5 are not built. Nothing below is a plan
step if it needs money or a new kind of personal data; those are listed as decisions only.

## What is already built (no work needed)

- **Nearby lines (24a)**: built, #123 (`dev/nearby-lines-plan.md`, `src/lib/nearby/build.ts`). On Me, on the Map as
  interchange stations, and on the Market as a card. Deterministic matcher over the role profiles, no table. The
  "role switches" part of the item is this; nothing more is planned for it here.
- **Market screen (24c)**: built, #125 and #130 (`dev/market-plan.md`, FR-24b). `/market` with search, a 36-tile India
  map in plum `--heat-1..5` tokens (neutral, never cobalt or red/amber/green), place panel, 12-month trend, pay bands
  by experience, top cities, compare two places, Nearby lines. One Zod row shape (`src/lib/schemas/market.ts`:
  role × state [× city] × band, openings, pay p25/median/p75, source, month). The 15-a-month floor is
  `MARKET_MIN_OPENINGS`; below it every figure reads "Not enough data". **Every figure was EXAMPLE DATA until PR 2**
  (`MARKET_DATA = "example"` in `src/content/market/index.ts`); now only signed out and on `/design`.
- **Monthly openings feed**: wired but off. `scripts/jd-mining/accumulate.mjs` (in `.github/workflows/jd-mining.yml`,
  03:00 UTC on the 1st) counts Lever and Greenhouse India postings into `market-rows.csv` on a `data/market` branch;
  `src/content/market/feed.ts` loads it and drops the first (baseline) month.

## What feed data we actually hold (checked 2026-10-20)

- **`data/market` branch does not exist yet** (only `origin/data/jd-snapshot`). The first monthly run (1 Nov) will be
  the baseline, which the loader drops, so the monthly feed gives its first usable month on 1 Dec and a 12-month
  trend in late 2027.
- **The 2026-10-06 snapshot** (`data/market/ats-india-postings-2026-10-06.csv`): 68 India postings in 28
  role × state × city cells, all bands blank. No cell is near 15.
- **`job_posts` (live Departures feed, #184, 0040)**: daily, 147 boards (Greenhouse 54, Lever 44, Ashby 30,
  SmartRecruiters 19), capped at 10,000 open posts. Per post: title, company, `city` (an Indian city, "Remote" or
  "India"; **no state column**, the state comes from the city via `src/content/market/places.ts`), work type,
  `experience_note` (stated years only), `role_slug` (null when the title matches no live role), skill ids,
  `posted_at`, `first_seen_at`, `last_seen_at`, `closed_at`. **No salary field.** Closed posts are deleted 180 days
  after closing, so it cannot answer "last year" on its own. The live open count is in `job_feed_runs.posts_open`;
  this container cannot read the database, so the count is to be read before PR 1.
- **Research CSVs** (`/mnt/project-files/careermetro/data/market/`): `salaries.csv` (590 rows), `trends.csv` (93),
  `regions.csv` (85), `switch-paths.csv` (50). Nearly all are marked "research-only (licence needed for app)" or
  come from salary sites and job portals. **None is shown on screen.** The only reusable rows are GODL government
  state figures in `regions.csv` (EPFO state share, PLFS participation), still waiting for a spot-check against the
  source PDFs.
- Source survey: `/mnt/project-files/careermetro/data/market-data-sources.md` (2026-10-12).

## What we can show honestly, and from what

| Figure | Source | Can show | Below the floor |
|---|---|---|---|
| Open roles now, by role × state × city | `job_posts` open rows, today | Now (PR 1-2) | "Not enough data" under 15 |
| New roles a month, by role × state | monthly rollup of `job_posts.first_seen_at` (new table) | From the 2nd full month after PR 1 | same |
| Trend (Growing / Steady / Shrinking) | the rollup, 12 months | About 12 months after PR 1 | "Counting since {month}" |
| Experience mix | `experience_note` → band | Now, only for posts that state years | band hidden under 15 |
| State pay (all salaried workers) | PLFS (MoSPI), state tables | After D2 licence check | n/a (survey figure, labelled) |
| Role pay bands by experience | none free | Only after D3 | "Pay comes later" |

Every card names its source and date: "Open on public company job boards (Greenhouse, Lever, Ashby,
SmartRecruiters), 20 Oct 2026", and the undercount note from `dev/market-plan.md` (only companies with these boards;
skews to tech and startups; most Indian hiring is on portals we do not read). The model produces no number anywhere;
all figures are SQL or plain code.

## Data model (migration 0048)

`market_openings_monthly`: one row per month × role_slug × state × city (null for state-only) × band (null when no
years stated). Columns: `month` (date, first of month), `role_slug`, `state` (2-letter code or `IN` for all India),
`city`, `band` (`0-2`, `3-5`, `6-10`, `10+`), `new_posts` (first seen that month), `open_at_end` (open on the month's
last run), `boards_ok` (that month's lowest board count over its runs that read at least one board, so a jump from
a fixed board is visible; a run where every board failed is left out), `computed_at` (plus an `id` uuid primary key,
like the other tables). Unique on (month, role_slug, state, city, band) with nulls not distinct (Postgres 15 or later);
index on (role_slug, month). Written by the daily feed job (`scripts/departures/fetch-feeds.mjs`) as an idempotent
upsert for the current month, before the 180-day purge, so history outlives `job_posts`. The month before is
rewritten too, as of its last finished run, when that run's rollup failed (its rows are older than the run); a month
whose last day had no run stays as its last rollup left it, and a month with no rows is never filled in afterwards. No foreign keys (role slugs are content, not rows), so no
FK indexes are needed. **RLS enabled with no policies**, like every table; read only from the server. No personal
data: a post belongs to no one. Expand only.

Counting rules, kept from `accumulate.mjs` where `job_posts` allows: a post counts once in its city, once in that
city's state, once in `IN`; "Remote" and "India" count in `IN` only; a repost under a new URL counts again.
`job_posts` keeps one city per post (the first Indian city it lists), so a post listing several cities counts only in
that first city and its state, where `accumulate.mjs` counted it in every city and state listed. `IN` counts match.

## Screens

Reuse `/market` as is. Changes only:
- `MARKET_DATA` gains a `"live"` value that reads the rollup (and today's open counts) into the existing table shape;
  the example table stays for `/design` and the signed-out preview.
- Header and cards name the source and date (the switch-on checklist in `src/content/market/index.ts`, steps 2-5).
- Map metric "Openings" defaults to open-now counts; "Median pay" tile metric is hidden until a pay source exists
  (or shows PLFS state pay under its own label after D2, never mixed with role figures).
- Trend card: "Counting since {month}; the trend shows from {month + 13}" (Oct 2026 → Nov 2027, when the 12 months after
  the baseline month are all over) until it has 12 months; then the floor in words when a month is under 15.
- Pay bands card: "Pay comes later: company job boards in India rarely state pay." with no numbers.
- Colours unchanged: plum heat steps and ink; cobalt only on the Nearby lines bar.

## PRs (one feature each, one review pass, full check before the single push)

1. **Rollup table and writer**: Zod schema for a rollup row and tests first (city → state, `IN`, band from
   `experience_note`, idempotent re-run of a day, month roll-over); then migration 0048, the upsert in the daily
   feed, and the cleanup keeping rollups. No screen change. Built 2026-10-21 (`src/lib/market/rollup.mjs`,
   `writeRollup`); the cleanup now takes a test-only scope so test files sharing a database keep each other's rows.
2. **Market reads live counts**: loader from the rollup and open `job_posts` into `marketTable`; tests for the floor
   (14 hidden, 15 shown), sources, "Counting since"; header and card copy; e2e that no EXAMPLE DATA label shows on
   `"live"` and no pay number shows. Switch on only when Milin says (D1). Built 2026-10-21 and switched on (D1 yes):
   `src/lib/market/live.ts` (open posts now, new posts a month for the trend with the rollup's first month dropped as a
   baseline, the words), `live-store.ts` (the reads, per request after `connection()`, like Departures; no cache),
   `MARKET_DATA = "live"` for signed-in people; signed out and `/design` keep the example table.
3. **Retire the monthly accumulate step** (if D4 says so): remove the market step from `jd-mining.yml`, `feed.ts` and
   its tests; keep skill mining.
4. **PLFS state pay** (only after D2): a hand-checked CSV in `src/content/market/` with source, table number and
   date, Zod-validated; a separate "Salaried earnings by state (government survey, all occupations)" layer.
5. **Role pay** (only after D3): depends entirely on the decision.

Each PR updates `docs/STATUS.md` in 2-3 lines and the decision log in `dev/market-plan.md`.

## Tests

Schema tests for the rollup row and the PLFS row; unit tests for counting rules and the 15 floor in each figure;
a loader test that a row with an unknown role, state or city fails the build; an e2e that every Market card names a
source and month, in light and dark, and keyboard reaches the state list. No real resumes; synthetic posts in
`fixtures/feeds`. Resume text never involved.

## Risks

- **Thin and skewed counts**: 147 boards, mostly tech companies, mostly Bengaluru, Hyderabad, Pune, NCR. Most states
  will read "Not enough data" for most roles. That is the honest answer; the list under the map says so.
- **Board churn**: a board added or fixed makes a jump; `boards_ok` is stored so a jump can be explained.
- **Title matching**: posts with no `role_slug` are left out; the run log should report the share.
- **PLFS terms**: microdata reuse terms not yet read; report-table figures are safer than recomputed microdata.
- **Map boundary**: the tile map needs no boundary file; a drawn map later would (Survey of India external boundary).

## Open decisions for Milin (please approve or change)

- **D1. Switch the Market from example data to live counts** once PR 2 is reviewed, even though many cells will read
  "Not enough data"? Proposed: yes, with the undercount note.
- **D2. PLFS state earnings** as a separate, labelled government layer (all salaried workers, not per role), after
  someone outside this container reads the MoSPI reuse terms? Proposed: yes, report tables only.
- **D3. Role pay source** (needs your call; not a plan step): (a) none for now, "Pay comes later"; (b) an Adzuna API
  trial (free tier, attribution, estimates must be labelled; commercial terms to check); (c) a Lightcast quote
  (paid). Proposed: (a) now, (b) as a trial only if you agree.
- **D4. Retire the monthly Lever/Greenhouse accumulate** in favour of the `job_posts` rollup (four ATSs, daily)?
  Proposed: yes; one source of truth.
- **D5. User-shared pay** (opt-in, anonymous, shown only for groups of at least a set size, privacy review first):
  park until after launch? Proposed: park.
- **D6. Floor and trend length**: keep 15 a month and a 12-month trend, or allow a shorter "since we started
  counting" line (for example 6 months, clearly labelled)? Proposed: keep 15 and 12.
- Global (outside India): later, not in this plan.
