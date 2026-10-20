# Live Departures and Today's live cards: plan (v44 gap items 40, 42, 8, 9, 10)

Development, 2026-10-20. Source: handoff sections 5 and 8, `dev/departures-plan.md` (Milin, 2026-10-10), the v44 prototype and the CLAUDE.md decisions. Pre-approved by the Project manager under Milin's delegation on one condition: roles come only from pasted job descriptions, hand-written role profiles and the public job-board APIs of Greenhouse, Lever, Ashby and SmartRecruiters. No scraping.

Two PRs. PR 1 is the feed, the tables and Departures (items 40 and 42). PR 2 is Today's Signal check, Departures board and On your line (items 8, 9 and 10).

## What the person sees

- **Departures header**: "Roles from public company job boards and posts you paste. Apply on the company's site, or in one tap with Express apply where the company takes it." On the right is "Updated 19:42 · N roles", where the time is the last good feed run in IST and N is the open roles shown. If no run has finished in 36 hours it reads "Updated {date}".
- **The board**: real feed roles replace `exampleJobs` for signed-in people. The "Example roles for now…" note goes. Signed-out preview keeps the example data and its banner.
  - Each row shows the role, company, city or Remote, work type, the experience note when the post states one, "posted {n} days ago", readiness in words ("Ready now", "One gap away", "Your destination"), "You have" and the gaps. Each gap names the goal that closes it.
  - With no resume, rows show without fit. The existing `noFit` line stays: "Your fit for each role shows here once real roles come from company job boards." Its new wording is "Add your resume to see your fit for each role."
- **Apply on company site** opens the post's own URL in a new tab (`noopener noreferrer`), then asks "Did you apply?" Yes records Applied, and the tracker moves through Applied, Heard back, Interview and Offer. "I didn't apply" clears it.
- **Saved and Applied** tabs read the person's own rows. The saved toast is "Saved." and the removed toast "Removed from saved." Empty Saved: "Nothing saved yet. Tap the bookmark on anything you want to come back to."
- **A role that leaves its feed** drops off All. In Saved and Applied it stays, with "Closed on the company's board" and no Apply button.
- **Today (PR 2)**:
  - Departures board, "roles you're heading toward": up to 5 rows of open feed posts grouped by role and city ("Junior data analyst · Pune · 12 posts"), ordered by gaps left. 0 gaps reads "Boarding now", otherwise "After N goals". It links to All departures, and is hidden with no resume or with job search off (job-search-plan).
  - Signal check: one multiple-choice question a day for the skill of the current goal, or the next goal if the current one has none. Answering ticks the day's signal task. No score is shown. If no reviewed question exists for that skill or the next one, the card is hidden and the ride shows no signal task.
  - On your line right now: "{n} people are on the {goal} goal with you." On the first day it reads "started this line this week, like you." Up to 4 initials, then +N. The tip block is left out, because there are no tips yet. "See people" opens /network and "Ask on Junction · soon" stays. The card is hidden when n < 3.
  - The Today banner's "example data" wording is dropped for the cards that are now real.

## Data (migration 0040, export version 26)

- **`src/content/job-boards.json`**, not a table: `{company, ats, token, careersUrl, addedBy, addedOn}`. `ats` is one of `greenhouse`, `lever`, `ashby` or `smartrecruiters`. It changes only by PR (Milin or a domain expert adds boards; there is no discovery). A Zod schema and a test cover the file. The first list is India-hiring boards taken from `scripts/jd-mining/boards.json`.
- **`job_posts`** (new):
  - Columns: id, ats, board_token, external_id, url (https only), title (2–160), company (1–80), city (1–60, "Remote" allowed), work_type, experience_note (≤ 40), role_slug (null when no live role matches), required_skill_ids text[], nice_skill_ids text[], posted_at, first_seen_at, last_seen_at, closed_at.
  - Indexes: unique (ats, board_token, external_id); (closed_at, role_slug); (role_slug, city) where closed_at is null.
  - No post text is stored, only skill ids found by code.
- **`job_saves`** (new, owner-only):
  - Columns: user_id → users (cascade), job_post_id → job_posts (cascade), saved_at null, stage smallint null (1–4: Applied, Heard back, Interview, Offer, with a check), applied_at null, updated_at. PK (user_id, job_post_id); index job_post_id (FK).
  - A row with neither saved_at nor stage is deleted, not kept.
- **`job_feed_runs`** (new): id, started_at, finished_at, boards_ok, boards_failed, posts_open, posts_closed. Index (finished_at). Rows over 90 days old are deleted by the daily cleanup.
- **`user_goals`** gets a new index (skill_id, status), for the On your line count.
- RLS is enabled with no policies on all three tables, like every table, and the server reads through the owner-scoped stores.
- **Retention**:
  - posts closed more than 180 days ago are deleted with their saves (the same 180 days a company keeps access);
  - open posts are never purged while still in the feed.
- **Export v26** adds `departures: [{title, company, city, url, saved_at, stage, applied_at, closed}]`.
- **Deleting an account** removes its `job_saves` by cascade. Posts belong to no one.
- `job_descriptions` stays for now (the export reads it). Dropping it is a later contract migration.

## Server checks and limits

- **Feed job**: `scripts/departures/fetch-feeds.mjs` in a GitHub Actions workflow `departures.yml`, daily at 01:00 UTC (06:30 IST). It writes with `DATABASE_MIGRATION_URL`, as the link check does, and adds no new key.
  - One GET per board per day, through the public APIs only: Greenhouse boards-api, Lever v0 postings, Ashby posting-api and SmartRecruiters v1 postings.
  - The user-agent is "CareerMetro jobs (careermetro.vercel.app)". Each request times out after 15 s, and a 4xx or 5xx skips that board with a `last_error` in the run summary.
  - It keeps posts located in India or listed as remote-India, matching `INDIA` from `mine.mjs`, moved to `src/lib/departures/feed-rules.mjs` and shared.
  - It upserts by external id and closes rows not seen in this run. A board whose fetch failed closes nothing.
  - Caps: 300 boards, 500 posts a board, 10,000 open posts in all (raised from 150 and 5,000 on 2026-10-20; 144 boards ran in about 75 seconds). Above that the newest are kept.
- **Skills are read by code, not the model**: the role comes from the title (`classify` from `mine.mjs`) and the skills from the taxonomy aliases (`hasSkill`).
  - A skill counts as required when it appears under a requirements-style heading ("Requirements", "What you'll need", "Must have"). Under "Nice to have", "Preferred" or "Bonus" it is nice to have.
  - With no headings, every skill found in the post counts as required.
  - A post with fewer than 2 skills found is kept, with no fit shown ("Fit not shown: the post names too few skills we know").
- **Fit**: `postingRole()` from `src/lib/jobs/groups.ts` runs through the same plain-code matcher as the pasted-job check, against the person's latest confirmed profile and goals. Nothing about the person leaves the server, and no AI call is made, so `ai_calls` is untouched.
- **Saves**:
  - `saveRole`, `setStage` and `clearStage` take Zod-checked input and are scoped to the session user.
  - A closed post can't be newly saved or applied to, but its stage can still move.
  - Rate limit: 200 save or stage changes a day per person (`shared-limit`).
- **Signal check**:
  - The question is picked by `hash32(userId|indiaDay)` from the reviewed choice questions of `mock-bank.json` for the goal's skill. Production shows `reviewed: true` only.
  - The answer is checked on the server. It ticks the existing signal task in `ride_days`, and the pick itself is not stored.
- **On your line**:
  - It counts other people with an active goal on the same skill who have "Let people find me" on and are not deleting their account, suspended, blocked either way or the viewer.
  - Initials are shown only for those people.

## Choices made

1. Feed posts are read by deterministic code, not by `parse-jd` (that departs from departures-plan's "parse once per post"). This keeps the model to resumes and explanations, and needs no Anthropic key in Actions.
2. Workable is dropped: it is not one of the four ATS APIs in the PM's condition.
3. The board list is a reviewed JSON file, not a `job_sources` table with an admin page. It's one PR per change, and it's auditable in git.
4. Post text is not stored or shown. People read the post on the company's site.
5. "Updated HH:MM" is the last successful run's finish time, not the time the page was read.
6. Pasted posts stay in the existing job checks (item 41). `job_saves` covers feed posts only. Saving CareerMetro's own postings waits.
7. The Signal check uses the timed-test choice questions (`kind: "choice"`). Practice's bank questions are open questions, so they can't be answered in one tap. Until people in the role review the questions, production hides the card.
8. On your line counts only people with "Let people find me" on, with a floor of 3 to protect privacy. The tip block waits for Junction.
9. Closed posts are kept 180 days, so Applied history survives a role leaving its board.
10. Applying on the company site asks "Did you apply?" rather than marking Applied on the click.

## Not in this plan

- The saved-role "one gap away" alert, which waits for notifications part 2 (`notifications-plan.md`, later events).
- "Open to" defaults, a radius filter, freelance work proof and tracks on posts.
- Arrivals listing company-site applications.
- Pasted posts on the board (item 41).

## Tests

- Zod schemas first: the board file, `jobPostRow`, `saveInput`, `stageInput` and the export v26 shape.
- Feed rules against saved sample responses in `fixtures/feeds/` (one per ATS, synthetic). Covered: India and remote filtering, the heading split, caps, a failed board closing nothing, and a post leaving the feed closing.
- DB:
  - saves are per user, and another user's are never readable;
  - stage 1–4 only;
  - a closed post stays in Applied;
  - the 180-day purge removes saves;
  - account deletion cascades;
  - the FK index is present (`indexes.test.ts`).
- The On your line count excludes people who are opted out, blocked or suspended, and hides below 3. The Signal check pick is stable within a day and changes the next.
- e2e: save and apply on Departures, reload, see both tabs. The header shows Updated. Today's three cards show with seeded posts. axe checks in light and dark at phone width.
- `/design`: board rows with live data, a closed row, and the hidden-card states.

## Choices made while building (PR 1, branch `v44-departures-live`)

1. This branch is PR 1 (items 40 and 42) with all of migration 0040, including the `user_goals (skill_id, status)` index PR 2 needs, so the schema changes once. Today's Signal check, Departures board and On your line (items 8, 9 and 10) are PR 2 and are not built here.
2. SmartRecruiters' public v1 list answer has no description, and the plan allows one GET a board, so its posts carry only the skills in the title and mostly show "Fit not shown". One GET returns at most 100 posts. The first board list (`src/content/job-boards.json`, 47 boards) has no SmartRecruiters board, since `scripts/jd-mining/boards.json` has none; Workable stays out.
3. Experience reads as the post states it ("2 to 4 years", "5+ years"), from the highest stated minimum, and only when /market's `experienceBand` finds years, which skips company blurbs ("founded 30 years ago").
4. The place is the first Indian city the location names (`placesOf` from `market.mjs`), "Remote" for a remote post whose location says India, and "India" when it names no city. A remote post that doesn't say India is left out.
5. Work type comes from the board's own words: part time is Part time; contract, freelance or temporary is Freelance; anything else, and every Greenhouse post (its API has no field), is Full time.
6. "Too few skills" counts required skills: a post with fewer than 2 shows no fit, so nice-to-haves alone never read as "Ready now".
7. The page sends the newest 300 open posts, plus every post the person saved or applied to, open or closed.
8. Fit: a skill with current accepted proof counts under "You have". The row's chips show missing and weak only, so an outdated skill shows as weak.
9. "Updated" is the finish time of the last run that read at least one board. A run where every board failed is recorded and fails the workflow, so someone looks.
10. A board taken off the list closes its open posts on the next run. A board whose fetch failed closes nothing.
11. The workflow writes only from the default branch, with the existing `DATABASE_MIGRATION_URL` secret, which reaches only the database-check and write steps. Without it, a scheduled run posts a notice and skips the rest; a manual run does a dry run that reads the boards and prints counts.
12. The signed-in page with no resume says "Add your resume to see your fit for each role." With a resume whose skills aren't confirmed it asks to confirm them, and when fit can't be read it says so. The signed-out "no resume" example keeps the prototype's wording in the detail panel.
13. Every save or stage try counts toward the 200 a day. Taking a closed post off Saved still works.
14. The signed-out banner now says the roles and the fit are examples, and what signing in shows.
15. The caps (500 a board, 5000 in all) never close a live post. Every post read before the caps counts as seen and is never closed, and a board the caps cut was still read whole, so it closes posts no longer on it (T79, 2026-10-20). Only a failed board or one whose answer was cut short (a full SmartRecruiters page) closes nothing that run.
16. SmartRecruiters is read one page (`limit=100`) without paging. A full page, or a `totalFound` above what came back, counts as cut short, so that board closes nothing.
17. A board answer is fetched with `redirect: "error"`, and one that ends anywhere but https is refused.
18. `?role=` filters the live board too, the person's own saved and applied posts included.
19. The board tokens could not be checked by GET from the build container, because its network refuses the ATS hosts. They are the jd-mining list as it was.
20. Candidate boards are checked before they are listed: `departures-boards-check.yml` (manual, no secrets, `contents: read`) runs `scripts/departures/check-boards.mjs` over `scripts/departures/board-candidates.csv`, through the feed's own request and post rules, and uploads the boards with status 200 and at least one India post as `job-boards.json` entries (`addedBy` "Data research (checked by the board check)"). Adding them is still a reviewed PR. A Greenhouse board on the EU host carries `"host": "eu"` (boards-api.eu.greenhouse.io, job-boards.eu.greenhouse.io); a token keeps its case, and only an Ashby token may hold a dot, never two in a row or at an end.
