# Run CareerMetro on your own computer

This runs the whole app at http://localhost:3000 with a local database, the "Continue as test user" sign-in and a stand-in for the Claude API, so nothing costs money and no keys are needed. Written for a Mac; Linux is the same apart from the install lines.

## Once

1. Install Node 22 or newer and Postgres 16: `brew install node postgresql@16`, then `brew services start postgresql@16`.
2. Get the code: `git clone https://github.com/eagleboy007/careermetro.git && cd careermetro`, then `npm install`.
3. Make a database: `createdb careermetro`.
4. Copy `.env.example` to `.env.local` and set only these lines (leave the Supabase lines empty, which turns on the test sign-in):

   ```
   DATABASE_URL=postgres://localhost:5432/careermetro
   ANTHROPIC_API_KEY=sk-local
   ANTHROPIC_BASE_URL=http://127.0.0.1:4011
   CRON_SECRET=any-local-string-of-32-or-more-characters
   ```

5. Create the tables and load the roles, skills and resources:

   ```
   export DATABASE_URL=postgres://localhost:5432/careermetro
   npm run db:migrate
   npm run db:seed
   ```

## Each time

Open two terminal windows in the `careermetro` folder.

1. Stand-in Claude API: `node e2e/mock-ai.mjs` (it answers every resume with the same synthetic Data Analyst profile).
2. The app: `npm run dev`, then open http://localhost:3000.

Sign in at http://localhost:3000/sign-in with "Continue as test user" (any name, any email; it gets a `.test` ending). Finish sign-up with a first name and the 18+ tick, then use Today, Map, Departures, the Inbox icon, and Profile and Settings from the avatar menu. Upload a resume from `fixtures/resumes/` to see Gaps and Path.

## Getting the newest code

`git pull && npm install && npm run db:migrate && npm run db:seed`, then start the two windows again. If a page shows "Something went wrong" after a pull, the database is usually missing a migration: run `npm run db:migrate`.

## Notes

- Real resumes never go in this folder or in the database; use the synthetic ones in `fixtures/`.
- To use the real Claude API instead of the stand-in, put a real key in `ANTHROPIC_API_KEY` and delete the `ANTHROPIC_BASE_URL` line. Each upload then costs a few cents.
- Checks before a change is pushed: `npm run lint && npm run typecheck && npm test && npm run build`.
