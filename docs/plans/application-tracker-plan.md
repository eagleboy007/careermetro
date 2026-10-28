# Application tracker: plan (Milin, 2026-10-28)

Development 4, 2026-10-28. Source: Milin's idea relayed by the Project manager on 28 Oct at 20:15 UTC. People find jobs on any portal, bring each one to CareerMetro, track the application here and prepare from that job's skills. It touches the data model, so **nothing is built until Milin approves**.

The tracker uses only what the person pastes. CareerMetro never enters portal jobs itself, fetches or reads the link, or copies postings by hand (CLAUDE.md, 2026-10-06 decision).

## What is already there

- **Job checks** (`job_checks`, "Saw a role somewhere else?" on Departures and Gaps):
  - The person pastes a posting. The model reads only its company, title and skills (`prompts/parse-jd`), and the code matches those skills to the resume.
  - The posting text is never stored, only its keyed hash. A check belongs to a resume and goes when that resume goes (cascade).
  - The limit is 5 new checks a day.
- **Departures' Saved and Applied tabs** (`job_saves`): these cover feed roles only, with stages 1 to 4 (Applied, Heard back, Interview, Offer).
- **Mock interview picking** (`pickInterviewQuestions`): it already takes a list of skills to ask about first (the "Your gaps" focus).
- **Practice bank**: open questions per skill.
- **Calendar files** (`src/lib/calendar/ics.ts`): an interview `.ics` with a 19:00 IST reminder the evening before.
- **In-app notifications**: sentences built from live rows when the panel opens, so no cron is needed.

## 1. My applications

- **Signed in only.** A pasted-job check's result gains "Track this application". The new row starts as **Saved**, or **Applied** if the person picks that.
- **Fields:**

  | Field | Rules |
  |---|---|
  | Job link | Optional. https only, at most 2,000 characters. Shown as a plain outbound link (`rel="noopener nofollow"`). We never fetch it. |
  | Company | From the check, 1 to 120 characters, editable. |
  | Title | From the check, 1 to 160 characters, editable. Long titles are clamped on screen, as Departures does since the 26 Oct fix. |
  | Status | `saved`, `applied`, `interview`, `offer`, `rejected` or `withdrawn`. The person sets it; nothing moves it on its own. |
  | Dates | Saved on, applied on and closed on are set when the status changes and can be edited. Interview date is section 3. |
  | Notes | Private, at most 2,000 characters. Never sent to the model, never logged, never shown to anyone else. |

- **Limit:** at most 200 tracked applications per person, which covers a heavy search.
- **Feed roles** keep `job_saves`, and the list shows both kinds together, newest change first. *Default I'm picking:* give `job_saves` the same two end states (stages 5 Rejected and 6 Withdrawn) so both kinds read alike. It is a one-line check change in the same migration. If Milin says no, feed roles stay at four stages.

## 2. Prepare from that job

- **Skills come from the check**, which is already the model's only job. Matching stays deterministic. The tracker copies the check's required and nice-to-have skill ids onto its own row, so preparation still works after the resume is replaced and the check is gone.
- **Mock interview:**
  - "Practise for this job" opens `/mock` with a new focus, `job`.
  - The round asks the job's required skills first, then its nice-to-have ones, then the role's own questions.
  - Questions are picked by skill id from the whole bank, not only the role's list, since a portal job may mix roles.
  - The "about you" questions still come from the person's target role.
  - The session stores which application it was for.
- **Practice:** the question bank page filters to the job's skills, using the same free and Elite rules as today.
- **Skills with no bank questions** are listed as "No practice questions for these yet". Unknown skills (not in our list) are shown and never scored, as on job checks today.
- **No new AI call:** feedback on mock answers stays the existing call and prompt, logged in `ai_calls` as now.

## 3. Interview date and reminder

- **Setting a date:** the person can set an optional interview date and time (IST), which also moves the status to Interview if it was earlier.
- **Reminders:**
  - "Add to calendar" downloads the existing `.ics` file. It carries the job title and company only, with the 19:00 IST alarm the evening before.
  - In-app, a notification reads "Interview tomorrow for {title} at {company}. Practise for this job." It shows from 00:00 IST the day before and is built at read time like the others.
- **Email reminder:** *Default I'm picking:* none. Email is now possible (Resend is live), but a daily email needs a cron at a fixed hour on Hobby and a settings switch. That can be a later item if Milin wants it.

## 4. Privacy and DPDP

- **What is stored:** link, company, title, status, dates, notes and skill ids. No posting text is stored (the hash stays on the check). No recruiter names or contacts: there are no fields for them, and the notes hint says "Don't add other people's contact details".
- **Who sees it:** only the owner. It is never shown to companies, never sent with Express apply, and never counted in Network or the Market.
- **Download your data:** the export includes it, `EXPORT_VERSION` 33.
- **Deletion:** it goes with the account (on delete cascade), on the same 30-day account-delete clock. The person can delete one row at any time, and deleting it removes it, nothing is archived. Logs carry ids and statuses only, never notes, links or titles.
- **Privacy notice:** gains one line under what we keep, as part of the same PR.

## 5. Schema and migration (0050)

- **New table `job_applications`:**
  - Columns:
    - `id`
    - `user_id` (cascade)
    - `job_check_id` (set null)
    - `url`, `company`, `title`, `status`
    - `required_skill_ids`, `nice_skill_ids` (text[])
    - `saved_at`, `applied_at`, `interview_at`, `closed_at`
    - `notes`
    - `created_at`, `updated_at`
  - Checks enforce:
    - the status list;
    - the field lengths;
    - `url` starting with `https://`;
    - `closed_at` only on rejected or withdrawn.
  - Unique on (`user_id`, `job_check_id`), so the same check is tracked once.
  - Index on (`user_id`, `updated_at`).
- **`mock_sessions`** gains `job_application_id` (set null), and `job` joins the `MOCK_FOCUSES` check.
- **`job_saves`** stage check becomes 1 to 6, if the default in section 1 stands.
- **Mechanics:** RLS on, no policies, as for every table (`scripts/check-rls.mjs`). Hand-written SQL, journal entry and snapshot, as usual.

## 6. Zod schema and tests first

- **Schemas:** `src/lib/schemas/application.ts` holds `applicationStatus`, `trackApplicationRequest`, `updateApplicationRequest` (status, dates, notes, link, company, title) and `applicationView`. These are written first, and a link that is not https, an over-long field and an unknown status are rejected.
- **Tests before the store:**
  - status change sets and clears the right dates;
  - tracking the same check twice reuses the row;
  - the 200 limit;
  - only the owner can read or change a row;
  - a replaced resume keeps the row and its skills;
  - deleting the account removes the rows;
  - the export includes them.
- **Mock tests:** `job` focus asks required skills first, falls back to the role, and handles a job whose skills have no questions.
- **Other tests:** the reminder's day boundary in IST, and the `.ics` holding no notes or link.
- **Final check:** the full check before the single push.

## 7. Where it sits

- **Departures:** the Applied tab becomes **My applications**. It holds feed roles and tracked portal jobs together, each with its status chip and the job's readiness in words. The paste box result gets "Track this application".
- **Today:** a **Next interview** card when one falls in the next 7 days. It shows the date, company and title, plus "Practise for this job".
- **Me:** no change. Me is the profile others can see, and applications are private.
- **Arrivals:** no change. It stays for applications to CareerMetro postings that companies move.
- **Needs design entries** (design thread, before build):
  - the My applications row and its status menu (6 states as neutral chips: red, amber and green stay for gap status, and cobalt for progress);
  - the edit sheet (link, dates, notes);
  - the Next interview card on Today;
  - the "Practise for this job" entry on `/mock`.

## Build order once approved

- **PR 1:** migration, schemas, store and the My applications tab.
- **PR 2:** job-focused mock and practice.
- **PR 3:** interview date, `.ics`, notification and the Today card.
