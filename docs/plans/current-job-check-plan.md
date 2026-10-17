# Plan: Verified current job with a work-email code (C5, handoff 12d)

Development 3, 2026-10-16. Milin approved the requirement (R1) and the 12d details on 2026-10-10. This plan covers the data model and flow; the Project manager approved it under Milin's delegation on 2026-10-16 (Milin can reverse it). Becomes FR-47.

## What people see
- On Me, Experience: the current job (the open one on the confirmed profile, else the latest) shows one of these:
  - "Verified with work email · Oct 2026"
  - "Checking your company's email domain" (queued for review)
  - "Self-declared" (employer reads Freelance, Self-employed or similar)
  - "Not verified", with a "Verify with your work email" button
- Older jobs never ask and show no label.
- Verify flow, inline under the job:
  - The person types their email at that company and presses Send code.
  - They get a 6-digit code (10 minutes, 5 tries, then a 15-minute lock) and type it in.
  - Free mail is refused with one plain line.
  - Delivery uses the same sender as the company work-email codes. On screen in test mode, by email once the sender is set, off when neither.
- After an end date is added the label reads "Verified while there".
- Changing the company or start date (a new confirmed profile) clears it, because the check is tied to the company and the start month.
- The badge also shows on the public profile `/u/<username>` and to companies: the found-person view, the applicant drawer and Find people cards.
- Only the label and month show. The address and domain are never shown.

## Domain match
- The email domain counts as matching when its main label matches the company name the way `companyKey` compares them. For example, garudasec.com matches "Garuda Sec Pvt Ltd", and the first word of the name counts too.
- Otherwise the check is saved as "review". An admin approves or refuses it on `/admin/companies`, in a new "Work-email checks" list that shows the company name, the domain and the date (no address).
- Admin approval sets the badge, and refusal clears it. Both write an audit line with ids only.

## Data (migration 0033, expand only)
- `work_email_purpose` gains `current_job` and reuses `work_email_codes`.
- New table `job_email_checks` (`job_checks` already holds pasted job descriptions):
  - `id`, `user_id` (cascade), `employer_key` (companyKey of the employer), `start_month` (YYYY-MM or null)
  - `domain`, `status` (`verified` | `review` | `refused`), `checked_at`
  - `reviewed_by` (set null), `reviewed_at`
  - Unique on (user_id, employer_key, start_month). RLS on, with an index on status for the admin list.
- The address is never stored past the code, the same as company codes: it is set to null when the code is spent or expires.
- Limits are the existing work-email ones: 3 an hour and 10 a day per person, 20 a day per domain.
- Download your data gains `jobEmailChecks` (employer key, month, domain, status, date), so EXPORT_VERSION becomes 18. Account delete removes the rows.

## Find people
`worksAt` also counts a verified job check's domain against the company's verified email domain, so a verified employee is hidden even if the job title text differs.

## Not in this PR
- Manager confirmation for "Not verified" (later, with PROVE by work experience).
- Any change to the resume confirm step.

## Tests and docs
- Zod schema first, then tests:
  - store tests: free mail, the limits, expiry, wrong tries and the lock, match versus review, clearing on a company or start change, and a verified job showing after an end date
  - the admin review action
  - export and delete
  - the e2e walk: Arjun verifies with the test code and sees the badge
- `/design` example.
- FR-47 in REQUIREMENTS, STATUS, and the change tracker C5 row.

## As built (FR-47)
- The table is `job_email_checks`. The owner's "review" label reads "Work email received · we're checking the domain"; others see "Not verified".
- A domain matches when its name is the company's words run together, the first word (3+ letters) or the initials (2+). A prefix match was dropped: info.com would have matched Infosys.
- The applicant drawer shows the application's frozen snapshot, so it carries no badge; the found-person view and public profile do.
- The e2e walk verifies the walk's own current job (Example Retail) with the on-screen test code.

## Changed after Testing Run 4 (2026-10-17)

- T53, T57: a name-only domain match is gone. A check passes without an admin only on the domain (or a subdomain) of a company CareerMetro verified, whose name or legal name names the employer. Everything else goes to review.
- T54, T55, T62: Find people hides a person from a company whose name their current employer plainly names (containment or initials, `sameCompany`), or on whose domain they confirmed a code for their current job (verified or in review).
- T56: more free-mail domains, and any registered domain of Gmail, Yahoo, Hotmail, Outlook, Rediffmail or Proton is free mail. T66: the per-domain daily limit counts the registered domain.
