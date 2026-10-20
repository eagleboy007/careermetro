# CareerMetro status

This page lists facts only, each with a PR or doc link. Read it first. Update it in 2–3 lines at the end of every task, in the same PR. How to work is in `.claude/skills/careermetro-dev/SKILL.md`.

Last updated: 2026-10-20 (goal sync skip).

## Built and live (https://careermetro.vercel.app)

- **Job seeker**
  - Resume, Gaps, Path, Today, Map, Life line, Departures, Me and public profile, account settings 1–2, Inbox part 1, and resume download (PDF and Word). See `docs/REQUIREMENTS.md`.
  - 29 role profiles, "one of these" skill groups, certificate dates, and "Closest to your resume". See `docs/plans/`.
  - Pasted-job check (#109–#117). Nearby lines (#123). Market with example data (#125, #130). AI-ready resume check (#126).
  - v44 fixes, Today No resume (gap list items 1 to 4, no migration): target role chips above the upload box, carried to the role step in sessionStorage and shown first there (FR-8); the four reading steps while a resume uploads; the drop zone's "Drop your resume here" copy and Choose file; the full subline. "Try a sample resume" is left out: it needs new server code that sends a fixture through the parser.
  - Not for me per goal, FR-48 (2026-10-17): skip a required goal (it stays a gap; the train passes it; Bring back restores it) or swap a "one of these" goal to another skill of its group, on the Map (#154) and in an open goal on Today (#155). After Testing Run 4 (T58 to T60, T67, T68), a swapped goal learns its new skill on Path and Practice too, keeps its learn tick, and Me and the Map's stop labels pass skipped goals; asking twice is fine, and someone else's goal is 404. No migration; export version 19. Tracks wait for role tracks. See `docs/plans/not-for-me-plan.md`.
- **Proof**
  - Certificate proof (#109, #110) and profile certifications with the Credly check (#132).
  - A Credly link fills a goal only after the check (#135, migration 0029).
  - The held-proof review screen `/admin/proofs`, FR-44 (#137).
- **Admin:** report review `/admin/reports` with the IT Rules deadlines, FR-45 (`docs/plans/reports-review-plan.md`). Report notes are kept, as the privacy notice will say (launch-readiness item 8).
  - Removal tools, FR-46, #146 (Project manager's decision under Milin's delegation, 2026-10-15): hide a reported message and suspend an account, both reversible, with reason and audit line; migration 0031. See the plan's "Removal tools".
- **Employer:** Corporate steps 1–7 (#113–#122), Express apply (#133), "Let companies find me" (#128; found chats count on the Corporate tab and Overview, and an unverified company counts none, #139), and the company-side and security fixes (#131, #134, #136). See `dev/corporate-plan.md`.
  - T44 (Milin, 2026-10-15), #148: Find people shows each person's target role and city, and filters by experience, target role, city and verified profile, one or several together. People give an optional city in Settings (migration 0032, export version 17). Name search (name, name + role, name + role + current company) and a company never seeing its current staff (latest job on the profile), #149. Network name search waits for Network. A name of one letter plus punctuation ("a.") is refused like one letter (T63), and a one-word brand ("HCLTech", "InfosysBPM") is hidden from a company whose name it starts with (T71), but not from a name found inside it, so Coca-Cola staff show to Ola (T72, Project manager's option B), 2026-10-17. See `dev/companies-find-me-plan.md`.
  - Verified current job by work email, FR-47 (C5, 2026-10-16): a code to the person's email at their current company sets "Verified with work email" on Me, the public profile and the found-person view; other domains wait for an admin on /admin/companies. Migration 0033, export version 18. After Testing Run 4 (T53 to T57, T62, T66): only the domain of a company CareerMetro verified, under the employer's name, passes without an admin; Find people hides staff by name containment or initials and by any confirmed code for the current job. Off in production until the email sender exists. See `docs/plans/current-job-check-plan.md`.
- **Platform**
  - RLS on every table (#112). Hardening H1–H12 except H7 (`dev/engineering-standards.md`).
  - The app sends its own email (work-email codes) through Resend over HTTPS, `src/lib/email/send.ts`, once the key is in; an unsent code is spent and the person told to try again (launch readiness item 11, 2026-10-16).
  - Review carry-overs 3 to 6 (pending-items.md) are closed: the `gap_analyses` profile index, AI spend reserved before the call, and the rating route tests were already in; `npm run eval:explain` now checks the explain-gaps prompt (no invented quotes, the matcher's hours, no exclamation marks), with its scoring tested in CI without the API (2026-10-17). After Testing Run 4 (T61, T70): a quote counts as invented only when it is in nothing the model was given (role title, every gap); hour ranges and decimals are read; the report names the models that answered; over-long words fail the run; no key fails rather than skips.
  - Rate-limit windows over two days old are deleted by the daily cleanup, not by a random hit, which had made the daily-limit tests flaky when test files ran in parallel (2026-10-16).
  - Every e2e axe check runs through one helper that first waits for the page title, because a server action's refresh can leave `<title>` empty for a moment; two of the three helpers skipped that wait, which flaked `me-certifications-held` on #158 (2026-10-17).
  - WCAG 2.2 AA and phone-speed pass on every screen, with the `line-strong` token for control edges (#138). See `docs/dev/a11y-audit-2026-10-13.md`.
  - The ATS openings feed runs monthly (#127). 437 free resource links (#129; batch 5 added 13, 2026-10-20).
- **Launch:** draft `/privacy` and `/terms` behind the preview gate until the legal adviser approves them. The launch-day checklist with rollback is `docs/dev/launch-day.md`.
- **Switched off until keys arrive:** sign-in (preview uses a test user; with the Supabase values it opens by emailed code, and "Continue with Google" shows only once `GOOGLE_SIGNIN=1` is added, 2026-10-19), company sign-up, join and re-check codes and the current-job check (need `RESEND_API_KEY` and `EMAIL_FROM`, `dev/email-sender-steps.md` step 6, plus `NAME_HASH_KEY`), find-people, phone sharing, and photo and certificate upload.
- **Merged since the last refresh (2026-10-20), facts in each plan file**
  - Network, FR-49, parts 1 to 3 (#165 to #167, migration 0034, `docs/plans/network-plan.md`). Guided resume builder, FR-36 (#169, migration 0035; Download PDF or DOCX through the confirm step, #179; `docs/plans/resume-builder-plan.md`).
  - Elite, FR-50: the plan switch (#170, 0036), the question bank and timed test (#171, 0037), the mock interview (#173, 0038) and the Library's Elite shelf (#174). Own-written questions and shelf items are `reviewed: false`, so production hides them until checked (Project manager to arrange).
  - Library, FR-51: part 1 (#172) and part 2, Save, finished, rides, reports, suggestions and `/admin/library` (#185, 0041, `docs/plans/library-part-2-plan.md`).
  - v44 gap list (`docs/plans/v44-gap-list.md`): Today No resume (#175), links instead of "soon" (#176), Settings privacy and Blocked people (#177), Departures paste box and role interview prep (#178), job search switch and notice period, FR-52 (#180, 0039), Life line links and Match's open jobs (#181), Network Report, filters and In common (#182), Arrivals calendar file, Offers and Language (#183), Me editing, FR-53 (#188, 0042).
  - Live Departures, FR-25: the daily public ATS feed (#184, 0040), dead boards dropped (#186), the board check workflow (#187), 147 boards (#189), and caps of 300 boards and 10,000 open posts (#194). `docs/plans/departures-live-plan.md`.
  - In-app notifications, FR-54 (#190, 0043; no email). Mock follow-ups part 1 (#191, 0044; follow-ups `followUpsReviewed: false`, so production asks none). Settings columns, FR-55 (#192, 0045, export version 31).
  - Today live cards: Signal check, Departures board, On your line (#193; the Signal check is hidden in production until its questions are reviewed). Tracks, FR-56 (#195; draft tracks `reviewed: false`, the chip stays plain text in production).
  - Hardening (#196, `docs/plans/hardening-pass.md`): `hardening:` e2e steps for #175 to #193 (keyboard, axe light and dark after a reload, 390 px fit) and focus fixes; Life line marks read what they draw.
  - Launch readiness (#197, no migration, `docs/plans/launch-readiness-pass.md`): `docs/launch/prod-smoke.md`, the scripted production check to run right after Milin's redeploy; RLS and FK indexes confirmed on 0039 to 0045 and `rls.test` refuses policies and grants; Account settings saves capped at 100 a day and Unblock at 50. Supabase's Confirm signup template also needs `{{ .Token }}`.
  - Performance pass (#198, migration 0046 `job_posts_open_newest`, `docs/plans/perf-pass.md`): Today, Map and Departures read the analysis once and run independent reads in parallel; the goal sync on every view is what's left.
  - Refused sign-in codes logged (#199): `auth_email_code_send_refused` and `auth_email_code_verify_refused` with Supabase's error code and status only, never the email or the code.

## In progress

- Goal sync skip (branch `v44-goalsync`, `docs/plans/goal-sync-skip-plan.md`): a Today or Map view first works out the sync's plan from one read-only snapshot with no lock, and skips the write transaction when it would add, change or link nothing. Nothing is stored, so no migration and no export change; the clock, content, track and proof changes are all re-read every view. DB tests in `src/lib/goals/store.test.ts`; not yet run (no node_modules here).

## Next up

The Project manager's queue of 2026-10-15 is done: launch readiness (c) 6 and 7, Practice (#145), Match (#143) and the report removal tools (#146). Detail for each is in `dev/launch-readiness.md`, `dev/practice-match-plan.md` and `docs/plans/reports-review-plan.md`.

Open, all waiting on someone else:
1. Pending item 1, post-upload issues: Testing has no open upload defects (2026-10-15). It needs Milin's details.
2. Launch readiness (c) 6, full alerts: needs a log drain on Milin's Vercel account. The 6-hourly smoke check runs meanwhile.
3. The 95 practice questions are self-checked only; an expert review is still owed (Data research).
4. The 48 timed-test questions in `src/content/mock-bank.json` (Elite part 2) need checking by people who work in the roles; until then `reviewed` stays false and production shows no timed test. The same goes for the Elite shelf's 2 playbooks and 2 drill sets in `src/content/elite-shelf.json` (part 5).

Handover (2026-10-15 18:25 UTC): "Development 3" took over from Development 2 for T44.

Waiting: the end of Milin's name-search message ("city or …"); photo and certificate upload (storage keys); Market live data (Data research); Find people DB-side ranking (1,000 opt-ins or `find_scan_capped`, `dev/companies-find-me-plan.md`).

Elite (pending items 10 and 20) is approved as C15 (Milin, 2026-10-19, prototype v44); no billing in the beta.

Numbers: the next migration is **0046**. `EXPORT_VERSION` (31) lives in `src/lib/account/export.ts`. The latest FR is FR-55 (FR-36 filled a number that was never used).

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

- **Keys register:** `docs/secrets.md` names every key and secret, where it lives and whether it can be changed, with no values. Its section 4 is what a move away from Vercel involves, including setting `VERCEL_ENV=production` on the new host.
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
