# CareerMetro status

This page is the current state only: read it first, then the one plan file the task needs. At the end of every task, change it in 2–3 lines in the same PR. Facts carry a PR or doc link. Everything this page held up to 2026-10-31 (each merged feature, test-run fix and feed change, word for word) is in [`docs/plans/status-history-2026-10.md`](plans/status-history-2026-10.md). How to work is in `.claude/skills/careermetro-dev/SKILL.md`.

Last updated: 2026-10-31 (tech gap batches TG2 to TG4: 36 roles with feed rules; drafted lines awaiting sign-off are marked SIGN_OFF)

## Live (https://careermetro.vercel.app)

- **Job seeker:** Resume, Gaps, Path, Today, Map with the Life line, Departures with My jobs (phases 1 and 2: tracker, prepare for a job, interview dates, share from the phone, weekly email), Me and the public profile, Settings, Inbox, Network, Library, Practice, Match, Mock and the Elite shelf, Market (live counts from the Departures feed), the guided resume builder and resume download (PDF and Word), the pasted-job check, Nearby lines, Not for me (FR-48), Add a pitstop (FR-58), change of destination (FR-59, C25), On your line (FR-60), Timetable PRs 1–6 with hand-entered events and the empty state for uncovered fields (T181). Requirements: `docs/REQUIREMENTS.md`; detail per feature in `docs/plans/`.
- **Content:** 279 role profiles (all `reviewedBy` null, awaiting domain-expert review; batches up to B5 and TG4), 178 certificates (`reviewed: false`), 311 eval resumes, the practice and mock banks (follow-ups `followUpsReviewed: false`, so production asks none; the timed test and Elite shelf stay hidden in production until reviewed).
- **Proof:** certificate proof with the Credly check, held-proof review `/admin/proofs` (FR-44); only proof fills a goal.
- **Employer:** Corporate steps 1–7, Express apply, "Let companies find me", Find people (T44), verified current job by work email (FR-47).
- **Admin:** `/admin/reports` with removal tools (FR-45, FR-46), `/admin/library`, company review, event suggestions (kept as `pending` only).
- **Platform:** RLS on every table; hardening H1–H12 except H7; the daily Departures feed over `src/content/job-boards.json` (279 boards of the 300 cap, `FEED_LIMITS`); feed health in `job_feed_boards`, `/api/health` and the 6-hourly smoke; app email through Resend; CI e2e walk plus the max-data oversize check (T150).
- **Switched off until keys arrive:** real sign-in (preview uses a test user; emailed code with the Supabase values, Google once `GOOGLE_SIGNIN=1`), company sign-up, join and re-check codes and the current-job check (`RESEND_API_KEY`, `EMAIL_FROM`, `NAME_HASH_KEY`; `dev/email-sender-steps.md`), find-people, phone sharing, and photo and certificate upload. `/privacy` and `/terms` are drafts behind the preview gate until the legal adviser approves them.

## In progress

- Scale check (`docs/scale-check.md`, `.github/workflows/scale.yml`, CI Postgres only): 10,000 synthetic members, page p95 budget 2.5 s, crons at 80% of maxDuration. Open: the events digest may never reach people behind opted-in members with no event that week.
- CSP: the host allow-list policy is report-only (`src/proxy.ts`, `src/lib/csp.ts`); the walk prints `CSP: none` or each violation. Enforcing waits on the log drain and on Milin (`docs/dev/security-sweep-2026-10-20.md`).
- Expert review pack (pending item 27): `node scripts/review/build-review-pack.mjs` writes `docs/review/pack/`; every role, certificate and question above waits on it.
- Departures boards: 279 boards. The last two candidates (RISA Labs, Currencies Direct, Greenhouse EU) failed the 2026-10-31 board check with network errors (#308), so none were added; new boards wait on Research.

## Queue (all waiting on someone else)

1. Pending item 1, post-upload issues: Testing has no open upload defect; needs Milin's details.
2. Launch readiness (c) 6, full alerts: needs a log drain on Milin's Vercel account.
3. Expert review of the practice questions, the timed-test questions (`src/content/mock-bank.json`), the Elite shelf (`src/content/elite-shelf.json`), the role profiles and the certificates (Data research to arrange).
4. Milin: T89's feed database role; item 45 (AI first interview, not built until he answers); the end of his name-search message ("city or …"); storage keys for photo and certificate upload; formal approval of the Market design; the Junction compliance question (pending item 15); change of destination (FR-59) was built on the Project manager's call and his answer is pending.
5. Find people DB-side ranking waits on 1,000 opt-ins or `find_scan_capped` (`dev/companies-find-me-plan.md`).
6. Check the share target on a real Android phone (My jobs PR 5, #250).

## Plans awaiting review

- Proof confirmed by a manager or colleague (`docs/plans/proof-confirm-plan.md`) and the on-camera skill check (`docs/plans/on-camera-check-plan.md`): parked until Milin decides reviewer pay and Supabase Pro and a lawyer advises (his pending items 31 and 32). Nothing is built.

## Numbers

The next migration is **0059**. `EXPORT_VERSION` is 39 (`src/lib/account/export.ts`). The latest FR is FR-60.

## Standing rules for a fresh thread

- Decisions in force: `CLAUDE.md` (founding decisions, 2026-10-06) and the decisions log in the history file (only proof fills a goal; two gap layers; Credly links fill a goal only after the check; reversible report tools; companies never see people whose current job is there; one PR per feature, one review pass, push once; Development merges its own PRs after one review and green CI).
- Next 16 differs from the Next you know; read `node_modules/next/dist/docs/` first. Client-rendered dates go through `src/lib/day-words.ts`, never Intl or toLocale* (the client-bundle test checks it).
- Thread containers can't reach `registry.npmjs.org`, so CI is the npm check. CI logs are readable only through the GitHub MCP `get_job_logs` with `return_content`.
- CI's database is unseeded and test files run in parallel against one database: tests must not rely on seeded rows, delete shared fixtures, or compare two reads of shared tables (the catalog) outside one snapshot.
- e2e: check the FAIL lines and the exit code. The local walk needs `NAME_HASH_KEY=e2e-only-name-hash-key` (as in CI), or the corporate steps fail. Wait for hydration (`networkidle`) before clicking right after a `goto`.
- New job boards go through the Departures board check (manual workflow over `scripts/departures/board-candidates.csv`) before `job-boards.json`; only Greenhouse, Lever, Ashby and SmartRecruiters public boards; never LinkedIn, Naukri or other portals.
- Keys: `docs/secrets.md` names every key with no values; never ask for keys in chat. Accounts to fix before real users: `docs/stack.md`.
- `/mnt/project-files` sometimes gives I/O errors; write to `docs/` and copy across later. Worktrees are locked (`git worktree remove -f -f`); `.claude/` is in git's local exclude file (`git add -f`). The Project manager deletes merged remote branches.
- Vercel Hobby allows 100 deploys a day; working branches (`claude/`, `feature/`, `fix/`, `dependabot/`, `data/`) make no deployment, so push once per PR.

## Recent

- Small fixes (2026-10-31): /design's React #418 came from dates written with Intl on both sides of hydration (Node's and the browser's ICU can differ, e.g. "Sept" against "Sep" on the example applicants); client-rendered dates now use `src/lib/day-words.ts`, guarded by a client-bundle test, and the walk's untick waits for hydration and the save. The `mapLineFor` test compares its two reads inside one repeatable-read snapshot. Dead boards ashby/cartesia and lever/employ removed (279). This page cut from 94k characters to the current state.
