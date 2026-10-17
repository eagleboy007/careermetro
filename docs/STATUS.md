# CareerMetro status

This page lists facts only, each with a PR or doc link. Read it first. Update it in 2–3 lines at the end of every task, in the same PR. How to work is in `.claude/skills/careermetro-dev/SKILL.md`.

Last updated: 2026-10-17 (Not for me per goal, FR-48, Development 3).

## Built and live (https://careermetro.vercel.app)

- **Job seeker**
  - Resume, Gaps, Path, Today, Map, Life line, Departures, Me and public profile, account settings 1–2, Inbox part 1, and resume download (PDF and Word). See `docs/REQUIREMENTS.md`.
  - 29 role profiles, "one of these" skill groups, certificate dates, and "Closest to your resume". See `docs/plans/`.
  - Pasted-job check (#109–#117). Nearby lines (#123). Market with example data (#125, #130). AI-ready resume check (#126).
  - Not for me per goal, FR-48 (2026-10-17): skip a required goal (it stays a gap; the train passes it; Bring back restores it) or swap a "one of these" goal to another skill of its group, on the Map (#154) and in an open goal on Today. No migration; export version 19. Tracks wait for role tracks. See `docs/plans/not-for-me-plan.md`.
- **Proof**
  - Certificate proof (#109, #110) and profile certifications with the Credly check (#132).
  - A Credly link fills a goal only after the check (#135, migration 0029).
  - The held-proof review screen `/admin/proofs`, FR-44 (#137).
- **Admin:** report review `/admin/reports` with the IT Rules deadlines, FR-45 (`docs/plans/reports-review-plan.md`). Report notes are kept, as the privacy notice will say (launch-readiness item 8).
  - Removal tools, FR-46, #146 (Project manager's decision under Milin's delegation, 2026-10-15): hide a reported message and suspend an account, both reversible, with reason and audit line; migration 0031. See the plan's "Removal tools".
- **Employer:** Corporate steps 1–7 (#113–#122), Express apply (#133), "Let companies find me" (#128; found chats count on the Corporate tab and Overview, and an unverified company counts none, #139), and the company-side and security fixes (#131, #134, #136). See `dev/corporate-plan.md`.
  - T44 (Milin, 2026-10-15), #148: Find people shows each person's target role and city, and filters by experience, target role, city and verified profile, one or several together. People give an optional city in Settings (migration 0032, export version 17). Name search (name, name + role, name + role + current company) and a company never seeing its current staff (latest job on the profile), #149. Network name search waits for Network. See `dev/companies-find-me-plan.md`.
  - Verified current job by work email, FR-47 (C5, 2026-10-16): a code to the person's email at their current company sets "Verified with work email" on Me, the public profile and the found-person view; other domains wait for an admin on /admin/companies. Migration 0033, export version 18. Off in production until the email sender exists. See `docs/plans/current-job-check-plan.md`.
- **Platform**
  - RLS on every table (#112). Hardening H1–H12 except H7 (`dev/engineering-standards.md`).
  - The app sends its own email (work-email codes) through Resend over HTTPS, `src/lib/email/send.ts`, once the key is in; an unsent code is spent and the person told to try again (launch readiness item 11, 2026-10-16).
  - Review carry-overs 3 to 6 (pending-items.md) are closed: the `gap_analyses` profile index, AI spend reserved before the call, and the rating route tests were already in; `npm run eval:explain` now checks the explain-gaps prompt (no invented quotes, the matcher's hours, no exclamation marks), with its scoring tested in CI without the API (2026-10-17).
  - Rate-limit windows over two days old are deleted by the daily cleanup, not by a random hit, which had made the daily-limit tests flaky when test files ran in parallel (2026-10-16).
  - WCAG 2.2 AA and phone-speed pass on every screen, with the `line-strong` token for control edges (#138). See `docs/dev/a11y-audit-2026-10-13.md`.
  - The ATS openings feed runs monthly (#127). 424 free resource links (#129).
- **Launch:** draft `/privacy` and `/terms` behind the preview gate until the legal adviser approves them. The launch-day checklist with rollback is `docs/dev/launch-day.md`.
- **Switched off until keys arrive:** sign-in (preview uses a test user), company sign-up, join and re-check codes and the current-job check (need `RESEND_API_KEY` and `EMAIL_FROM`, `dev/email-sender-steps.md` step 6, plus `NAME_HASH_KEY`), find-people, phone sharing, and photo and certificate upload.

## In progress

- Nothing.

## Next up

The Project manager's queue of 2026-10-15 is done: launch readiness (c) 6 and 7, Practice (#145), Match (#143) and the report removal tools (#146). Detail for each is in `dev/launch-readiness.md`, `dev/practice-match-plan.md` and `docs/plans/reports-review-plan.md`.

Open, all waiting on someone else:
1. Pending item 1, post-upload issues: Testing has no open upload defects (2026-10-15). It needs Milin's details.
2. Launch readiness (c) 6, full alerts: needs a log drain on Milin's Vercel account. The 6-hourly smoke check runs meanwhile.
3. The 95 practice questions are self-checked only; an expert review is still owed (Data research).

Handover (2026-10-15 18:25 UTC): "Development 3" took over from Development 2 for T44.

Waiting: Network name search (Network not built); the end of Milin's name-search message ("city or …"); photo and certificate upload (storage keys); Market live data (Data research); Find people DB-side ranking (1,000 opt-ins or `find_scan_capped`, `dev/companies-find-me-plan.md`).

Waiting on design: the Elite version (pending items 10 and 20). Only "Your plan" (proto v33) is drawn, and there is no billing in beta. Nothing gets built until the design thread has the screens approved.

Numbers: the next migration is **0034**. `EXPORT_VERSION` (19) lives in `src/lib/account/export.ts`. The latest FR is FR-48.

## Decisions log (newest first)

- 2026-10-16: The current job is verified by a code to the work email; unknown domains go to an admin, only the domain is kept, freelance is Self-declared (Milin 2026-10-10; plan approved by the Project manager under his delegation). See `docs/plans/current-job-check-plan.md`.
- 2026-10-15: Companies search people by name, name + role, name + role + company; a company never sees people whose current job is there (Milin; employer rule by the Project manager under delegation). See `dev/companies-find-me-plan.md`.
- 2026-10-15: Companies see the target role of everyone findable, and Find people filters by experience, target role, city and verified profile, with an optional city for people (Milin, T44). "Verified" means at least one skill proved (Development; Milin can reverse). See `dev/companies-find-me-plan.md`.
- 2026-10-15: The report tool may hide a reported message and suspend an account, both reversible and nothing deleted (Project manager under Milin's delegation; Milin can reverse it). See `docs/plans/reports-review-plan.md`.
- 2026-10-15: Full pace without repeated work: one PR per feature, one review pass, push once, and fresh threads that start from this page (Milin). See the skill.
- 2026-10-15: A Credly link fills a goal only after the Credly check (T48). See `dev/profile-certs-plan.md` decision 19.
- 2026-10-13: With "Let companies find me" on, companies also see the target role (Project manager's call; Milin can reverse it). See `dev/corporate-plan.md`.
- 2026-10-12: Corporate choices A–D are taken as recommended: email invite, Milin verifies companies, phone only by choice, one admin to start. See `dev/corporate-plan.md`.
- 2026-10-12: Two gap layers: role gaps are goals, and pasted-job gaps show only on that job. See `dev/role-suggest-plan.md`.
- 2026-10-12: Certificate proof needs the person's name and a current certificate. A mismatch is blocked and a reused credential is held. See `dev/proof-plan.md`.
- 2026-10-11: Brand Option A. See `docs/brand/`.
- 2026-10-08: Only proof fills a goal (exam, verified certificate, corroborated work). See `dev/proof-plan.md`.
- 2026-10-07: Development merges its own PRs after one review pass and green CI.
- 2026-10-06: Founding decisions. See `CLAUDE.md`.

## Known issues and blockers

- **Milin, keys** (never ask for them in chat): sign-in keys (`docs/plans/signin-setup-steps.md`), `NAME_HASH_KEY` and the other H7 hash keys, the Vercel preview bypass secret for Testing, storage keys, and the email sender.
- **Milin, decisions:** the cut-off end of his name-search message; the employer-hiding rule (Project manager's call, reversible); the Junction intermediary compliance question (pending item 15); formal approval of the Market design.
- **Project manager:** deleting merged remote branches, which the permission check blocks for Development.
- `reopenUnconfirmedGoals` (daily cleanup) re-checks every rejected or held certificate each day. That is fine at beta scale, but limit it to recent rows when there are many.
- `/mnt/project-files` sometimes gives I/O errors. When it does, write to `docs/` and copy across later.
- Thread containers can't reach `registry.npmjs.org`, so CI is the npm check.
- CI logs are readable only through the GitHub MCP `get_job_logs` with `return_content`.
- CI's DB is unseeded. Tests must not rely on seeded rows or delete shared fixtures. Run tests on both the seeded and a fresh DB.
- e2e: check the FAIL lines and the exit code. The local walk needs `NAME_HASH_KEY=e2e-only-name-hash-key` (as in CI), or the corporate steps fail.
- Worktrees are locked; remove them with `git worktree remove -f -f`.
- `.claude/` is in git's local exclude file; use `git add -f`.
- Next 16 differs from the Next you know; read `node_modules/next/dist/docs/` first.
- Vercel Hobby allows 100 deploys a day, and every PR push deploys. Push once per PR.
