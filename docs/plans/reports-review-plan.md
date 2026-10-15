# Report review (/admin/reports, FR-45)

Date: 2026-10-15. Decided by Development under Milin's standing delegation; Milin can reverse any line.

## What changes
- `src/lib/admin/reports.ts`: `reportsForReview` (open reports, oldest first, at most 200) and `reviewReport` (acknowledge, action taken, dismiss; one audit line `admin:<id>` / `report_<decision>` / `report:<id>`).
- `src/lib/admin/report-deadlines.ts`: deadlines per reason.
- `src/lib/schemas/admin.ts`: `reportReviewInput`, `reportReviewView`.
- `/admin/reports` page and action, `ReportReview` component, admin nav, `/design`, the e2e walk.

## Decisions
- Deadlines follow the Grievances page: acknowledge every report within 24 hours. Sexual content or impersonation: act within 24 hours. Money or OTP asks, harassment, fake jobs and spam: act within 72 hours (each is a request to act on something that breaks the rules). Something else: decide within 15 days.
- The admin sees the reported message text or job title, because they can't decide without it. People are first name and last initial only. It is admin-only and never logged. The message and the reporter's note are shown as they were written, so anything a person typed into them (a phone number, say) shows too; the admin needs the words to decide.
- Action taken records the decision. The admin suspends a company from Company review. Hiding a message and suspending a person's account were the next step; they are now built (below, FR-46).
- Telling the reporter the outcome waits for the email sender key.
- Report notes are kept with the report. The privacy notice says so (launch-readiness item 8, already listed), and the IT Rules want grievance records kept. Notes are not cleared at purge. This settles inbox-plan.md's DPDP line.

## Tests
- Unit tests: deadlines per reason, and the schemas (input strict, view strict).
- DB: list order, deadlines, context labels and short names, no email; acknowledge once, close as action taken or dismissed, audit lines, a closed or invalid report refused.
- Action: admins only, the admin id comes from the session, the page reloads on success.
- e2e: 404 when signed out; the admin acknowledges, then closes; focus stays on the row; axe in light and in dark at phone width.

## Removal tools (FR-46)

Date: 2026-10-15. Decided by the Project manager under Milin's delegation; Milin can reverse it. An admin can hide a reported message and suspend an account from /admin/reports. Both are reversible, nothing is hard-deleted, each records the admin, the reason and the time, and the person affected sees a plain notice.

### What changes
- Migration 0031 (`drizzle/0031_report_removals.sql`, expand only): `messages.hidden_at`, `hidden_by` (users, set null), `hidden_reason`; `users.suspended_at`, `suspended_by` (users, set null), `suspended_reason`. Reasons 1 to 500 characters (check constraints). The `*_by` columns are not indexed (admin ids, never queried by; listed in `src/db/indexes.test.ts`). `src/db/migrations.test.ts` now reads a check's `"table"."column"` names, so a check on a column added in the same migration counts as safe, like a foreign key does.
- `src/lib/admin/removals.ts`: `applyRemoval` (hide, unhide, suspend, lift; a transaction that locks the open report and then the message or user row; one audit line `admin:<id>` / `message_hidden` · `message_unhidden` · `account_suspended` · `account_unsuspended` / `message:<id>` or `user:<id>`), `removalStates` (per open report: the message and account and what is in force) and `removalsInForce` (hidden messages and suspended accounts, newest first, 100 each). `src/lib/schemas/admin.ts`: `reportRemovalInput`, `removalState`, `hiddenMessageView`, `suspendedAccountView`; `reportReviewView` gains `message` and `account`.
- `src/lib/inbox/hidden.ts`: `shownBody()` and `isHidden()`, selected instead of `messages.body` on every chat read path.
- `src/lib/auth/server.ts`: `suspendedFor`; `currentAccount` is null for a suspended non-admin. The signed-in layout and `afterSignIn` send them to `/account/suspended` (`SuspendedNotice`).
- `/admin/reports`: Hide message or Unhide message, Suspend account or Lift suspension per row; the "Hidden and suspended" list; `/design`; the e2e walk step after the reports step.

### Decisions
- Which account a report points at: the reported person; the writer of a reported message (none for a company message whose writer's account went); the one other person in a reported direct chat. A company chat or a job points at a company, which is suspended from Company review as before.
- Hide and suspend start from an open report and need a reason; Unhide and Lift take the message or account id, so they work after the report is closed (from the "Hidden and suspended" list). Neither closes the report.
- An admin can't be suspended: anyone in ADMIN_EMAILS or the local test admin (`isAdminEmail`, which errs towards refusing), and never the admin's own account. Admins are never blocked by a suspension either (`suspendedFor` checks the signed-in identity).
- The audit table has no details column, so the report id is not on the removal's audit line. The row itself keeps who, why and when; the report keeps its own lines.
- Message read paths changed (all swap the text in SQL, so a hidden body never leaves the database): the Inbox (`listThreads`: direct, application and found chats; a hidden "Ask for times" or question card shows as the notice only), Corporate Messages' application chats (`companyChat`) and list previews (`companyMessages`), found chats (`companyFoundChat`) and their previews (`foundChatItems`). A hidden "Ask for times" takes no answer (`offerTimes`). There is no export of messages to companies. The admin's report review and in-force list read the body, because the admin must see it to decide.
- Download your data still includes the sender's own text of a hidden message (`exportInbox`, own messages only): it is their data, and hiding is about what others see. No `EXPORT_VERSION` change: the download's shape is unchanged.
- People listings changed for a suspended account: Find people (`findableWhere`, so search, open and request), found chats on the company side (`foundChatsWhere`), every application view built on `visibleApplicationsWhere` (Corporate Messages, Interviews, Overview counts), the job board and the drawer (`jobBoard`, `visibleApplication`), the Jobs list counts, and `/u/<username>` (`findProfile`). The Inbox of the people they chatted with still lists those chats.
- A suspended person can't use any signed-in page or action, including Settings and Download your data; the notice points to the grievance officer, who can send the data on request.
- Nothing about a removal is logged except the action and outcome. Reasons and text never go to logs.
- Not yet: telling the reporter the outcome (waits for the email sender), and an index on `messages.hidden_at` for the in-force list (a scan of messages; fine at beta scale, add a partial index when messages grow).

### Tests
- Schemas: removal input (reason required and trimmed, 500 at most, strict, no admin id), states, in-force views.
- DB (`src/lib/admin/removals.test.ts`): hide and unhide with the text kept, both sides' Inbox reads the notice, audit lines, a closed report refuses a new hide but not an unhide; only a message can be hidden; suspend and lift for a person, message and direct-chat report, audit lines, refusing an admin, the admin's own account and a blank reason; a company chat points at no account. `chats-store.test.ts` and `find-store.test.ts`: hidden text never returned by company chats, previews or the Inbox; a suspended person out of Find people, found chats, the board, chats and the drawer until lifted.
- Action: admins only, the admin id from the session, the page reloads on success.
- e2e: the admin hides the reported message (a blank reason is refused first), focus stays on the row, the reporter's Inbox shows the notice and never the text, then the admin shows it again from the in-force list.
