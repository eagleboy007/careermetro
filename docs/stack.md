# CareerMetro technology register

Every outside service and tool CareerMetro uses, what plan it's on, what would hurt as we grow, and how to upgrade or switch. Written 25 Oct 2026 by the Project manager; services, AI caps, schedules and job-feed providers checked against the code on `main` by Development (after PR 218). The master copy is this file, `docs/stack.md`; the copy in the project files (`careermetro/dev/tech-stack-register.md`) follows it.

Plan limits and prices change often. Figures marked "approx." are from memory, not from today's pricing pages, so check the provider's pricing page before paying for anything. Keys are not in this file; where each key lives is in [secrets.md](secrets.md).

## Fix before real users (most important first)

These are the free or public settings most likely to hurt us. Each one is a money or account call, so it's yours.

| # | What | Why it matters | What to do | Cost (approx.) |
|---|---|---|---|---|
| 1 | **Supabase on the free plan** | The free plan has **no automatic backups**: if data is lost, it stays lost. It also pauses a project after about a week with no activity. | Move the production project to **Pro** before real users sign up. Consider the point-in-time recovery add-on once paying users exist. | US$25/month |
| 2 | **Vercel on the Hobby plan** | Hobby is for **personal, non-commercial use** under Vercel's terms, so a company product should not run on it. It also caps deploys (we hit 100 a day on 20 Oct), keeps logs only briefly, and has no log drain, so no alerts. | Move to **Pro** before launch or before any money changes hands. | US$20/month per member |
| 3 | **GitHub repository is public** | Anyone can read the whole codebase, prompts, role profiles and question banks, and copy them. No keys are in it, but the work is. | Make the repo **private** (Settings > General > Danger Zone > Change visibility). The free plan includes 2,000 Actions minutes a month for private repos (approx.); we may need GitHub Team if CI uses more. | Free, or US$4/user/month for Team |
| 4 | **Domain at GoDaddy** | If the domain lapses or the account is taken over, the site and all email stop. | Turn on **auto-renew**, **domain lock** and **two-step sign-in** on the GoDaddy account. Consider renewing for several years. | About ₹1,000/year |
| 5 | **Supabase built-in email sender** | It sends only a few emails an hour and no longer lets us change the email text. | Being replaced by Resend (set up 25 Oct 2026, below). | Free |

## Services in use

### Vercel: hosting the website and app
- **Used for:** running the app in Mumbai (`bom1`), the staging site (the `staging` branch's preview build; other branches get no preview), the daily 03:00 IST cleanup job (`vercel.json`, `/api/cron/cleanup`), and the weekly My jobs email at 08:00 IST Monday to Wednesday (`/api/cron/weekly-email`; once a day at most, as Hobby allows).
- **Plan now:** Hobby (free).
- **What bites:** commercial use isn't allowed on Hobby, there are 100 deploys a day, logs are kept only briefly, and there's no log drain or alerts. Function time and bandwidth limits apply as traffic grows.
- **Upgrade:** Pro (approx. US$20/month per member). This adds commercial use, higher limits, log drains and longer logs.
- **Switch later?** Yes. It's a standard Next.js app. Steps are in `docs/secrets.md` section 4 (copy the same settings, recreate the daily job, set the production flags). Alternatives: AWS Amplify, Netlify, Render or Railway, or a Mumbai server of our own.

### Supabase: database and sign-in
- **Used for:** the Postgres database (Mumbai, `ap-south-1`) with row-level security on every table, and email-code sign-in. Google sign-in comes later.
- **Plan now:** Free.
- **What bites:** no backups, pausing when idle, about 500 MB of database storage (approx.), monthly user and bandwidth caps, and the email sender is limited.
- **Upgrade:** Pro (approx. US$25/month) for daily backups, no pausing and larger limits. Later: point-in-time recovery, a bigger compute size, and read replicas.
- **Switch later?** Yes, with planning. The database is plain Postgres with standard migrations (`drizzle/`), so it can move to AWS RDS, Google Cloud SQL, Neon or a self-run Postgres. Sign-in is the harder part: moving off Supabase Auth means a new sign-in provider and a one-time move of user accounts. Development would plan this as its own project.

### Resend: sending emails
- **Used for:** sign-in codes (through Supabase's SMTP settings), and the app's own emails sent straight to Resend's API (`src/lib/email/send.ts`): company sign-up, join and re-check codes, the current-job work-email check, and the weekly My jobs email (opt-in, from hello@ on the same domain, Monday to Wednesday at 08:00 IST, at most 80 a run; C22, 29 Oct 2026).
- **Plan now:** free plan, set up 25 Oct 2026.
- **What bites:** 3,000 emails a month and 100 a day (approx.). On a busy launch day, 100 a day can run out. The weekly My jobs email shares these limits: once about 200 people have it on, it needs Pro (Milin's call).
- **Upgrade:** Pro (approx. US$20/month for 50,000 a month). Upgrade before any public launch push.
- **Switch later?** Yes. For sign-in codes it's only new SMTP settings in Supabase. The app's own emails call Resend directly, so moving those means a small code change. Alternatives: Amazon SES (cheapest at volume), Brevo, Postmark.

### Anthropic (Claude API): the AI features
- **Used for:** reading resumes, gap explanations, path writing, practice and mock interview feedback, pasted job checks, and the resume builder. Every call is logged with its prompt version, and resume text is never logged.
- **Plan now:** pay as you go, with our own daily spend caps per feature (`PARSE_DAILY_BUDGET_USD` and the others). Defaults in the code, per UTC day across everyone: resume reading US$5 (`PARSE_DAILY_BUDGET_USD`; the resume builder's rewording shares it), gap explanations US$2 (`EXPLAIN_DAILY_BUDGET_USD`), path writing US$2 (`WRITE_PATH_DAILY_BUDGET_USD`), practice feedback US$2 (`PRACTICE_DAILY_BUDGET_USD`), pasted job checks US$2 (`JOB_CHECK_DAILY_BUDGET_USD`) and mock interview feedback US$3 (`MOCK_DAILY_BUDGET_USD`).
- **What bites:** the daily caps stop features once reached, so raise them before launch traffic. Rate limits rise with account spend tier, and costs grow per user.
- **Upgrade:** raise the caps, add a monthly spend limit in the Anthropic console, and apply for startup credits.
- **Switch later?** Partly. Gap matching is our own code, and the AI only reads resumes and writes text. Prompts live in `prompts/`, so another model could be used, but output quality would need re-testing with the evals (`npm run eval:*`).

### GitHub: code and automatic checks
- **Used for:** the code, pull requests, checks on every change, database changes on merge, the daily job feed (06:30 IST), a production health check after each deploy and every 6 hours, the daily link check (07:00 IST), the monthly job-description mining run, and the staging walk-through (run by hand).
- **Plan now:** Free, public repository.
- **What bites:** the code is public, and Actions minutes become limited once the repo is private.
- **Upgrade:** make the repo private; GitHub Team if minutes run out.
- **Switch later?** Yes (GitLab, Bitbucket), but the checks in `.github/workflows/` would need rewriting.

### GoDaddy: the careermetro.com domain
- **Used for:** the domain. It isn't pointed at the site yet; the site runs on careermetro.vercel.app. Since 25 Oct 2026 it also holds Resend's email records.
- **What bites:** losing the domain, or a hijacked account.
- **To do:** auto-renew, domain lock and two-step sign-in. When we point the domain at the site, update the Supabase Site URL and redirects.
- **Switch later?** Yes. Domains can be moved to Cloudflare or another registrar at any time.

### Public job-board feeds: jobs on Departures and the Market
- **Used for:** open roles from companies' public job boards on Greenhouse, Lever, Ashby and SmartRecruiters, read daily (06:30 IST) from a reviewed list (`src/content/job-boards.json`). We never scrape LinkedIn or Naukri.
- **Plan now:** free public feeds with no contract.
- **What bites:** no service guarantee. A provider can change or close its feed or terms without notice. Before we charge money, someone should read each provider's terms for commercial use.
- **Upgrade:** a licensed job data source (a paid API), or employers posting directly on CareerMetro (already built).

### Google Cloud: Google sign-in (on hold)
- **Used for:** "Continue with Google", not switched on.
- **Status:** on hold (Milin, 25 Oct). It needs a separate CareerMetro Google account, which needs a separate mobile number.
- **Switch later?** Yes, any time. The button stays hidden until `GOOGLE_SIGNIN=1`.

## Free software inside the app (no account, no bill)
Next.js, React, Drizzle, postgres.js, Zod, lucide-react icons, pdf-lib (with @pdf-lib/fontkit), unpdf, mammoth, docx, and the Supabase and Anthropic code libraries. All are open source under permissive licences (MIT, ISC, BSD or Apache) that allow commercial use. Fonts (Bricolage Grotesque, Geist and Geist Mono) are open-licence; `next/font` downloads them at build time and serves them from our own site, so visitors' browsers never call Google. CI runs `npm audit` (high and above) on every change to flag known security problems in these libraries.

## Learning resources we link to
YouTube, NPTEL, SWAYAM, freeCodeCamp, Kaggle Learn, Microsoft Learn and official docs. We link only, host nothing and use no affiliate links. A daily check finds broken links. Paid Elite content needs licences before it goes live.

## When to revisit
- **Before public launch:** items 1 to 4 in the "Fix before real users" table, Resend Pro, and raising the AI caps.
- **At about 1,000 active users:** Supabase compute size, Vercel usage, and the AI cost per user.
- **Before taking money:** the terms of each job-feed provider, a licensed job data source, and a lawyer's review of the privacy notice.
- **Every quarter:** re-check this page against the bills and the pricing pages.
