# CareerMetro status

This page lists facts only, each with a PR or doc link. Read it first. Update it in 2–3 lines at the end of every task, in the same PR. How to work is in `.claude/skills/careermetro-dev/SKILL.md`.

Last updated: 2026-10-15 (Practice step, `/practice`).

## Built and live (https://careermetro.vercel.app)

- **Job seeker**
  - Resume, Gaps, Path, Today, Map, Life line, Departures, Me and public profile, account settings 1–2, Inbox part 1, and resume download (PDF and Word). See `docs/REQUIREMENTS.md`.
  - 29 role profiles, "one of these" skill groups, certificate dates, and "Closest to your resume". See `docs/plans/`.
  - Pasted-job check (#109–#117). Nearby lines (#123). Market with example data (#125, #130). AI-ready resume check (#126).
- **Proof**
  - Certificate proof (#109, #110) and profile certifications with the Credly check (#132).
  - A Credly link fills a goal only after the check (#135, migration 0029).
  - The held-proof review screen `/admin/proofs`, FR-44 (#137).
- **Admin:** report review `/admin/reports` with the IT Rules deadlines, FR-45 (`docs/plans/reports-review-plan.md`). Report notes are kept, as the privacy notice will say (launch-readiness item 8).
- **Employer:** Corporate steps 1–7 (#113–#122), Express apply (#133), "Let companies find me" (#128; found chats count on the Corporate tab and Overview, and an unverified company counts none, #139), and the company-side and security fixes (#131, #134, #136). See `dev/corporate-plan.md`.
- **Platform**
  - RLS on every table (#112). Hardening H1–H12 except H7 (`dev/engineering-standards.md`).
  - WCAG 2.2 AA and phone-speed pass on every screen, with the `line-strong` token for control edges (#138). See `docs/dev/a11y-audit-2026-10-13.md`.
  - The ATS openings feed runs monthly (#127). 424 free resource links (#129).
- **Launch:** draft `/privacy` and `/terms` behind the preview gate until the legal adviser approves them. The launch-day checklist with rollback is `docs/dev/launch-day.md`.
- **Switched off until keys arrive:** sign-in (preview uses a test user), company sign-up and join, find-people, phone sharing, the email sender, and photo and certificate upload.

## In progress

- Nothing.

## Next up

Project manager's queue (2026-10-15), in order:
1. Launch readiness (c): 6 is part done (6-hourly smoke check; full alerts need a log drain on Milin's account). 7, the upload load test, is `.github/workflows/load.yml` (`e2e/load-upload.mjs`: a burst of 40 and 2 a second for 60 s, 15 s stand-in parses, pool of 5). First run: all 160 uploads parsed with no "crowded" answer and other pages stayed at p95 7 ms. It found 6 connections from two module copies of the pool, so `src/db/index.ts` now keeps one pool per process on globalThis. Items 3, 4, 5, 10 and 12 are done or drafted. See `dev/launch-readiness.md`.
2. Practice step: built as `/practice` (FR-21 to FR-23, handoff 12h): goal skills with 5 bank questions each (`src/content/practice-questions.json`, 95 questions over 19 skills: 15 from Data research, 4 data-analyst skills by Development; v1 self-checked only, no expert review yet), feedback in words from prompts/practice-feedback/v1, 10 a day, self-rated confidence on Me (private). Migration 0030 (`practice_answers`, kept 30 days), `EXPORT_VERSION` 16. See `dev/practice-match-plan.md` "Practice build notes".
3. Match step: built as `/match` (FR-24, handoff 12i approved 2026-10-15), no AI and no migration. Linked from the avatar menu and the Map's Match stop; the step line no longer says Soon for Match. Path hours are the stored step's, else the Gaps hours table. See `dev/practice-match-plan.md` "Match build notes".
4. Pending item 1, post-upload issues: Testing has no open upload defects (2026-10-15). It waits on Milin's details.

Waiting: T44 and the Reports removal tools (Milin's cards); photo and certificate upload (storage keys); Market live data (Data research); Find people DB-side ranking (1,000 opt-ins or `find_scan_capped`, `dev/companies-find-me-plan.md`).

Waiting on design: the Elite version (pending items 10 and 20). Only "Your plan" (proto v33) is drawn, and there is no billing in beta. Nothing gets built until the design thread has the screens approved.

Numbers: the next migration is **0031**. `EXPORT_VERSION` lives in `src/lib/account/export.ts`. The latest FR is FR-45.

## Decisions log (newest first)

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
- **Milin, decisions:** the T44 card; whether the report tool may remove a message or suspend a person's account (`docs/plans/reports-review-plan.md`); the Junction intermediary compliance question (pending item 15); formal approval of the Market design.
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
