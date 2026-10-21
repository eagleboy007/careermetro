# Run CareerMetro on your own computer

This runs the whole app at http://localhost:3000 with a local database, the "Continue as test user" sign-in and a stand-in for the Claude API, so nothing costs money and no keys are needed. Written for a Mac; Linux is the same apart from the install lines.

## Once

1. Install Node 22 or newer and Postgres 16 (15 at the oldest: migration 0048 uses `UNIQUE NULLS NOT DISTINCT`): `brew install node postgresql@16`, then `brew services start postgresql@16`. If `brew services` fails (a known Homebrew bug on some Macs), start Postgres directly: `pg_ctl -D "$(brew --prefix)/var/postgresql@16" -l /tmp/postgres.log start` (add `$(brew --prefix postgresql@16)/bin` to your PATH first).
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

Sign in at http://localhost:3000/sign-in with "Continue as test user" (any name, any email; it gets a `.test` ending). Finish sign-up with a first name and the 18+ tick, then use Today, Map, Departures, the Inbox icon, and Profile and Settings from the avatar menu. Upload a resume from `fixtures/resumes/` to see Gaps and Path. To try "Check against a job" on the Gaps page, paste the posting text from `fixtures/job-postings/example-analytics-data-analyst.json`; the stand-in answers with that posting's skills.

## Test people

The stand-in Claude API doesn't really read resumes. It knows the 31 synthetic resumes in `fixtures/evals/` (one per role, for example Arjun Verma for full stack developer, Aisha Khan for senior backend engineer, Gurpreet Singh for cloud engineer, Sneha Iyer for SOC analyst L2). Paste one of them and it comes back as that person's reviewed profile. Any other resume comes back as the sample profile Priya Sharma, a data analyst.

To try one:
1. Sign in at /sign-in with "Continue as test user", using the person's name exactly as it appears on the first line of their resume (the name check compares them) and any email.
2. On Today or /start, choose "Paste text" and paste the `resumeText` from their file in `fixtures/evals/` (the text between the quotes, with each `\n` as a new line). Or print it with `node -e "console.log(require('./fixtures/evals/full-stack-mern-bootcamp.json').resumeText)"`.
3. Confirm what was found, then pick the role named in the file's `roleSlug`.

## Company review (admin)

The company review page, http://localhost:3000/admin/companies, is for CareerMetro's own admins. Locally (and on previews with the test sign-in), while `ADMIN_EMAILS` is empty, sign in with "Continue as test user" as `admin@careermetro.test` to use it; it then shows Admin in the avatar menu. Every other account, and anyone signed out, gets the normal "We can't find that page". Once `ADMIN_EMAILS` is set, only the addresses in it count, and a test user never does (its email ends in `.test`). Production never uses the local default: with `ADMIN_EMAILS` unset there, nobody is an admin.

To have something to review, set up a company from Corporate first (see the walk in `e2e/README.md`).

## Getting the newest code

`git pull && npm install && npm run db:migrate && npm run db:seed`, then start the two windows again. If a page shows "Something went wrong" after a pull, the database is usually missing a migration: run `npm run db:migrate`.

## Notes

- Real resumes never go in this folder or in the database; use the synthetic ones in `fixtures/`.
- To use the real Claude API instead of the stand-in, put a real key in `ANTHROPIC_API_KEY` and delete the `ANTHROPIC_BASE_URL` line. Each upload then costs a few cents.
- Checks before a change is pushed: `npm run lint && npm run typecheck && npm test && npm run build`.
