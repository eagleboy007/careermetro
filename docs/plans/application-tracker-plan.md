# My jobs: plan (bring any job to CareerMetro)

Development 4, 2026-10-28. Source: Milin's idea of 28 Oct ("only then users will onboard"), as written up in the PM's proposal `dev/my-jobs-proposal.md`. It changes the data model, so **nothing is built and no schema changes until Milin approves**. Milin decided on 28 Oct (20:29 UTC card) to **keep the pasted description**: private, at most 20,000 characters, in the export, deleted with the account, never logged.

**The rule this keeps:** CareerMetro never copies jobs from portals, by script or by hand. The person brings a job they chose, for their own use. We fetch nothing on the server except a single posting from the four public company-board APIs we already read (Greenhouse, Lever, Ashby, SmartRecruiters).

## What is already built

| Piece | Today | Gap for My jobs |
|---|---|---|
| `job_checks` | Paste a posting. The model reads company, title and skills, and code matches them to the resume. Only a hash of the text is kept. | Belongs to a **resume** (cascade), so replacing the resume deletes it. Has no link. |
| `job_saves` | Saved and Applied on Departures, with stages 1 to 4. Key is (user, feed post). | Feed posts only. No end states, interview date or note. |
| Mock and practice | Picks by skill and asks the role's required skills first. Takes a list of skills to ask about first. | No "for this job" entry. |
| Anonymous first check (FR-2) | An anonymous resume and its checks move to the account at sign-in (`claimAnonymousResumes`). | Nothing turns that check into a saved job. |

## Phase 1

### 1. Add a job you found

- **Where it starts:** "Add a job you found" on Departures, replacing "Saw a role somewhere else?" and growing out of it. The box takes the description and an optional link. The model fills company and title, and the person checks them, as job checks do today.
- **Links from company boards:**
  - **Which links:** a link on `boards.greenhouse.io`/`job-boards.greenhouse.io`, `jobs.lever.co`, `jobs.ashbyhq.com` or `jobs.smartrecruiters.com` is read through that board's public posting API. Then nothing needs pasting.
    - Hosts are matched exactly, https only.
    - The board token and posting id come from the URL path.
    - One request per link, with no redirects followed.
    - It has a 15 s timeout and a 1 MB cap, and sends the feed's User-Agent and SmartRecruiters spacing.
  - **Already in our feed:** if that posting is already in `job_posts`, the job is saved as the feed post. It gets no second copy.
  - **Text that goes to the model:** the posting's description, with HTML stripped, goes to the same parse prompt as pasted text.
  - **Any other link:** it is only stored and shown, never fetched. The box says "Paste the description too: we only read links from company job boards."
- **Limits:** the existing limits stay (5 new checks a day, the daily budget). Reading a board link counts as a check.

### 2. My jobs

- **Departures tabs:** the Saved and Applied tabs become **My jobs**. It holds feed jobs and added jobs in one list, newest change first. It has a filter (All, Saved, Applied, Interview, Closed) and a "where it came from" label: "You added" or "Company job board".
- **What each row shows:**
  - company, title, city when known, and "Open the original" when there is a link;
  - its status and dates;
  - the fit from the job check ("You have / Still open / Only for this job"). For added jobs, the fit is recomputed against the current resume in code, so it stays right after a new upload and needs no model call.
- **Status:** Saved, then Applied, Heard back, Interview, Offer, **Not this time** and **Withdrawn**.
  - Dates are set when the status moves. Applied on and closed on are editable.
  - Nothing moves a status on its own.
- **Interview date:** optional, date and time in IST. Setting it moves the status to Interview if it was earlier. "Add to calendar" uses the existing `.ics` builder (title and company only, 19:00 IST alarm the evening before).
- **Private note:** up to 2,000 characters, with the hint "For you only. Don't add other people's phone numbers or emails."
- **Gaps stay where they belong** (Milin's 12 Oct rule): a job's extras never become main goals unless the person adds them as goals tied to that job. That path already exists (`user_goals.job_check_id`).

### 3. Prepare for this job

- **Where:** a button on each row, also shown after "Add a job you found".
- **Practice:** this job's skills, still-open goals first, then "Only for this job" extras. The free and Elite rules are the same as today.
- **Mock interview for this job:**
  - `/mock` gets a new focus, `job`, titled "{title} at {company}".
  - Questions are picked by skill id from the whole bank, not only the target role's: required skills first, then nice-to-have, then the role's own.
  - "About you" questions still come from the target role.
  - Skills with no bank questions are listed as "No practice questions for these yet".
- **The model's job is unchanged:** it reads skills from the description and gives feedback on answers. It never writes or rewrites the job. No new prompt, so `ai_calls` logs the existing prompt versions.
- **The kept description:** "Read the job again" shows the person's own copy, and a future prompt version can re-read skills from it without asking them to paste again.

### 4. First check before sign-up

- **Landing and Gaps:** both offer "Paste the job you're applying for and see what it asks that you don't have". This is the existing anonymous resume plus a job check, under FR-2's one analysis before sign-up.
- **After the result:** "Sign up to keep it in My jobs and prepare for the interview."
- **At sign-in:** the claim moves the resume and its checks, as now. The newest claimed check becomes a My jobs row with status Saved, so it is waiting there.
- **Unclaimed:** a check that is never claimed is deleted with its anonymous resume after 24 hours, together with its description.
- **Empty My jobs** says "Add the jobs you're already applying to" above the feed.

## Data (one migration, 0050)

- **`job_checks`:**
  - **New columns:**
    - `user_id`: set at claim or for signed-in checks, cascade.
    - `url`: https, at most 2,000 characters, shown and never fetched unless it is a board link.
    - `source`: `pasted` or `board`.
    - `city`: from the board posting when known.
  - **`resume_id`** becomes nullable, with `on delete set null`, so a saved job outlives a replaced resume. The daily cleanup deletes checks with no resume that no `job_saves` row points to, so unsaved checks still go with their resume as today.
  - **`description`:** text, at most 20,000 characters (Milin's keep-text decision). For a board link it holds the posting's description with HTML stripped.
    - Private to the owner, never logged, never sent anywhere but the parse call.
    - In Download your data, and deleted with the account or with the row.
- **`job_saves`:**
  - A surrogate `id` replaces the (user, post) key.
  - `job_post_id` becomes nullable, and a new `job_check_id` is added (cascade).
  - A check requires exactly one of the two.
  - Unique indexes on (user, post) and (user, check).
  - `saved_at` stays the Saved bookmark. The stage check becomes 1 to 6, with 5 = Not this time and 6 = Withdrawn. Existing rows keep their numbers.
  - New `interview_at`, `closed_at` and `note` (at most 2,000 characters).
  - At most 300 rows per person, checked in code.
- **`mock_sessions`:** `job_save_id` (set null), and `job` joins the focus check.
- **Also:** RLS on, no policies (`scripts/check-rls.mjs`). Hand-written SQL, journal entry and snapshot. `EXPORT_VERSION` 33.

## Privacy (DPDP)

- **Private:** everything here belongs to the person only. It is never shown to companies, never sent with Express apply, and never counted in Network, the Market or "On your line right now".
- **Kept and deleted:** it goes with the account (cascade, on the 30-day account-delete clock) and is in Download your data. Deleting a job deletes it, with nothing archived.
- **Logs and analytics:** job text, notes and links never go into logs or analytics, the same rule as resumes. Logs carry ids, sources and statuses only.
- **Board reads:** only the posting the person linked is fetched. Recruiter names and contacts are dropped, as in the feed (`ats-feed-terms`).
- **Privacy notice:** one line under what we keep, in the same PR. It says we keep "the job description you add, for you only".

## Zod schema and tests first

- **Schemas:** `src/lib/schemas/my-jobs.ts` holds `jobStage`, `addJobRequest` (description and/or link), `updateJobRequest` (stage, dates, interview date, note) and `myJobView`. These are written before the store.
- **Schema tests:**
  - only https links are accepted;
  - long fields are rejected;
  - unknown stages are rejected;
  - a request needs a description or a board link.
- **Board-link parser tests:** each of the four hosts, look-alike hosts refused, and a feed post found and reused.
- **Store tests (DB, against TEST_DATABASE_URL):**
  - exactly one of post or check;
  - stage moves set and clear the right dates;
  - the 300 cap;
  - owner only;
  - a replaced resume keeps the saved job and recomputes its fit;
  - cleanup removes unsaved orphan checks only;
  - claim makes the Saved row;
  - account delete and export;
  - the description is never in a log line.
- **Mock tests:** `job` focus order, a role fallback, and skills with no questions.
- **Final check:** the full check before the single push.

## Where it sits, and design entries needed

- **Departures:** My jobs tab, "Add a job you found", and Prepare for this job.
- **Landing and Gaps:** the paste-a-job entry before sign-up.
- **Today:** no change in phase 1.
- **Me and Arrivals:** no change. Me is seen by others, and Arrivals is for CareerMetro postings that companies move.
- **Design entries** (design thread, before build):
  - My jobs row with its status menu (neutral chips: red, amber and green stay for gaps, cobalt for progress);
  - the edit sheet (status, dates, interview, note);
  - the "Add a job you found" box with link handling;
  - the mock title for a job;
  - the landing entry and sign-up prompt.

## Choices made while building (PR 1)

- `job_checks` gets no `user_id`: ownership stays through `resume_id` (NOT NULL, cascade), since an account's resumes go only with the account.
- An added job reuses an existing check with the same text, resume and role (the Gaps job check). Deleting it from My jobs deletes that check.
- An added job that is never saved loses its description and link after 24 hours (`clearUnsavedJobText` in the daily cleanup).
- Ashby has no single-posting API, so its board is read whole with a 5 MB cap; the other boards are read one posting at a time with a 1 MB cap. Recruiter fields are never read.
- A link to a posting already in the feed saves the feed post instead of a new check.
- SmartRecruiters needs no spacing: one request per add, and adds share the 5-a-day job check limit.
- parse-jd v2 (company, title and city, kept only when found word for word in the posting) is used for every check.
- The interview field, the Prepare menu and "Save and prepare" come in PR 2 and PR 3.

## Choices made while building (PR 2)

- The job is named in the address as `post:<id>` or `check:<id>`, the same key My jobs uses, and is looked up for the signed-in person only. Someone else's job, or a deleted one, falls back to the role.
- Practice accepts answers on a skill one of the person's saved jobs asks for, without making it a goal.
- A job round asks the job's still-open goals, then its "Only for this job" skills, then the role's other questions. One question in four is "About you" from the target role.
- Starting a round for a job that has left My jobs says "That job isn't in My jobs any more" (`no_job`). Deleting the job keeps past rounds, with the job link cleared.
- The running round's job line uses an ink dot, not cobalt, which stays for progress.

## Choices made while building (PR 3)

- The build order became four PRs: the interview date and Today's card here, and the first check before sign-up with the claim into My jobs in PR 4.
- Prototype v48 has no Today card, so it follows the other Today rail cards: "Interview in 3 days" (today, tomorrow), the job, the day and time in IST, and links to Practice, the mock interview and My jobs. Neutral colours, as cobalt is for progress.
- Today shows the soonest interview on a job at Interview or Offer, until two hours after it starts.
- The calendar file is an hour long, with the title and company only, made on the device as on Arrivals.
- An interview set on a closed job is kept, but the status stays closed and Today leaves it out.
- Download your data carries `interview_at` from export version 34.

## Choices made while building (PR 4)

- The landing page shows C19's heading, lead and the two steps as cards. The job is pasted on the Gaps page, because a job check needs the confirmed resume first; putting both on one page would change the resume confirm step, which is the AI pipeline.
- The Gaps page shows "Sign up to keep it in My jobs" to a visitor once a check exists. "Sign up with email" opens sign-in with My jobs as the next page; "Not now" hides the card.
- At sign-in the claim adds the newest check on the claimed resumes to My jobs as Saved, unless it is already there or the list is full. A check made on Gaps keeps no description, so "Read the job again" doesn't show for it.

## Phase 2 (C21 and C22 approved by Milin, 2026-10-29)

From Design's C21 and C22 (2026-10-29, prototype v50, handoff 12m and 12c), approved by Milin on 29 Oct via the Project manager's card. C20 (the skills line on Today's interview card) is a separate card, still unanswered, and is not part of this plan.

### 5. Share from the phone (C21)

- **Manifest.** Add `src/app/manifest.ts` (Next's metadata route): name, short name, `start_url: "/today"`, `display: "standalone"`, theme and background colours from the light tokens, 192 and 512 px icons (maskable too), and a `share_target`. The app has no manifest today, so this also makes it installable ("Add to Home screen"). No service worker: Chrome on Android installs a site with a manifest and icons, and a share target that posts to the server needs none. If a device refuses to install without one, add a minimal service worker with no caching. Check this on a real Android phone before the PR merges.
- **Share target uses POST, never GET:** `{ action: "/share", method: "POST", enctype: "application/x-www-form-urlencoded", params: { title: "title", text: "text", url: "url" } }`. A GET would put the job text in the address, which ends up in request logs and browser history; job text never goes into logs.
- **`POST /share` route.** It reads `title`, `text` and `url` from the form. Each is trimmed and capped: text to `JOB_TEXT_MAX`, title to 300 characters. The URL is kept only if it is https and at most `MY_JOB_URL_MAX`; anything else is dropped. It stores them in a hold and answers 303 to `/departures?tab=mine&shared=<holdId>`. Signed out, it answers 303 to `/sign-in?next=` with that address, so after sign-in the shared job is still there. It fetches nothing. A shared link to Greenhouse, Lever, Ashby or SmartRecruiters is read later by the usual "Add a job you found" path; any other link is kept as the person's link only, never fetched (the existing rule).
- **Hold table, migration 0052 `shared_job_holds`.** Columns: `id uuid`, `user_id` (nullable while signed out), `title`, `text`, `url`, `created_at`. Checks: text at most `JOB_TEXT_MAX`, url https and at most 2000. The id also goes in a short-lived, httpOnly, SameSite=Lax cookie (`cm_share`, 1 hour), so only the browser that shared can open a hold made while signed out. Departures reads the hold once, only when the cookie matches or the hold's `user_id` is the viewer, then deletes it. Holds older than 1 hour are refused on read and deleted by the daily cleanup cron. Holds are never logged, and the route is rate-limited with the shared limit (20 an hour per address).
- **Departures with `?shared=`.** "Add a job you found" opens filled with the text and link, under the banner "Shared from your phone. We filled in what the app sent: the link and its text. Check it, then save. Nothing is kept until you do.", with Clear. The check runs at once, the same `addJob` call as Add and check. When the share has only a link (many apps send just a URL), the board read fills the text for an ATS link; for any other link the box asks the person to paste the description, as today. Nothing joins My jobs until Save.
- **Paste button** inside the link field. It calls `navigator.clipboard.readText()` only on that tap, so the phone asks once. Where the browser has no clipboard read, the button is hidden. We never read the clipboard on our own.
- **Settings > "Add from your phone"** (handoff 12c). Two cards, Android (three steps) and iPhone (copy the link, open CareerMetro, tap Paste; add to Home Screen from Safari's share sheet), and the footer "We never read your clipboard or other apps on our own. Only what you share or paste reaches us." The "Ready on your Android phone" chip shows when the page runs as the installed app (`display-mode: standalone`); a browser can't tell whether the app is installed elsewhere, so the chip makes no other claim.
- **Privacy.** A shared job is private like any other My jobs row. The hold's text is deleted on read or within 24 hours at most. The privacy notice gains one line: "If you share a job to CareerMetro from your phone, we keep what you shared for up to an hour until you open it."

### 6. Weekly My jobs email (C22)

- **The switch.** Reuse `user_settings.email_weekly_summary` (off by default; no sender uses it yet). Settings > Notifications relabels it "Weekly My jobs email", with the copy in 12c and a "See this week's" preview that renders the same builder for the signed-in person in the page, sending nothing.
- **Migration 0052 (with the hold table):**
  - `job_saves.status_at timestamptz`, set whenever the status changes (the `datesFor` path), and backfilled from `coalesce(applied_at, saved_at, updated_at)`. "Waiting on a reply" needs the time of the last status change; `updated_at` also moves on note edits.
  - `user_settings.email_off_token text unique`: a random 32-byte token, base64url, made when the switch first turns on.
  - `weekly_emails (user_id, week date, sent_at, primary key (user_id, week))`: one row per person per India week, so a re-run never sends twice. The cleanup cron deletes rows over 90 days old.
- **What goes in** (pure builder `weeklyEmail(rows, now)` in `src/lib/my-jobs/weekly.ts`, data in, text and HTML out):
  - Waiting on a reply: Applied or Heard back, with `status_at` 7 or more days ago. Shows title, company, "Applied 26 Oct · 9 days, no word yet", and an Update status link to `/departures?tab=mine`.
  - Interview this week: `interview_at` from Monday 00:00 to Sunday 23:59 IST, at Interview or Offer. Shows title, company, day and time IST, and a Mock interview link (`/mock?tab=interview&job=`) or Practise link.
  - Practise these 3 skills: the still-open skills those jobs ask for, ordered by how many of the listed jobs ask for each and then by name, plus one "only for this job" extra, three in all. One line says which jobs ask for them. This uses the same `jobPrep` code as Prepare for this job; there is no AI call.
  - "Nothing here about your chances: that is for you and the company." No numbers about chances. Company and title only: never the job text, private notes or links to the posting.
  - Empty week (nothing waiting and no interview): no email and no row.
  - Subject from the parts that apply: "2 jobs waiting on a reply, 1 interview Thursday". Preheader: "And three skills worth an hour this week." From `hello@careermetro.com` (a new Resend sender on the verified domain; `EMAIL_FROM` stays for codes).
- **Sending.** Extend `sendEmail` with optional `html` and `headers`, keeping the plain-text part. Each email carries `List-Unsubscribe: <https://careermetro.vercel.app/email/off?t=…>` and `List-Unsubscribe-Post: List-Unsubscribe=One-Click` (RFC 8058, which Gmail and Yahoo expect from bulk senders). The HTML uses the light-mode token values inline, because email clients ignore CSS variables. The address, subject and body are never logged; only counts and Resend status codes are.
- **Turn it off with one tap, no sign-in.** `GET /email/off?t=<token>` shows "Turn off the weekly My jobs email?" with one button. The button, or the one-click `POST` from the mail app, sets `email_weekly_summary = false` and rotates the token. The GET alone changes nothing, because mail scanners follow links. An unknown token gets the same page, with nothing to say whether the token existed.
- **Cron within Vercel Hobby.** Add a second `vercel.json` cron, `GET /api/cron/weekly-email` at `30 2 * * 1-3` (08:00 IST Monday to Wednesday), checked with `CRON_SECRET` like the cleanup. Hobby allows crons at most once a day and may start one anywhere in its hour, so mail lands between 08:00 and 08:59 IST. Each run sends to people with the switch on, a non-empty week and no `weekly_emails` row for this India week, up to `WEEKLY_EMAIL_CAP` (80) a run. Tuesday and Wednesday pick up anyone Monday's cap left out. A run stops early, before the function time limit, and the next day continues. Resend's free plan allows 100 emails a day and 3,000 a month, shared with sign-in and work-email codes. Once opted-in people pass about 200, this needs Resend's paid plan, which is money and Milin's call; it goes on the tech-stack register when this ships.
- **Account deletion and export.** The weekly rows and the token cascade with the user. Download your data gains `weekly_email: { on, last_sent_week }` (export version 35).

### Zod schemas and tests first

- `shareHold` (the POST fields and caps), `weeklyEmailView` (sections, at most 10 waiting, at most 7 interviews, exactly 3 skills or fewer when fewer exist), and `emailOffToken` (base64url, 43 characters).
- Unit tests:
  - the manifest has a POST `share_target`;
  - `/share` refuses GET and drops a non-https url;
  - a text over the cap is cut, never rejected;
  - the hold is read once, only with the cookie or by its owner, and refused after an hour;
  - the weekly builder: the 7-day waiting rule on `status_at`, the IST week edges (Sunday 23:59 versus Monday 00:00), an empty week gives null, at most three skills in a stable order, and no note, text or link anywhere in the output;
  - the subject wording for each mix of parts;
  - the off link: GET changes nothing, POST turns it off and rotates the token, an unknown token gets the same page;
  - the cron: the bearer check, `weekly_emails` stops a second send in the same week, and the cap is respected.
- DB tests for the migration backfill and the cleanup of old holds and rows.
- e2e walk: share with a POSTed form, sign in, see the filled box and the banner, Save; Settings preview shows this week's email; open the off link and turn it off.
- Staging smoke: the Settings preview only. No real email goes out from CI.

### Build order for phase 2 (once approved)

- **PR 5:** migration 0052 (holds, `status_at`, token, `weekly_emails`), the manifest, `/share`, Departures `?shared=`, the Paste button, Settings > Add from your phone.
- **PR 6:** the weekly builder, Settings preview, `sendEmail` HTML and headers, `/email/off`, the weekly cron, export v35, and the privacy notice lines.

Later, after a lawyer's view of the portals' terms: a browser button that reads the open page, and forwarding job-alert emails.

## Choices made while building (PR 5)

- The hold table went into its own migration, 0052 `shared_job_holds`; the weekly email's columns and table come with PR 6 as 0053, so each PR carries what it uses.
- The hold keeps `text` and `url` only. The share's title leads the text when there is a description with it, and with no `url` the first https link in the text becomes the link (`sharedJobOf` in `src/lib/my-jobs/rules.ts`), because many Android apps put the link in the text.
- `/share` always lands on `/departures?tab=mine&shared=<id>`; the proxy sends a signed-out person through sign-in with that address as `next`, so the hold waits. The proxy's redirect is a GET, so no form is posted twice. Holds made signed in also keep `user_id`.
- The check runs at once only when it can work: a description of at least 200 characters, or a company job board's link alone. A link and a short blurb fill the box and wait for the description.
- `?shared=` leaves the address after the page opens (history.replaceState), so a reload doesn't say the share has gone. Other outcomes (`empty`, `limit`, `failed`, or a hold that has gone) show one line in the box's alert.
- Paste puts a link into the link field and other text into an empty description; it reads the clipboard only on the tap.
- The Settings copy says "Open CareerMetro in Chrome" rather than naming careermetro.com, as the domain isn't pointed yet.
- Icons are rendered from `src/app/icon.svg` into `public/icons/` (192, 512 and a maskable 512). No service worker.

## Choices made while building (PR 6)

- Migration 0053 carries the weekly email's parts: `job_saves.status_at` (backfilled, with a default for new rows; left nullable because migrations only expand, and reads fall back to the applied date, then the last change), `user_settings.email_off_token` (unique) and `weekly_emails`.
- `status_at` moves only when the stage changes: the status menu, the edit sheet, and Departures' Applied and "I didn't apply". A note or a date edit leaves it.
- The off token is made on the first send rather than when the switch turns on, so a person who never gets an email holds no token. It is replaced each time it turns the email off.
- The email's links: List-Unsubscribe points to `/api/email/off?t=` (a POST turns it off, RFC 8058). A GET there only redirects to the page `/email/off`, which asks first. Mail scanners can't turn it off by opening the link.
- The sender is `CareerMetro <hello@…>` on EMAIL_FROM's own domain (`weeklyFrom`), so no new key or setting is needed.
- A week found empty also gets its `weekly_emails` row, so Tuesday and Wednesday don't read it again. A failed send gets no row, so the next day tries again.
- Interviews this week count from the moment of the run until Sunday 23:59 IST, so Tuesday's run doesn't list Monday's interview. The link is "Mock interview" with Elite on, otherwise "Practise".
- Heard back says "Heard back 20 Oct · 9 days, nothing since"; the handoff shows only the Applied line.
- The Notifications section loses its "stored only" tag, and its note now says the weekly email is sent.

## Build order once approved

- **PR 1:** migration 0050, schemas, store, board-link reading and the My jobs tab.
- **PR 2:** Prepare for this job (practice and mock).
- **PR 3:** the first check before sign-up and the claim into My jobs.
