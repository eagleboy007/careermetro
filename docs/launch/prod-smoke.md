# Production smoke check, right after the redeploy

Written by Development, 2026-10-20 (launch-readiness pass, `docs/plans/launch-readiness-pass.md`). It goes with `docs/dev/launch-day.md`: that page says when to run this one. One person runs it against **https://careermetro.vercel.app** in about 15 minutes, in a private browser window, on a phone-sized window or a real phone.

This page holds no key values. Keys live only in Vercel, Supabase, GitHub and the password manager (`docs/secrets.md`).

**Where to look when a step fails**
- **Vercel logs:** Vercel > careermetro > Logs, filter Production, level Error, the last 15 minutes. App lines are JSON with an `event` name, such as `resume_upload_failed` or `health_secrets_missing`. They never hold names, emails or resume text.
- **Supabase auth logs:** Supabase > the production project (Mumbai) > Authentication > Logs. Sign-in code problems show here in full. Vercel logs show `auth_email_code_send_refused` or `auth_email_code_verify_refused` with Supabase's error code and status only (no email, no code).
- **Supabase tables:** Supabase > Table Editor, read only. Look at row counts and timestamps only. Never copy rows out.
- **Health:** `https://careermetro.vercel.app/api/health`, which needs no secret.

---

## 0. Pre-flight: settings that must be in Vercel (Production) before the redeploy

`/api/health` names the three marked **H** when they're missing (`"missingSecrets"`). It checks nothing else on this list, so tick the rest by hand in Vercel > Settings > Environment Variables.

| Setting | Needed for | What fails without it |
|---|---|---|
| `DATABASE_URL` (transaction pooler, port 6543) | Everything that reads or saves | Every signed-in page and every upload fails; health shows `"database":"down"` |
| `ANTHROPIC_API_KEY` | Resume reading, gap explanations, path wording, practice and mock feedback | Uploads say "Our resume reader is unavailable right now"; explanations and paths fall back to template wording; health shows `"claude":"no_key"` |
| `CRON_SECRET` **H** | The daily cleanup (`/api/cron/cleanup`) and the smoke workflow's parse check | Anonymous resumes are not deleted after 24 hours (FR-2), and the cleanup answers 401; it is also the fallback hash key until the next two are set |
| `NAME_HASH_KEY` **H** | Resume name check, certificate ids, pasted-job hashes, work-email codes and invites | Health is red; work-email checks, company sign-up, phone sharing and Find people stay off in production. **Set once, never change it** |
| `IP_HASH_KEY` **H** | Hashing IPs and emails in the rate limits | Health is red; limits fall back to the CRON_SECRET key |
| `PHONE_KEY` (optional) | Encrypting shared phone numbers | Falls back to NAME_HASH_KEY. Set it **before** phone sharing opens, or never |
| `FIND_REF_KEY` (optional) | The ids companies see in Find people | Falls back to NAME_HASH_KEY |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (anon key, never service_role) | Real sign-in | `/sign-in` says "Sign-in isn't switched on yet." These are built into the page, so they need a redeploy, not only a save |
| `TODAY_PREVIEW` = `1` | Opens the signed-in app, `/sign-in`, `/privacy`, `/terms`, `/grievances` and `/admin` in production | All of those answer 404, **including `/sign-in`**. Set it last |
| `ADMIN_EMAILS` | `/admin/companies`, `/admin/proofs`, `/admin/reports`, `/admin/library` | Every admin page answers 404, even for Milin |
| `GOOGLE_SIGNIN` = `1` (optional) | The "Continue with Google" button | Only the emailed code is offered. Leave it out until Google is set up in Supabase |
| `RESEND_API_KEY`, `EMAIL_FROM` | The app's own emails: company sign-up, join and re-check codes, the current-job check | Those flows say they open soon. **Sign-in codes don't use these**: Supabase sends them (Supabase > Authentication > Emails > SMTP, `dev/email-sender-steps.md` step 4) |
| `PARSE_DAILY_BUDGET_USD`, `EXPLAIN_…`, `WRITE_PATH_…`, `PRACTICE_…`, `JOB_CHECK_…`, `MOCK_DAILY_BUDGET_USD` (optional) | Daily AI spend caps | Defaults apply: $5, $2, $2, $2, $2 and $3 |

Set by Vercel itself, never by hand on Vercel: `VERCEL_ENV` (must read `production`, or the app treats itself as a preview and skips the production key checks) and `VERCEL_PROJECT_PRODUCTION_URL` (link previews and absolute links).

Outside Vercel:
- Supabase > Authentication > URL Configuration: Site URL `https://careermetro.vercel.app`, redirect `https://careermetro.vercel.app/**`.
- Supabase > Authentication > Emails: the **Magic Link** and **Confirm signup** templates both show `{{ .Token }}`. A new address gets Confirm signup, a returning one gets Magic Link.
- Supabase > Authentication > Emails > SMTP: Resend, from `no-reply@careermetro.com` (otherwise only a few codes an hour go out).
- GitHub > Settings > Secrets: `CRON_SECRET` matches Vercel, for the parse check.

---

## 1. Automated checks first (2 minutes)

| # | Do this | You should see | If not, look at |
|---|---|---|---|
| 1.1 | Open `https://careermetro.vercel.app/api/health` | `{"ok":true,"database":"ok","schema":"ok","claude":"ok"}` | `missingSecrets`: add those settings and redeploy. `"schema":"behind"`: the Migrate database workflow on GitHub didn't finish. `"claude"` other than ok: `claudeError` names the cause (key, credit, model access) |
| 1.2 | GitHub > Actions > **Smoke check** > Run workflow. URL `https://careermetro.vercel.app`, check `parse` | A green run whose summary says HTTP 200 with `"parse":"ok"` | 401: the `CRON_SECRET` repository secret is missing or differs from Vercel. 403: Deployment Protection covers the URL, so set `VERCEL_AUTOMATION_BYPASS_SECRET` |

The parse check runs the real resume-parse request on a built-in synthetic resume and spends a few cents of the parse budget. The same workflow also runs by itself after every production deploy (without parse) and every 6 hours.

**On staging** (`https://careermetro-git-staging-career-metro.vercel.app`, behind Vercel Deployment Protection): run the same workflow with that URL. It sends the `VERCEL_AUTOMATION_BYPASS_SECRET` repository secret as the `x-vercel-protection-bypass` header. By hand from a terminal, read the value from the password manager into a variable first, so it stays out of your shell history and out of any document:
`curl -sS -H "x-vercel-protection-bypass: $BYPASS" https://careermetro-git-staging-career-metro.vercel.app/api/health`

The browser part runs on staging too: GitHub > Actions > **Smoke dry run (staging)** > Run workflow (URL defaults to staging). It runs `scripts/smoke/staging-dry-run.mjs`: 1.1, then sections 3 to 6 and the account deletion in 8, with "Continue as test user" in place of the emailed code, and it deletes the test account at the end even after a failure. Each step prints one ok or FAIL line; the header, the test email and the resume are never printed. It spends a few cents of staging's parse and explain budget. By hand: `BASE=<url> BYPASS=$BYPASS node scripts/smoke/staging-dry-run.mjs` after `npm install --no-save playwright@1.56.1 && npx playwright install chromium`. The header goes only to `careermetro-*.vercel.app` hosts.

The same workflow then runs `scripts/smoke/staging-screens.mjs`, even when the dry run failed: two fresh test users in two browsers walk the screens the dry run doesn't reach. Network: B turns on Let people find me, A finds B by name and sends a request, B accepts from Requests, and no Network row on either side shows a city (each user picks one in Settings first). The bell: B's lists A's request and opens Requests; A's lists B's accept. The resume builder through Review and Download (a PDF). Library: Save and "I finished this". A mock interview: Elite on (free in the beta), a Quick round started and ended at once. Departures: save a role and mark it applied, or `skipped: no posts` when staging's board is empty. Both accounts are deleted at the end, even after a failure. Its AI calls are the builder's review (one build-resume call) and, with the admin account below, A's Gaps page (one explain-gaps call); the mock round ends unanswered, so it asks for no feedback. No city may appear in the page data either (Sent, the profile and the bell included). Then Arrivals (empty) and the admin pages' 404 for a member. With `SMOKE_ADMIN_EMAIL` (the admin test account; the workflow sets `admin@careermetro.test`, a fake address Preview treats as an admin while its ADMIN_EMAILS is unset) the company side runs too, on a `careermetro-*.vercel.app` preview only (the script never types it into production, `careermetro.vercel.app`, or any other host): B sets up a company with the test-mode code, the admin verifies it, B posts a job, A sends it with Express apply, B moves A to Offer and A sees it under Offers; a job report and a Library link report are acknowledged or dismissed on `/admin/reports` and `/admin/library`. Without it those steps print `skipped: ...`. The clean-up withdraws the application, closes the job, dismisses open reports and deletes both accounts, after a failure too, or at the script's own deadline (`SMOKE_DEADLINE_MIN`, 18 minutes, leaving the step in flight and the clean-up 7 minutes before the 25-minute step limit), in under 4 minutes (each part tried once, 40 seconds at most); a cancel starts it but GitHub allows only about 10 seconds, so a cancelled run may leave its accounts; the company can't be deleted in the app, so each run leaves one closed-job company on Company review as "No admin". By hand: `BASE=<url> BYPASS=$BYPASS [SMOKE_ADMIN_EMAIL=...] node scripts/smoke/staging-screens.mjs`.

---

## 2. Sign in by email code (3 minutes)

Use an inbox you can open now, never a real candidate's. Name the account **Priya Sharma**: the test resume in step 3 has that name, and a signed-in upload under another name is refused on purpose (the resume name check).

**On staging** there are no emailed codes: `/sign-in` shows "Preview only" and **Continue as test user** (Name and Email, nothing checked; docs/staging.md). 2.2 and 2.3 and the code in 2.4 can't run there, and are checked only on production. The test user covers the rest: a new address still goes to "Create your account" (2.4) and the name step (2.5), and a returning one straight to Today (6.3). Use a new email each run: anyone who types the same one sees that account.

| # | Do this | You should see | If not, look at |
|---|---|---|---|
| 2.1 | Open `https://careermetro.vercel.app/sign-in` | "Sign in", an Email field and **Email me a code**. "Continue with Google" shows only if `GOOGLE_SIGNIN=1` | 404: `TODAY_PREVIEW=1` is missing. "Sign-in isn't switched on yet.": the two `NEXT_PUBLIC_SUPABASE_*` settings are missing, or were added without a redeploy |
| 2.2 | Type the email and press **Email me a code** | "We sent a code to <email>. It works for 1 hour." and a Code field | "We couldn't send a code just now": Supabase refused it (Vercel log `auth_email_code_send_refused` gives its code; Supabase auth logs: rate limit, SMTP error). "Too many tries": the app's limit (5 codes an hour for one email, 20 an hour from one network) |
| 2.3 | Open the inbox | Within a minute, from CareerMetro `no-reply@careermetro.com`, an email with a 6-digit code | Nothing after 2 minutes: check spam, then Supabase auth logs and Resend > Emails. A link but no code: the template lacks `{{ .Token }}`. Sender `noreply@mail.app.supabase.io`: Supabase SMTP isn't pointed at Resend yet |
| 2.4 | Type the code and press **Sign in** | A new address goes to "Create your account" ("Signed in as <email>. One last step."). A returning one goes straight to Today | "That code didn't work": an older code was used, or it expired. Press **Send a new code** and use only the newest email |
| 2.5 | First name **Priya**, Last name **Sharma**, tick "I am 18 or older and agree to the terms and privacy policy.", press **Create my account** | Today in the No resume state: the role chips and the "Drop your resume here" box | Vercel logs for an error at that minute. The `users` table should have one new row |

## 3. Upload the synthetic resume (2 minutes)

The file is `fixtures/resumes/priya-sharma.pdf` in the repo (an invented person; a `.docx` copy sits next to it, and the `.txt` copy is for **Paste text**, since a file upload takes PDF or DOCX only). Download it from GitHub first. Never use a real resume for a smoke check.

| # | Do this | You should see | If not, look at |
|---|---|---|---|
| 3.1 | On Today (or `/start`), choose the file, tick the consent box ("I agree that CareerMetro reads my resume…") and press **Read my resume** | The reading steps, then within about 30 seconds the review page `/resume/<id>` with her roles and skills | "Our resume reader is unavailable": the Claude key, credit or the parse budget (health `claude`, Vercel `ai_call_failed`). "This resume shows a different name": the account isn't named Priya Sharma. Any other error: Vercel `resume_upload_failed` |
| 3.2 | Press **Looks right**, then **Pick a role** in the "Saved" box | "Closest to your resume" with 1 to 3 roles, each saying "Your resume shows N of its N key skills, like …" | Vercel `profile_save_failed` |

## 4. Gaps and Path (3 minutes)

| # | Do this | You should see | If not, look at |
|---|---|---|---|
| 4.1 | Pick **Data Analyst** | `/resume/<id>/gaps/data-analyst`: the gaps with a status and an explanation each, and "Build my path" | Explanations in plain template wording are fine (budget or Claude down) but say so in the report. Errors: Vercel logs; the `gap_analyses` table should have a new row |
| 4.2 | Press **Build my path** | "Your path": sized steps with free resources and hours, "Works toward: <skill> (<status>)", and "0 of N steps done" | Vercel logs; template wording is the fallback when Claude is down |
| 4.3 | Press **Mark done** on the first step | "1 of N steps done" | The step stays undone after a reload: Vercel logs at that minute |

## 5. Today: the ride and goals (2 minutes)

| # | Do this | You should see | If not, look at |
|---|---|---|---|
| 5.1 | Open `/today` | "Your goals" with this resume's own goals (never the example "SQL window functions"). On the first day the ride is in the "Welcome aboard, Priya." card, under "Your first ride"; from the first tick it is "Today's ride" | Example data instead: the goals sync failed (Vercel `goals_sync_failed`), or the resume isn't on this account |
| 5.2 | In the Welcome card's "Set up in three taps", under "Hours a week", press **8 h**, then reload | 8 h stays pressed | Vercel logs |
| 5.3 | Tick the first ride task, then untick it | Ticked: the streak chip in the top bar shows 1 ("1-day streak" on screens 400px or wider) and "Today's ride" takes the Welcome card's place. Unticked: the Welcome card is back and the chip is gone | Vercel logs |
| 5.4 | Open `/map` | The line with the same goals as stops | Vercel logs |

## 6. Settings: download, then sign out (2 minutes)

| # | Do this | You should see | If not, look at |
|---|---|---|---|
| 6.1 | Open `/settings` > Your data > **Download your data** > Download | A file `careermetro-data-<date>.json` (the date is UTC, so before 05:30 IST it is yesterday's) with the account, the resume profile, the gap result, the path and the goals (no resume file: it's never kept) | 401: the session dropped, so sign in again. 500: Vercel logs for `/api/account/export` |
| 6.2 | Open the avatar menu (your initials, top right) > **Sign out** | The home page, signed out. Opening `/today` now goes to `/sign-in` | Still signed in: Vercel logs for `/auth/sign-out` (403 means the form came from another origin) |
| 6.3 | Sign in again with the same email (steps 2.1 to 2.4) | Straight to Today with the same goals, with no name step | A name step again: the `users` row lost its name, so tell Development |

## 7. Admin and clean-up (Milin, 2 minutes)

| # | Do this | You should see | If not, look at |
|---|---|---|---|
| 7.1 | Signed in as an `ADMIN_EMAILS` address, open `/admin/reports` | The report queue | 404: `ADMIN_EMAILS` is missing, or the address differs |
| 7.2 | Signed in as the test account, open `/admin/reports` | 404 | Tell Development at once |
| 7.3 | Vercel > Cron Jobs > `/api/cron/cleanup` > Run | 200 in the log | 401: `CRON_SECRET`. Look for `cleanup_job_failed` |

## 8. Finish

- Delete the test account: `/settings` > Your data > Delete account > **Delete**, type DELETE in "Type DELETE to confirm", press **Delete my account**. You land on `/account/deleted`, signed out. It is gone for good after the 30-day restore window; signing in with that email before then offers **Restore my account**, so use a new email for the next smoke check.
- Post one line in the Development thread, for example "smoke 2026-10-2x: all green", or the step numbers that failed with the time. Never paste a code, an email or a key.
- If 1.1, 2.x or 3.1 fails and can't be fixed in a few minutes, follow the rollback in `docs/dev/launch-day.md`: remove `TODAY_PREVIEW` and redeploy, or promote the last good deploy.
