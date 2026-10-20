# Launch-readiness pass (v44, 2026-10-20)

Development, branch `v44-launch-check`, from origin/main at 7031c0e (#195). The goal is a quick production switch-on once Milin says "redeployed". No migration is needed: the RLS and index audit found no gap a migration would fix. Next free migration: **0046** (unchanged).

What this pass changed:
- `docs/launch/prod-smoke.md`, the scripted check a person runs right after the redeploy, with the pre-flight settings list. A copy goes in the project files at `dev/prod-smoke.md`.
- Two missing write limits, with database tests: Account settings saves (`LIMITS.settingsSavesPerUserDay`, 100 a day) and Unblock (`LIMITS.unblocksPerUserDay`, 50 a day).
- `src/db/rls.test.ts`: the migrations create no policy and grant nothing to anon or authenticated, `pg_policies` is empty for the public schema, and the twelve v44 tables are each created and secured.

## 1. Row level security and foreign-key indexes, migrations 0039 to 0045

The repo's pattern since #112 is RLS on with **no policies**. The app reaches Postgres only as the table owner from the server, so Supabase's API roles (anon, authenticated) get nothing. Every table below follows it. "FK index" means an index whose first column is the foreign-key column (what `src/db/indexes.test.ts` checks).

| Migration | Table | New? | RLS on | Policies | FK columns, and the index that covers each | Tests that cover it |
|---|---|---|---|---|---|---|
| 0039 | user_settings | columns only | yes (re-stated) | none | no new FK | rls (file + DB) |
| 0040 | job_posts | yes | yes | none (no owner: feed rows) | none | rls, indexes |
| 0040 | job_saves | yes | yes | none (owner-only in the store) | user_id: PK (user_id, job_post_id); job_post_id: `job_saves_job_post` | rls, indexes |
| 0040 | job_feed_runs | yes | yes | none | none | rls |
| 0040 | user_goals | index only | already on | none | `user_goals_skill_status` (not an FK) | indexes |
| 0041 | resources | column only | already on | none | none | rls |
| 0041 | user_resources | yes | yes | none | user_id: PK; resource_id: `user_resources_resource` | rls, indexes |
| 0041 | resource_reports | yes | yes | none | resource_id: `resource_reports_resource`; user_id: `resource_reports_user`; decided_by: **none, on purpose** (admin, never queried by, set null only when an admin's account goes) | rls, indexes (`unindexedOk` lists it) |
| 0041 | resource_suggestions | yes | yes | none | user_id: unique (user_id, url); skill_id: `resource_suggestions_skill`; decided_by: **none, on purpose** (as above) | rls, indexes (`unindexedOk`) |
| 0042 | me_roles | yes | yes | none | user_id: `me_roles_user_start` | rls, indexes |
| 0042 | me_education | yes | yes | none | user_id: `me_education_user` | rls, indexes |
| 0042 | stories | yes | yes | none | user_id: `stories_user_updated`; goal_id: `stories_goal` | rls, indexes |
| 0042 | story_boxes | yes | yes | none | story_id: PK (story_id, box) | rls, indexes |
| 0042 | user_interests | yes | yes | none | user_id: PK (user_id, name_key) | rls, indexes |
| 0043 | notifications | yes | yes | none | user_id: `notifications_user_created`; actor_id: `notifications_actor`; connection_request_id, application_id, interview_id: one index each | rls, indexes |
| 0044 | mock_answers | columns only | yes (re-stated) | none | no new FK | rls |
| 0045 | user_settings, applications | columns only | yes (re-stated) | none | no new FK | rls |

Coverage:
- `src/db/rls.test.ts` reads every migration file. Each created table must have `ENABLE ROW LEVEL SECURITY`, and nothing may disable it. New in this pass: no `CREATE POLICY` and no grant to anon, authenticated or public; the v44 tables are named. On the test database it checks that every public table has RLS and, new, that `pg_policies` is empty.
- `src/db/indexes.test.ts` checks every foreign key in the migrated database against `unindexedOk`, both ways. It already covers the v44 tables: CI runs it on a freshly migrated database.
- `src/db/migrations.test.ts` keeps every v44 migration expand-only. All seven pass it without a contract marker.
- `scripts/check-rls.mjs` runs after each production migration in the Migrate database workflow and fails it if a public table lacks RLS.

Findings: none blocking. The two unindexed `decided_by` columns are deliberate and documented. If the v44-perf branch adds indexes on them, it must also take them off `unindexedOk`, because the test fails on a stale entry.

## 2. Server actions and route handlers changed since #175

From `git diff 1992402^ origin/main` (#175 to #195). "Write" means it changes the database. "Limit" means a `takeShared(LIMITS.…)` count, in the action or in the store it calls, inside the write's transaction unless noted.

| File | Action or route | PR | Write? | Limit |
|---|---|---|---|---|
| `today/actions.ts` | `answerSignalCheck` | #193 | yes (ticks the signal task) | `signalAnswersPerUserDay` (100) |
| `today/actions.ts` | `chooseTrack` | #195 | yes (`trackId` on the analysis) | `trackChangesPerUserDay` (20), in `tracks/store` |
| `departures/actions.ts` | `saveDepartureAction`, `stageDepartureAction` | #184 | yes (`job_saves`) | `departureChangesPerUserDay` (200), in `departures/store` `change()` |
| `library/actions.ts` | `libraryMarkAction` | #185 | yes (`user_resources`) | `libraryChangesPerUserDay` (300) |
| `library/actions.ts` | `reportResourceAction` | #185 | yes (`resource_reports`) | `resourceReportsPerUserDay` (10) |
| `library/actions.ts` | `suggestResourceAction` | #185 | yes (`resource_suggestions`) | `resourceSuggestionsPerUserDay` (5) |
| `admin/library/actions.ts` | `decideResourceAction`, `decideSuggestionAction` | #185 | yes | none: admin only (`ADMIN_EMAILS`, checked in the proxy and the action), as on /admin/proofs and /admin/reports |
| `me/actions.ts` | `saveMeRole`, `deleteMeRole`, `saveMeEducation`, `deleteMeEducation`, `saveStory`, `deleteStory`, `addInterest`, `removeInterest` (`…Action`) | #188 | yes | `meEditsPerUserDay` (100), in `me/edit-store` `change()`, which all eight call |
| `notifications/actions.ts` | `openNotificationsAction` | #190 | yes (marks rows read) | `notificationReadsPerUserDay` (300) |
| `mock/actions.ts` | `saveFollowUpAnswerAction` | #191 | yes (overwrites one answer's follow-up) | none needed: own open session only, under its lock, overwrites one row by position, sessions capped by `mockSessionsPerUserDay` (5) and a 10 or 20 minute window, as `saveMockAnswerAction` |
| `mock/actions.ts` | `endMockInterviewAction` (now takes follow-ups) | #191 | yes, plus one model call | `mockFeedbackPerUserDay` (5) and `MOCK_DAILY_BUDGET_USD` |
| `settings/job-search-actions.ts` | `switchJobSearch`, `saveNotice` | #180 | yes (`user_settings`) | `jobSearchChangesPerUserDay` (20), in `job-search/store` |
| `inbox/actions.ts` | `saveUsuallyFreeAction` | #192 | yes (`user_settings.usually_free`) | `availabilityPerUserDay` (30) |
| `network/actions.ts` | `reportFromNetwork` | #182 | yes (`reports`) | `inboxReportsPerUser` (20) |
| `network/actions.ts` | `searchPeopleByName` (filters added) | #182 | no | `networkSearchesPerUserHour` (30) |
| `network/actions.ts` | `unblockFromNetwork` | #177 | yes (deletes a `blocks` row) | **was none; added** `unblocksPerUserDay` (50), in `unblockPerson`, test in `network/store.test.ts` |
| `settings/actions.ts` | `saveSettings` (unchanged file; its store `saveAccountSettings` changed in #177 and #192) | #177, #192 | yes (`users`, `user_pay`, `user_settings`, and a `consents` row each time "Let companies find me" turns on) | **was none except username saves; added** `settingsSavesPerUserDay` (100), test in `account/settings-store.test.ts` |
| `api/cron/cleanup/route.ts` | `GET` | #184, #185, #190 | yes (deletes old rows) | none needed: `CRON_SECRET` bearer only |

The other surfaces these PRs added write nothing. The Arrivals calendar file (#183) is built in the browser. "Saw a role somewhere else?" (#178) posts to the existing `/api/job-checks`, which has its per-person daily cap (`JOB_CHECK_LIMITS`). `/departures?role=` (#181) and the role prep (#178) are reads.

Outside this window, for the record: `blockFromNetwork` / `blockPerson` has no limit, but it is idempotent per pair (`onConflictDoNothing`), so its rows are bounded by the number of people. With unblock now capped, a block-and-unblock loop is capped too. `setFindMe` (Network's "Let people find me") predates #175 and writes no consent row.

## 3. Things only Milin can do before the smoke check

These are the pre-flight table in `docs/launch/prod-smoke.md`, section 0, in launch-day order:
1. Hash keys, then the Supabase sign-in values, then the Supabase SMTP (Resend), then `ADMIN_EMAILS`, then last `TODAY_PREVIEW=1`. Redeploy once.
2. Check both Supabase email templates, **Magic Link** and **Confirm signup**, show `{{ .Token }}`. A brand-new address gets Confirm signup; the steps file named only Magic Link.
3. The GitHub `CRON_SECRET` secret matches Vercel, so the smoke workflow's parse check passes.

Noted, not changed (auth is out of scope for this pass): the app logs nothing when Supabase refuses to send or verify a code (`src/lib/auth/server.ts`, `sendEmailCode` and `verifyEmailCode`). On launch day the only trace is Supabase's own auth logs. An event name with the Supabase error code, and no email, would make a launch-day failure visible in Vercel. It is worth a small follow-up PR.
