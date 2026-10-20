# CareerMetro keys register

**Names and places only. This file never holds a key value.**

Keep the values in a password manager, for example 1Password, Bitwarden or Apple Passwords. Make one vault called "CareerMetro". For each item, save the value under the same name used in this file, and add the date you set it.

Last checked against the code: 2026-10-19 (main, after PR 160). The full comments for every setting are in `.env.example`, and the key rules are in `src/lib/hash-keys.ts`. The master copy is this file, `docs/secrets.md`; the copy in the project files follows it.

## 1. Settings in the app's hosting (today: Vercel > Project > Settings > Environment Variables)

Set each one for both **Production** and **Preview**, unless the table says otherwise. A change only takes effect after a **redeploy**. `/api/health` names (never shows) any of CRON_SECRET, NAME_HASH_KEY and IP_HASH_KEY that production is missing.

| Name | What it does | Where the value comes from | Can it be changed later? |
|---|---|---|---|
| DATABASE_URL | The app's link to the database (Supabase transaction pooler, port 6543) | Supabase > Project > Connect | Yes. Reset the database password in Supabase, then paste the new link here. |
| ANTHROPIC_API_KEY | The AI calls: resume reading, explanations, practice feedback | console.anthropic.com > API keys | Yes. Make a new key, paste it, redeploy, then delete the old key. |
| CRON_SECRET | Protects the daily cleanup job and the parse health check. Until NAME_HASH_KEY and IP_HASH_KEY are set, it is also the key for those hashes. | You generate it: `openssl rand -base64 32` | **Best not.** Resume names read before NAME_HASH_KEY was set are still checked with the CRON_SECRET of that time, so a new value makes their name check fail. If you must, set NAME_HASH_KEY and IP_HASH_KEY first, then also update the same name in GitHub (section 3). |
| NAME_HASH_KEY | Hides resume names, certificate ids and pasted job postings, and keys work-email codes and invites. It also stands in for PHONE_KEY and FIND_REF_KEY when those are unset. Work-email checks, phone sharing and Find people stay off in production without it. | You generate it | **No. Set it once and never change it.** Changing it breaks stored hashes, pending codes and invites, and (without PHONE_KEY) stored phone numbers. |
| IP_HASH_KEY | Hides IP addresses and emails in the rate limits | You generate it | Yes. Changing it only resets the counters. |
| PHONE_KEY | Encrypts phone numbers that candidates share for interviews. Optional: without it, NAME_HASH_KEY is used. | You generate it | **No, once numbers are stored.** Old numbers could not be read. Adding it later has the same effect on numbers stored under NAME_HASH_KEY, so set it before phone sharing opens, or never. |
| FIND_REF_KEY | Makes the anonymous ids companies see in Find people. Optional: without it, NAME_HASH_KEY is used. | You generate it | Yes. Changing it only changes those ids, which last one page. |
| ADMIN_EMAILS | Who can open the admin pages (companies, proofs, reports) | Your sign-in email(s), comma-separated | Yes, any time. |
| NEXT_PUBLIC_SUPABASE_URL | Real sign-in | Supabase > Project Settings > API | Only if you move to a new Supabase project. |
| NEXT_PUBLIC_SUPABASE_ANON_KEY | Real sign-in. Public by design: use the anon or publishable key, **never** the service_role key. | Supabase > Project Settings > API | Yes. Supabase can roll it. |
| GOOGLE_SIGNIN | `1` shows "Continue with Google" on the sign-in page. Without it, sign-in is by emailed code only. Not a secret. | Just the value `1`, once Google is set up in Supabase (section 2) | Yes, any time. Removing it hides the button. |
| TODAY_PREVIEW | `1` opens the signed-in app and the privacy and terms pages in production (they are always open on previews) | Just the value `1` | Yes. Removing it closes the app again. |
| RESEND_API_KEY | Sends the app's own emails: company sign-up, join and re-check codes, and the current-job check | resend.com > API keys | Yes. Make a new key, paste it, then delete the old one. |
| EMAIL_FROM | The sender, e.g. `CareerMetro <no-reply@careermetro.com>` | Your verified domain in Resend | Yes. |
| PARSE_DAILY_BUDGET_USD, EXPLAIN_DAILY_BUDGET_USD, WRITE_PATH_DAILY_BUDGET_USD, PRACTICE_DAILY_BUDGET_USD, JOB_CHECK_DAILY_BUDGET_USD, MOCK_DAILY_BUDGET_USD | Optional daily AI spend caps in US dollars, per feature: resume reading (default 5), gap explanations, path writing, practice feedback and pasted-job checks (default 2 each), and mock interview feedback (default 3) | Your choice | Yes, any time. |

## 2. Secrets kept inside other services (not in Vercel)

| Where | What | Can it be changed later? |
|---|---|---|
| Google Cloud > APIs & Services > Credentials | OAuth Client ID and Client secret for "Sign in with Google" | Yes. Make a new secret and paste it into Supabase. |
| Supabase > Authentication > Providers > Google | The same Client ID and secret | Change it together with Google. |
| Supabase > Authentication > URL Configuration | Site URL and redirect URLs (careermetro.vercel.app today) | **Must change if the address changes** (section 4). |
| Supabase > Authentication > Emails (SMTP, later) | Resend details for sign-in emails | Yes. |
| Vercel > Settings > Deployment Protection | Protection Bypass secret for the staging tester link | Yes. Testers then need the new link. |

## 3. GitHub repository secrets (GitHub > repo > Settings > Secrets and variables > Actions)

| Name | What it does |
|---|---|
| DATABASE_MIGRATION_URL | Applies database changes on each merge, and lets the monthly openings feed and link check write to the database (Supabase session pooler, port 5432) |
| CRON_SECRET | Lets the 6-hourly smoke check run the parse check. Must match Vercel. |
| VERCEL_AUTOMATION_BYPASS_SECRET | Lets the smoke check through Vercel Deployment Protection. Must match the Vercel bypass secret. |
| ANTHROPIC_API_KEY | Only for the paid AI evals. Can be a separate, low-limit key. |
| SMOKE_ADMIN_EMAIL | Optional. The admin test account the staging screens run (`.github/workflows/smoke-staging.yml`) signs in as for the company side and the admin pages. A test-user address ending in `.test` that Preview's ADMIN_EMAILS lists, or `admin@careermetro.test` while Preview has no ADMIN_EMAILS. Kept secret, because anyone with the staging link can sign in as it. Without it those steps are skipped. |

One repository **variable** (same page, Variables tab), not a secret: PRODUCTION_URL, the address the smoke check opens. It defaults to https://careermetro.vercel.app.

## 4. If you move away from Vercel

Yes, the app can move. It is a standard Next.js app, and the database stays on Supabase. On the new host:

1. Copy every setting from section 1 with the **same names and values**. The values sit in your password manager. Never invent new NAME_HASH_KEY or PHONE_KEY values.
2. Recreate the daily cleanup job. Vercel runs it from `vercel.json` at 21:30 UTC (03:00 in India). On the new host, schedule a daily call to `/api/cron/cleanup` with the header `Authorization: Bearer <CRON_SECRET>`.
3. Tell the app it is production. The code reads Vercel's own `VERCEL_ENV` setting to know it is the live site, so the new host must set `VERCEL_ENV=production` and `VERCEL_PROJECT_PRODUCTION_URL=<the domain, without https://>`. Without the first, the app treats itself as a preview: the signed-in app opens to everyone and the production key checks are skipped. This is a must before the new address goes live.
4. Pick a server region in India (Mumbai) so the app stays close to the database.
5. Update the address everywhere it appears: Supabase URL Configuration, Google's authorised redirect, Resend's domain (only if it changes), and the PRODUCTION_URL variable in GitHub.
6. Three Vercel-only extras have to be replaced: the staging site (built from the `staging` branch, `docs/staging.md`), the staging bypass link, and the build skip for docs-only changes (`scripts/vercel-ignore.sh`). Development will adjust these during a move.

Development will do steps 2 to 6 when you decide to move. Your only part is step 1, copying the values from your password manager.

## 5. Safe rules

- Never paste a key into chat, email, a document or the repo. Values go only into the services named above and your password manager.
- To change a key, make the new one first, paste it in, redeploy, check the app, and only then delete the old one.
- After any change, say "redeployed" to the Project manager. Development then checks the site health.
