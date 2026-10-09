# CareerMetro platform plan: accounts, profile, library, resume builder, network

Date: 2026-10-08. Covers Milin's request to make CareerMetro a one-stop career app: login and user portal, profile with an Elite tick, library, free resume builder, and a social network. Plan for approval (CLAUDE.md: auth and data model changes need approval).

## Order of work
1. **Finish Path** (in progress, approved).
2. **Accounts and login.** Everything else (saving items, a profile, drafts, connections) needs an account to last beyond 24 hours.
3. **Profile page** with the Elite badge.
4. **Library.**
5. **Free resume builder.**
6. **Practice and Match**, which finish the basic flow.
7. **Network and community**, last: it costs the most and brings legal duties (below).

## 1. Accounts and login
- **What users see:** "Continue with Google" or "Email me a code" (a 6-digit code, which works better than magic links in Indian phone mail apps). The analysis they just ran is still there after signing in. A Settings page has "Download my data" and "Delete my account".
- **How:** Supabase Auth, in the Supabase project we already run in Mumbai. No new vendor, and data stays in India. Phone OTP waits, because SMS in India needs TRAI DLT registration.
- **Privacy (DPDP):** deletion within 24 hours by a daily job; export as a JSON file; users confirm they are 18 or older.
- **Data model:** `users` gets a link to the login record and an age-confirmed date. Resumes from the anonymous session move to the account on first sign-in.
- **PRs:** sign-in and session helpers; carry over the anonymous session; ownership checks by user or session; settings and export; deletion job.

## 2. Profile page
- **What users see:** `/me` shows their job profile (roles, skills, education, certifications). They can edit it, and each save keeps a version. Every field can be Private (the default), Connections or Public. An optional public page at `/u/<handle>` shows only public fields. Phone, email, salary and notice period are never public.
- **The tick:**
  - An **Elite** badge for paid subscribers. For now it is granted by hand, for example to beta testers, with no payments.
  - A **Verified** badge only once something is actually checked (DigiLocker, FR-32).
  - The two are separate on purpose. A paid tick labelled "verified" when nothing was checked misleads recruiters and risks India's 2023 dark-patterns rules.
- **Data model:** `public_profiles` (handle, headline, field visibility); `entitlements` (user, kind 'elite', source manual/beta/payment, dates, who granted it).

## 3. Library
- **What users see:** `/library` lets anyone search the catalog by skill, role, type (video, course, docs) and time needed. Signed-in users see "For your gaps" first and can save items to My library. Videos open on YouTube or in a privacy-mode embed. We link out and never host content.
- **Data model:** `saved_resources` (user, resource). Simple text search is enough for a few hundred items.

## 4. Free resume builder (free for everyone)
- **What users see:** they start from their profile, a few pointers or a prompt, or a pasted job description. They get a draft in a clean template that passes applicant tracking systems (ATS), then export it as PDF or Word.
- **Line sources:** every line shows where it came from: "from your resume", "you told us", or "suggestion: confirm". Suggestions stay out of the export until the user ticks them.
- **No fabrication:** the model may only rephrase facts the user gave. A check drops any employer, title, date, number or certification that isn't in the inputs. Job description text is treated as data, not instructions.
- **Cost control:** sign-in required, 5 drafts per user per day, and re-styling doesn't call the model. Every call is logged with its prompt version, and phone and email are masked before the call.
- **Data model:** `resume_drafts` (source profile, optional job description or role, template, content with a source tag per line, AI call).

## 5. Network and community (small first version)
- **First version:**
  - follow (one-way) and connect (two-way, accepted);
  - search people by name or handle;
  - "people aiming for your role" suggestions;
  - block and report on every profile.
  - Privacy defaults: hidden from search and private until the user opts in.
- **Later:** feed and posts, direct messages, groups or teams, and "who viewed you" reach stats.
- **Why the feed waits:** once users post content, we become an "intermediary" under India's IT Rules 2021. That needs a named grievance officer, complaint handling within 24–72 hours, and someone moderating.
- **Data model:** `follows`, `connections`, `blocks`, `reports` (and later `groups`, `posts`).

## Decisions needed from Milin
1. Sign-in: Google plus an email code through Supabase (recommended)?
2. Is the app 18+ only (recommended for now, to avoid parental-consent duties)?
3. Badge names: "Elite" for paid and "Verified" only after document checks (recommended)?
4. Resume builder: sign-in required, 5 drafts a day?
5. Network v1 without a feed or posts (recommended)? And who will handle reports and act as grievance officer once posts arrive?
6. "Teams" in the network: groups users create, or company teams (that is the B2B phase)?
