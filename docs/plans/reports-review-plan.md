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
- Action taken records the decision. The tool itself doesn't remove content. The admin suspends a company from Company review. Removing a message and suspending a person's account are the next step; they wait for Milin, because they delete or lock real user data.
- Telling the reporter the outcome waits for the email sender key.
- Report notes are kept with the report. The privacy notice says so (launch-readiness item 8, already listed), and the IT Rules want grievance records kept. Notes are not cleared at purge. This settles inbox-plan.md's DPDP line.

## Tests
- Unit tests: deadlines per reason, and the schemas (input strict, view strict).
- DB: list order, deadlines, context labels and short names, no email; acknowledge once, close as action taken or dismissed, audit lines, a closed or invalid report refused.
- Action: admins only, the admin id comes from the session, the page reloads on success.
- e2e: 404 when signed out; the admin acknowledges, then closes; focus stays on the row; axe in light and in dark at phone width.
