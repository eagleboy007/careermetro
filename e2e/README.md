# End-to-end walk

`walk.mjs` drives a real browser through the main flow against a running production build: home, roles, upload the
synthetic fixture resume, check the profile, pick a role, gaps, path (hours, mark a step done), the test sign-in that
claims the anonymous resume, Today (own goals, hours saved, tick to Returning with a streak, untick), the loading
frame, Map, Me, Departures, then phone size in dark mode with a horizontal-overflow check. It fails on any failed
step, browser console error, page error or 5xx response, and saves screenshots to `e2e/results/`.

`mock-ai.mjs` stands in for the Claude API, so the walk costs nothing and needs no key: the parse call gets a fixed
profile of `fixtures/resumes/priya-sharma.pdf`, and other calls get text that fails their schema, so the app's
plain-code fallbacks run.

CI runs it in the `e2e` job (`.github/workflows/ci.yml`). Locally, with Postgres migrated and seeded:

```sh
npm run build
node e2e/mock-ai.mjs &
VERCEL_ENV=preview ANTHROPIC_API_KEY=sk-e2e ANTHROPIC_BASE_URL=http://127.0.0.1:4011 npx next start -p 3211 &
BASE=http://localhost:3211 node e2e/walk.mjs   # needs `npm install --no-save playwright` once
```
