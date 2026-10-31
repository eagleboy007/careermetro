# End-to-end walk

`walk.mjs` drives a real browser through the main flow against a running production build: home, roles, upload the
synthetic fixture resume, check the profile, pick a role, gaps (with "Asked in N of 10 postings"), the screening check (FR-34: keywords, layout, headings; opening "I have this" and cancelling saves nothing), check against a job,
"My role isn't listed" (Enter in a search that finds nothing is counted, typing alone is not, then a posting stands in as the target, in light, dark
and phone width), path (hours, mark a step done), the test sign-in that
claims the anonymous resume, Today (own goals, hours saved, tick to Returning with a streak, untick), the loading
frame, Map, Me, Departures, Corporate (a fresh account sets up a company on an example domain with the test-mode
code and lands on "Waiting for verification"), company review (signed out and a non-admin get the not-found page with a 404; the local test admin `admin@careermetro.test` tries Suspend, cancels, and verifies that company), then phone size in dark mode with a horizontal-overflow check, confirming a missing keyword, which stays a weak gap, the `hardening:` steps spread through the walk (keyboard, axe light and dark after a reload, and a 390 px fit on the screens from #175 to #193), and last `smoke 6` (`docs/launch/prod-smoke.md` 6.1 to 6.3: the settings Download link's file name, Sign out from the avatar menu, and signing in again straight to Today). It fails on any failed
step, browser console error, page error or 5xx response, and saves screenshots to `e2e/results/`. Its direct requests
(`q.request.get` and the like) go through `api()`, which sends one again once on a reset socket (ECONNRESET or "socket
hang up", T171) and never on an HTTP status; `oversize.mjs` does the same.

`scripts/smoke/staging-dry-run.mjs` reuses this walk's selectors to run `docs/launch/prod-smoke.md` sections 3 to 6 and 8 on staging with the real API (`.github/workflows/smoke-staging.yml`, by hand only). `scripts/smoke/staging-screens.mjs` does the same for Network, the bell, the builder, Library, Mock, Departures and the live Market (its pay check is the walk's `marketIsLive` one, plus `/market`'s data), then reuses the Corporate, company review, applications, reports and library review steps' selectors for Arrivals, Offers and the admin pages (those need the `SMOKE_ADMIN_EMAIL` admin test account, `admin@careermetro.test` in the workflow, and are skipped without it).

`mock-ai.mjs` stands in for the Claude API, so the walk costs nothing and needs no key: the parse call gets a fixed
profile of `fixtures/resumes/priya-sharma.pdf`, the job-posting call ("Check against a job") gets the skills listed in
`fixtures/job-postings/`, and other calls get text that fails their schema, so the app's plain-code fallbacks run.
`MOCK_AI_PORT` moves it off port 4011.

CI runs it in the `e2e` job (`.github/workflows/ci.yml`). Locally, with Postgres migrated and seeded:

```sh
npm run build
node e2e/mock-ai.mjs &
VERCEL_ENV=preview ANTHROPIC_API_KEY=sk-e2e ANTHROPIC_BASE_URL=http://127.0.0.1:4011 PHONE_KEY=e2e-only-phone-key FIND_REF_KEY=e2e-only-find-ref-key NAME_HASH_KEY=e2e-only-name-hash-key CRON_SECRET=e2e-only-cron-secret npx next start -p 3211 &
BASE=http://localhost:3211 node e2e/walk.mjs   # needs `npm install --no-save playwright` once
```

## Oversize check (T150)

After the walk, the `e2e` job seeds one synthetic member, Max Data, with every text at its cap (an 80-character word,
emoji and Hindi mixed through each list) and every growable list full, using the app's own stores for the gaps, path
and goals (`e2e/max-data/seed.run.ts`, sizes in `e2e/max-data/data.ts`; local databases only). `oversize.mjs` then signs
in as Max Data and opens Today, Map, My jobs, Me (Board and List), their /u profile, Library (three tabs), Practice, Mock,
Inbox, Network, the resume editor and the builder at 390x844 and 1280x800 in light and dark. It fails on sideways spill
(and lists the elements past the edge), on a page taller than its limit (`PAGES` in the script, with the reason for
each raised limit), on any page or console error (such as a hydration mismatch), or on the resume PDF taking more than
10 s. The seed also adds the most pitstops of the member's own the store allows (30: 3 a goal, the last three goals one
each so their spurs show a 40-letter word, Hindi and emoji), and on the Map the check fails when a spur label's
`getBBox` leaves the SVG's viewBox. The main resume has Hindi and emoji, so its PDF must be the designed "can't print" refusal (422); the PDF is timed
on a second, Latin-only resume at the same caps. It prints every page's height, saves `e2e/results/oversize/` (the `oversize-screenshots` artifact) and
removes the member. Locally, after the walk's set-up:

```sh
MAX_DATA_ACTION=seed npx vitest run --config vitest.max-data.config.ts
BASE=http://localhost:3211 node e2e/oversize.mjs
```

## Upload load test

`load-upload.mjs` sends a burst of uploads at once, then a steady rate, each from its own session and IP, against a
production build with `MOCK_AI_DELAY_MS` making the stand-in answer like a real 15-second parse. It counts the app's
database connections (pool of 5) and opens a saved resume's page once a second meanwhile, and fails on any 5xx other
than "crowded", on more than 5 connections, or on "crowded" in the steady phase. `.github/workflows/load.yml` runs it
when the upload path changes, or by hand with other `burst` and `rate` values.
