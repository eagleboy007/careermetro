# Launch day: checklist and rollback

Written by Development, 2026-10-15 (launch-readiness (c) 5). Use this on the day the web app opens to real users. Milin does the steps marked **Milin**, because they need his accounts. Development watches and fixes.

## Before the day
- Every item in launch-readiness (b) is done or consciously skipped. That covers the sign-in keys, the email sender, the hash keys, `ADMIN_EMAILS`, the domain, the named grievance officer, and the privacy notice and terms approved by the legal adviser.
- Vercel Pro and Supabase Pro are on. A Supabase backup exists from the day before.
- The last production deploy is green on CI, e2e and the smoke check.

## Order of keys (Milin, in Vercel, then one redeploy)
1. `CRON_SECRET`, `NAME_HASH_KEY`, `IP_HASH_KEY`, `FIND_REF_KEY`, `PHONE_KEY` (`dev/hash-keys-steps.md`). Never change `NAME_HASH_KEY` or `PHONE_KEY` afterwards.
2. The sign-in keys (`docs/plans/signin-setup-steps.md`). This also turns the stand-in test sign-in off.
3. The email sender (`dev/email-sender-steps.md`).
4. `ADMIN_EMAILS` for Production and Preview.
5. Last: `TODAY_PREVIEW=1` for Production. This opens Today, Map, Inbox, Corporate, Settings, `/admin`, `/privacy`, `/terms` and `/grievances`.
6. Redeploy once (Deployments, the ⋯ on the top deploy, Redeploy).

## Checks right after the redeploy (Development, within 15 minutes)
- The smoke check on GitHub Actions is green. `/api/health` answers 200 and reaches the database and Claude.
- Sign in with a new Google account and with an email code. Upload the synthetic resume from `/fixtures`, see Gaps, set a goal, open Inbox, then delete the test account.
- Open `/admin/companies`, `/admin/proofs` and `/admin/reports` as the admin, and check that a non-admin gets 404.
- In Vercel Cron Jobs, run `/api/cron/cleanup` once. The log shows 200.

## Rollback
- **App broken:** in Vercel, open Deployments, click the ⋯ on the last good deploy, then **Promote to Production** (Redeploy previous). This takes about a minute and changes no data.
- **A key is wrong:** fix it in Vercel and redeploy. Remove `TODAY_PREVIEW` to close the signed-in screens again while you fix it.
- **Data problem:** stop writes by removing `TODAY_PREVIEW`, then restore the Supabase backup only with Milin's word, because a restore loses everything since the backup.
- Never rotate `NAME_HASH_KEY` or `PHONE_KEY` as a fix.

## First 24 hours
- Development checks the Vercel logs for `error` lines and `cleanup_job_failed` at about +1h, +4h, +12h and +24h, and fixes anything new in one PR.
- The admin checks `/admin/reports` twice a day, because acknowledgements are due within 24 hours.
- Watch the Anthropic spend against the monthly limit, and the Vercel and Supabase usage pages.
