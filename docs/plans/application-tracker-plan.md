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

## Phase 2 (planned after phase 1 ships)

- **Android share target:** a `share_target` in the web app manifest posts title, text and link to "Add a job you found".
- **Today:** "Interview with X in 3 days", and that job's skills join the daily ride.
- **Weekly email, opt-in in Settings:** "2 jobs waiting on a reply, 1 interview Thursday, practise these 3 skills." It needs a weekly cron on Hobby (allowed) and Resend, which is live.
- **Later, after a lawyer's view of the portals' terms:** a browser button that reads the open page, and forwarding job-alert emails.

## Build order once approved

- **PR 1:** migration 0050, schemas, store, board-link reading and the My jobs tab.
- **PR 2:** Prepare for this job (practice and mock).
- **PR 3:** the first check before sign-up and the claim into My jobs.
