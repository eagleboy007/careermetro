# Junction: the community board (plan)

Date: 2026-10-21. Pending item 15 (Milin, 2026-10-08, comment on the line-view mock). Development's plan, **waiting on Milin's approval**: it changes the data model and makes CareerMetro an intermediary for user posts, so CLAUDE.md asks for a plan first. Nothing here is built. FR-57 in REQUIREMENTS is written in part 1, once this plan is approved.

Sources: pending-items.md item 15; handoff section 12 ("Junction and Network (later)"), section 13 (`interests`, `user_interests`) and section 14 decision 4; the mock `post-login-home-fable-v1.html` (Junction view, its rail, and "On Junction" on Arjun's profile); FR-35, FR-45 and FR-46 (reports, the IT Rules deadlines, removal tools); `src/app/grievances/page.tsx` and `src/lib/grievance.ts`; network-plan.md, notifications-plan.md, me-editing-plan.md and reports-review-plan.md.

**Legal note.** This plan is not legal advice. Every timing, category and retention period below is Development's reading of the Information Technology (Intermediary Guidelines and Digital Media Ethics Code) Rules, 2021 as amended, and each is marked **(lawyer to confirm)**. The Rules have been amended several times (2022, 2023, and further changes have been notified or proposed since), so a lawyer must confirm the current text before Junction reaches real users. The code keeps every deadline and retention period in one constants file, so a correction is a one-line change.

## Not in this plan

- Images, video or file uploads in posts. Photo upload is switched off app-wide, and text only removes the worst risks (intimate images, child sexual abuse material, screenshots of job portals with other people's data). A later plan can add images once moderation has run for a while.
- Threaded replies. Comments are one level under a post; a comment can't be replied to as a thread (people can mention a name in plain text).
- One-way Follow, unless Milin chooses it (open decision 3). Network ruling 1 (2026-10-19) said no Follow.
- Direct sharing to WhatsApp or other apps, public (signed-out) posts, and search-engine indexing. Junction is signed-in only and `noindex`.
- Polls, events (Timetable is its own feature), groups, and paid or sponsored posts. No ads, no promoted posts, no affiliate links.
- Email notifications (in-app only; email waits on `RESEND_API_KEY` as everywhere else).
- AI moderation or AI-written posts. No model call anywhere in Junction (open decision 9 asks whether to add a classifier later).

## 1. Scope, and what ships in which part

### What a person can do

- **Post** one of four kinds: **Idea**, **Question**, **Win**, **Resource** (the mock's type buttons).
  - A title (5 to 140 characters) and a body (up to 2,000 characters), plain text, line breaks kept, no markdown rendering.
  - **Post to:** "My route" (the person's target role, on by default when they have one) and/or up to 3 interests. At least one of the two, so every post has an audience.
  - **Resource** posts carry one link (required for Resource, optional for the others, at most one per post). If the link matches a Library catalog item (`linkKey`), the post shows the catalog card (title, source, kind, hours) as in the mock.
  - **"Show where I am on my line"** (off by default): attaches the person's current goal as ids ("Step 6 of 9 · Automate a log check in Python · proof task done" in the mock). It is drawn from live rows on read, never stored as text, and it never shows a gap list.
  - Edit within 30 minutes of posting (marked "Edited"); after that, delete only. Delete is a soft delete (section 3) and the post disappears for everyone at once.
- **Upvote** a post (toggle; no downvotes in v1). A comment can also be upvoted (the mock shows "9 votes" on a comment). Nobody can vote on their own post or comment.
- **Comment** on a post (1 to 1,000 characters). The author of a comment can delete it.
- **Reshare** a post (toggle, no note in v1). A reshare puts the post into the resharer's connections' Following feed with "Asha reshared". You can't reshare your own post.
- **Save** a post (private toggle; a Saved tab under "Your posts").
- **Pin** up to 3 of your own posts to your profile (`/u/[handle]` and Me's "On Junction" section).
- **Report** every post and every comment (section 2).

### Feeds (tabs on `/junction`)

| Tab | What it shows | Order |
|---|---|---|
| **Top this week** (default) | Posts from the last 7 days | Top score (section 3), then newest |
| **New** | All posts | Newest first |
| **My route** | Posts whose route is the viewer's target role | Newest first |
| **Following** | Posts and reshares by the viewer's connections (open decision 3) | Newest first |
| **My interests** | Posts tagged with any of the viewer's interests; a chip row filters to one interest | Newest first |

- Every feed hides: hidden or deleted posts, posts by suspended or deleting accounts, anyone the viewer blocked or who blocked the viewer, and posts held for review (except to their author).
- 20 posts a page, "Show more" with a keyset cursor (no offset paging).
- **My route** needs a target role (the role of the person's newest analysis, the same `analysesOf` rule Network's "Aiming for my role" uses; a sample resume aims at nothing). Without one, the tab says "Add your resume to see posts from people aiming for the same role", with a link to Today. Tracks (FR-56) are unreviewed in production, so the route is the role only; a track filter is later. The mock's "0 to 4 years" band is left out (open decision 8).

### Interests

- Interests are anything a person wants to learn or talk about (AI, design, marketing, public speaking), not only their job.
- Today they are free text per person in `user_interests` (migration 0042; Me, the Life line's Interests row, "In common with you"). me-editing-plan.md choice 5 said "A shared `interests` table waits for Junction". This plan adds it (section 3) and links each `user_interests` row to it, so Me, the Life line and Network keep working unchanged.
- The rail's "Your interests" card (with Edit and the "Add an interest, e.g. Photography" box) writes the same rows as Me, through the same store and caps (30 per person).
- A post's interest tags come from the shared table. Typing a new one creates it (same name rules as Me: 1 to 40 characters, no contact details or links).
- The Library's "Your interests" tab and Timetable can use the same table later; they are not changed here.

### Parts (one PR each, in order)

1. **Data and rules**: migration 0048, Zod schemas, stores, ranking, limits, export, account delete, tests. No screens. FR-57 in REQUIREMENTS.
2. **Moderation first**: Report on posts and comments, `/admin/reports` for posts and comments, hide and the removal record, the author's notice and appeal, the reporter's outcome notice, terms and privacy drafts. Still no public screens: the admin side ships before anyone can post.
3. **Junction screens**: `/junction` with the composer, feeds, post detail, the rail, `/design` entries, the e2e walk. Behind `JUNCTION_ENABLED` (off in production).
4. **Profile and notifications**: pins on Me and `/u/[handle]`, the "Junction posts" profile switch, the new notification kinds, the Today "On your line right now" tip (`src/lib/today/live.ts` says it waits for Junction).
5. **Launch switch** (only after open decision 1 and the lawyer's sign-off): name the grievance officer in `src/lib/grievance.ts`, take `/grievances` out of the preview gate, publish the terms and privacy changes, turn on `JUNCTION_ENABLED`. Docs and config only.

## 2. India's IT Rules 2021: what Junction must do

Once members post, CareerMetro hosts third-party content and is an intermediary under the IT Act, 2000 and the IT Rules 2021. Below is what Development reads the Rules to require, and how the app meets each duty. **All of it is for a lawyer to confirm** before part 5. CareerMetro is far below the 50 lakh (5 million) registered-user threshold for a "significant social media intermediary" (rule 4: chief compliance officer, nodal contact, resident grievance officer, monthly reports), so those extra duties are not planned; a lawyer should confirm that too, and we should know when we approach it.

### 2.1 A named grievance officer (open decision 1)

- Rule 3(2)(a) needs the name and contact details of a Grievance Officer published prominently on the website or app, with how to complain **(lawyer to confirm)**.
- `/grievances` already exists, with a placeholder name and `grievance.officer@careermetro.com` (`src/lib/grievance.ts`, `placeholder: true`). It sits behind the preview gate until a real officer is named.
- **Who the officer is is Milin's decision. This plan names nobody.** Before part 5: a real person's name, a mailbox that a person reads every day, and the page out of the preview gate. A test in part 5 fails the production build if `JUNCTION_ENABLED` is on while `GRIEVANCE_OFFICER.placeholder` is true.
- The officer needs `/admin/reports` access (ADMIN_EMAILS). If the officer is not a developer, they need a short runbook (part 5: `docs/launch/grievance-runbook.md`).

### 2.2 Deadlines on a complaint (lawyer to confirm)

These already drive `src/lib/admin/report-deadlines.ts` and the Grievances page. Junction reuses them unchanged, and adds new reasons with their own deadlines.

| What | Deadline in the app | Rule (Development's reading) |
|---|---|---|
| Acknowledge any complaint | 24 hours | Rule 3(2)(a)(i) |
| Resolve any complaint | 15 days | Rule 3(2)(a)(i) |
| Act on a request to remove content in the rule 3(1)(b) categories (harassment, hate, misleading, unlawful and the rest) | 72 hours | Rule 3(2)(a)(i) proviso, added in 2022 |
| Remove or disable content that shows a person nude, partly nude or in a sexual act, or impersonates them (including morphed images), on a complaint by that person or someone for them | 24 hours | Rule 3(2)(b) |
| A court order or a government notice under rule 3(1)(d) | 36 hours in the 2021 text; **reported to have been shortened by later amendments** | Rule 3(1)(d) |
| Information asked for by an authorised government agency | 72 hours in the 2021 text; may have changed | Rule 3(1)(j) |

- **Timings may have moved.** Development understands that amendments since 2023 may shorten some of these windows (for example for government orders, and for intimate-image complaints). The app's numbers must be checked against the Rules as they stand at launch. Each number lives in `report-deadlines.ts` (and a new `ORDER_DEADLINE_HOURS` for orders), so a change is one line plus the Grievances page copy.
- **Acknowledgement**: filing a report shows "We have your report. Reference R-4F2K. We act by 22 Oct, 5:30 pm IST." and adds an in-app notification with the same reference. That is an acknowledgement within seconds. The admin's Acknowledge step stays, as the human one. Whether an automatic acknowledgement satisfies rule 3(2)(a) is **for the lawyer**; if not, the 24-hour human acknowledgement is already tracked.
- **Court and government orders** are not reports from the app. Part 2 adds "Log a complaint or order" on `/admin/reports`: the admin records an emailed complaint, a court order or a government notice (who sent it, received at, the post or comment ids, a reference), which starts the right clock and lands in the same queue. Without this, emailed complaints to the officer have no record and no deadline.
- **Overdue view**: `/admin/reports` sorts by the nearest deadline and marks overdue rows in words ("Overdue by 3 h"). There is no pager or SMS: the daily cron is the only scheduled job on Hobby. Admins get an in-app bell notification on every new Junction report (section 4). Meeting a 24-hour window still needs a person to look at least once a day, every day, including weekends (risk 1).

### 2.3 Categories that must be removed fast

- Rule 3(1)(b) lists what users must be told not to post. Development's summary: content that belongs to someone else without a right to it; obscene, pornographic or paedophilic content; content invasive of another's privacy, including bodily privacy; insulting or harassing on the basis of gender; racially or ethnically objectionable; harmful to a child; infringing a patent, trademark or copyright; knowingly false or misleading information, or information the government's fact-check unit flags (that part's status is contested, **lawyer to confirm**); impersonation; threats to the unity, integrity, defence, security or sovereignty of India, public order or friendly relations with foreign states; malware; online games not permitted under the Rules; and anything that breaks any law in force. **The exact list must be copied from the Rules by the lawyer** into the terms.
- The Report panel's reasons, for posts and comments (new reasons marked new; existing ones keep their deadlines):

| Key | Label | Act within |
|---|---|---|
| `intimate_or_impersonation` | Nudity or sexual content of a person, or someone pretending to be someone | 24 h |
| `child_safety` (new) | Harmful to a child, or sexual content involving a child | 24 h, and the post is held from feeds at the first report |
| `harassment` | Harassment, threats or bullying | 72 h |
| `hate` (new) | Hate or attacks on religion, caste, gender, race or region | 72 h |
| `privacy` (new) | Someone's personal details (phone, address, documents) | 72 h |
| `money_or_otp` | Asking for money, OTP or payment | 72 h |
| `fake_or_spam` | Fake job, scam or spam | 72 h |
| `misleading` (new) | False or misleading information | 72 h |
| `copyright` (new) | Copies someone else's work | 72 h |
| `other` | Something else | 15 days |

- Child sexual abuse material may carry a duty to report to the police or a portal under POCSO and the IT Act, and must not be deleted before it is preserved. **Lawyer to confirm** the reporting duty and route; the plan keeps the removal record (section 2.7) and adds a runbook line. With text-only posts this is unlikely, but the reason must exist.

### 2.4 Report on every post and comment

- Every post card, post detail and comment has a "More actions" menu with **Report** (as in the mock). The same Report panel as the Inbox and Network: reason, optional note (500 characters), "The person you report is not told who reported them."
- One open report per reporter and target. Reports share the existing `inboxReportsPerUser` limit (20 a day per person across the app), so the grievance queue can't be flooded from Junction.
- Reports from accounts under 24 hours old still count (a victim may make an account just to report) but don't trigger the auto-hold in section 2.5.
- Signed-out people can't see Junction, so they complain through the officer's email, logged as in 2.2.

### 2.5 The moderation queue (reuses `/admin/reports`)

- `REPORT_TARGETS` gains `post` and `comment`. `/admin/reports` shows them with the other reports, oldest deadline first: the post's title and body or the comment's text (admin only, never logged), the author as first name and last initial, the route and interest tags, the counts, and "Open in Junction".
- Actions on a post or comment row, built like FR-46's Hide message: **Hide** (needs a reason, 1 to 500 characters, and a rule picked from the reason list, which the author's notice quotes), **Unhide**, and the existing **Suspend account**. Each writes one audit line (`junction_post_hidden`, `junction_post_unhidden`, `junction_comment_hidden`, `junction_comment_unhidden`). Neither closes the report; the admin then picks Action taken or Dismiss, as today.
- **Auto-hold** (until an admin decides; it is a hold, not a removal, and the author sees "Held for review"):
  - a `child_safety` report holds the post or comment at once;
  - three open reports from three different accounts, each at least 7 days old, hold it.
  - Holds can be weaponised, so they are reviewed first in the queue, and the admin's Dismiss lifts the hold. Open decision 6.
- **Pre-moderation of first posts**: open decision 2. If Milin says yes, a new account's first 2 posts wait in a "New posters" list on `/admin/reports` until an admin approves them; the author sees "Waiting for a quick check, usually within a day".
- The "Hidden and suspended" list on `/admin/reports` gains hidden posts and comments.

### 2.6 The author's notice, and an appeal

- When a post or comment is hidden, its author gets an in-app notification: "Your post "{title}" was hidden after a report. Reason: {rule label}." (the title is read live from the row, never stored in the notification). The author still sees the post on their own view with a banner: "Hidden by CareerMetro on 21 Oct after a report. Reason: Harassment, threats or bullying. Others can't see it." and **Appeal**.
- **Appeal**: one per removal, a note (1 to 1,000 characters), within 30 days of the notice. It lands on `/admin/reports` under "Appeals" with a 15-day deadline (treated as a grievance). The decision is Upheld (stays hidden) or Reversed (shown again), with a reason, an audit line, and a notification to the author. If more than one admin exists, a different admin from the one who hid it decides (the app warns when it is the same person; with one admin in the beta it can't be enforced).
- After the decision, the notice repeats what the Grievances page says: if they disagree, they can appeal to the Grievance Appellate Committee within 30 days at gac.gov.in (rule 3A) **(lawyer to confirm)**.
- A suspension already shows `/account/suspended` with the reason and the officer's contact (FR-46). Its copy gains "You can appeal by writing to the grievance officer."
- **The reporter** gets an in-app notification when their report is closed: "We looked at your report from 21 Oct. We hid the post." or "...We didn't find a rule break." This was waiting for the email sender in reports-review-plan.md; the in-app bell now covers it for every report target, not only Junction.
- Rule 4(8)'s prior notice and hearing is a significant-intermediary duty, so it isn't required here **(lawyer to confirm)**, but the notice and appeal above are good practice and cheap.

### 2.7 Records of removed content

- Rule 3(1)(g): when an intermediary removes or disables content, it preserves the content and associated records for 180 days for investigation, or longer if a court or authorised agency asks **(lawyer to confirm the period)**. Rule 3(1)(h): registration information is kept for 180 days after an account is cancelled or withdrawn **(lawyer to confirm)**.
- So a hide, a court-ordered removal, or a deletion of a post that has an open report writes a **removal record** (`junction_removals`, section 3): a copy of the title, body, link and tags, the author's user id and username at the time, the post's timestamps, the reports' ids, the rule, who removed it and when. It has no foreign key to the user, so it outlives account delete. The daily cleanup deletes it 180 days after removal unless `legal_hold` is set (an admin sets it when an order asks for longer).
- **Conflict to flag for the lawyer:** account delete (FR-3) removes everything 30 days after the request. Rule 3(1)(h) may require keeping registration details for 180 days after an account is withdrawn. This is not new to Junction (the Inbox has the same question), but Junction makes it real. The plan keeps only the removal records past 30 days; the lawyer decides whether a minimal account record (id, name, email, sign-up and deletion dates) must also be kept for 180 days, and the privacy notice must say so either way (DPDP Act section 8(7) allows keeping data a law requires).

### 2.8 Terms and privacy updates (drafts, behind the preview gate until the lawyer approves)

- `/terms` gains a **Junction rules** section: the rule 3(1)(b) list in plain words (copied from the Rules by the lawyer), the house rules from the mock (be specific; no personal data, yours or anyone else's; no recruiter spam or paid promotions; report anything off), what we do (hide, suspend, keep records 180 days), how to appeal, the grievance officer and the GAC.
- Rule 3(1)(c) asks intermediaries to tell users of their rules at least once a year and on any change **(lawyer to confirm)**. So the first visit to the composer shows the Junction rules with "I'll follow these rules", stored in `consents` (purpose `junction_rules`, the policy version). A new version asks again, and a yearly reminder asks again 12 months after the last one.
- Rule 3(1)(a) asks for the rules in English or a language in the Eighth Schedule, and the 2022 amendment speaks of the user's language **(lawyer to confirm whether Hindi is needed at launch)**.
- `/privacy` gains: what Junction stores (posts, comments, votes, saves, reshares, pins, interests), who sees what (section 4), that votes and saves are private (only counts show), that removed content and its records are kept 180 days (or longer on an order), that reports and appeals are kept as grievance records, and what account delete does to posts.

## 3. Data model (migration 0048, expand only)

The highest existing migration is `drizzle/0047_job_check_role_source.sql`, so this is **0048** (`drizzle/0048_junction.sql`). Every new table: `ENABLE ROW LEVEL SECURITY` with no policies (the server reads as the table owner; `src/db/rls.test.ts` checks it). Every foreign key gets an index (`src/db/indexes.test.ts`), except admin-id columns, which are listed there as before.

### New tables

**`interests`** (shared tags)
- `id uuid pk`, `name text` (as first written, 1 to 40), `name_key text` (lowercase, trimmed, single spaces: `interestKey`), `created_by uuid → users (set null)`, `created_at`, `hidden_at timestamptz`, `hidden_by uuid → users (set null)`, `hidden_reason text`.
- Unique `name_key`. Index `created_by`. Checks: name and key lengths 1 to 40, hidden reason 1 to 500 when set, `(hidden_at is null) = (hidden_reason is null)`.
- A hidden interest (an admin hides an abusive tag) disappears from chips, the rail and pickers, and its posts lose that tag on read.
- Seeded with about 40 common interests (AI, Data, Design, Marketing, Public speaking, Writing, Finance, Product, Photography and so on) so the picker isn't empty.

**`user_interests`** (existing, extended)
- Adds `interest_id uuid → interests (cascade)`, nullable in 0048. The migration inserts one `interests` row per distinct `name_key` (the earliest `name`), then fills `interest_id`. Index `interest_id`. The store writes both from part 1. A later contract migration makes it not null; the PK stays (`user_id`, `name_key`), so nothing that reads interests today changes.

**`junction_posts`**
- `id uuid pk`, `author_id uuid not null → users (cascade)`, `kind text` (`idea` | `question` | `win` | `resource`), `title text`, `body text`, `link_url text`, `link_host text`, `resource_id uuid → resources (set null)` (when the link matches the catalog), `route_slug text` (the author's role at posting time, or null), `goal_id uuid → user_goals (set null)` (the "where I am" line, null unless chosen).
- `upvote_count int default 0`, `comment_count int default 0`, `reshare_count int default 0`, `top_points int default 0` (denormalised, section "Top").
- `status text default 'visible'` (`visible` | `pending` (pre-moderation) | `held` (auto-hold) | `hidden` (admin)), `hidden_at`, `hidden_by uuid → users (set null)`, `hidden_reason text`, `hidden_rule text` (a report reason key).
- `created_at`, `edited_at`, `deleted_at` (soft delete by the author).
- Checks: kind in the list; title 5 to 140; body 0 to 2,000; link only https and at most 500 characters; `kind <> 'resource' or link_url is not null`; `route_slug is not null or` the post has a tag (enforced in the store, since a check can't see another table; the check covers `route_slug` length); status in the list; `(status = 'hidden') = (hidden_at is not null)`; hidden reason 1 to 500 when set; counts never below 0.
- Indexes: `author_id, created_at desc`; `resource_id`; `goal_id`; `hidden_by` (or listed as an admin id); partial `created_at desc where status = 'visible' and deleted_at is null` (New); partial `route_slug, created_at desc` with the same where (My route); partial `top_points desc, created_at desc where status = 'visible' and deleted_at is null` (Top).

**`junction_post_interests`**
- `post_id → junction_posts (cascade)`, `interest_id → interests (cascade)`. PK (`post_id`, `interest_id`). Index (`interest_id`, `post_id`) for My interests. At most 3 per post (store).

**`junction_comments`**
- `id`, `post_id → junction_posts (cascade)`, `author_id → users (cascade)`, `body` (1 to 1,000), `upvote_count`, `status` (`visible` | `held` | `hidden`), the same hidden columns, `created_at`, `deleted_at`.
- Indexes: `post_id, created_at`; `author_id`; `hidden_by` (admin id). Checks as for posts.

**`junction_votes`** (posts) and **`junction_comment_votes`**
- `user_id → users (cascade)`, `post_id` or `comment_id` (cascade), `created_at`. PK (`user_id`, `post_id`); index on `post_id` (the PK covers `user_id`). Same for comments.

**`junction_reshares`**
- `user_id → users (cascade)`, `post_id → junction_posts (cascade)`, `created_at`. PK (`user_id`, `post_id`), index (`post_id`), index (`user_id`, `created_at desc`) for Following.

**`junction_saves`**
- `user_id`, `post_id`, `created_at`. PK (`user_id`, `post_id`), index (`post_id`). Private: no count is stored or shown.

**`junction_pins`**
- `user_id → users (cascade)`, `post_id → junction_posts (cascade)`, `position smallint` (1 to 3), `created_at`. PK (`user_id`, `post_id`), unique (`user_id`, `position`), index (`post_id`). The store checks the post is the user's own.

**`junction_removals`** (the records kept under rule 3(1)(g))
- `id`, `target text` (`post` | `comment`), `target_id uuid` (no FK), `author_user_id uuid` (no FK, so it outlives the account), `author_username text`, `snapshot jsonb` (title, body, link, tags, created and edited times), `rule text`, `cause text` (`report` | `order` | `author_deleted_reported`), `removed_by uuid → users (set null)`, `removed_at`, `order_ref text`, `legal_hold boolean default false`, `purge_after timestamptz` (removed_at + 180 days).
- Indexes: `target, target_id`; `purge_after where legal_hold = false`; `removed_by` (admin id). Checks: target and cause in their lists; `order_ref` up to 200.
- Read only by `/admin/reports` and the export of that author (their own content). Never logged.

**`junction_appeals`**
- `id`, `user_id → users (set null)` (the record outlives the account, like reports), `removal_id → junction_removals (cascade)`, `note` (1 to 1,000), `status` (`open` | `upheld` | `reversed`), `decided_by → users (set null)`, `decision_reason` (1 to 500 when decided), `created_at`, `decided_at`.
- Unique (`removal_id`) (one appeal per removal). Indexes: `user_id`; `status, created_at`; `decided_by` (admin id). Checks: status list; `(status = 'open') = (decided_at is null)`.

**`grievance_intake`** (complaints and orders logged by an admin, section 2.2)
- `id`, `source` (`email` | `court_order` | `government_notice` | `other`), `received_at`, `from_label` (who sent it, 1 to 200, admin-only), `reference` (up to 200), `target`, `target_id`, `report_id → reports (set null)`, `logged_by → users (set null)`, `created_at`. Indexes on `report_id`, `logged_by`. A logged complaint also creates a `reports` row (reporter null), so it is in the one queue with its clock.

### Changed tables and enums

- `report_target` enum gains `post`, `comment`; `report_reason` gains `child_safety`, `hate`, `privacy`, `misleading`, `copyright`. `ALTER TYPE ... ADD VALUE` can't be used in the same transaction it is added in, so 0048 only adds the values and nothing in 0048 uses them (`src/db/migrations.test.ts` checks).
- `reports` gains `reference text` (the "R-4F2K" shown to the reporter; unique, made from the id) and `decide_by timestamptz` (stored at filing so an order's deadline and a later change to the rules don't move old reports). Index `decide_by where status = 'open'`.
- `notifications` gains `post_id → junction_posts (cascade)`, `comment_id → junction_comments (cascade)`, `report_id → reports (cascade)`, `appeal_id → junction_appeals (cascade)`, each indexed; the kind and refs checks are rewritten for the new kinds (section 4).
- `user_settings` gains `show_junction_posts boolean default true` (the profile part switch) and `junction_rules_version text` (the last accepted version; the consent row is the record).

### Soft delete and hide

- The author's delete sets `deleted_at` and the post leaves every feed at once. Its comments, votes, reshares, saves and pins stay attached but unseen. The daily cleanup hard-deletes posts and comments deleted over 30 days ago (cascade), except that a post with an open report is first copied into `junction_removals` (`cause = author_deleted_reported`) so a complaint isn't defeated by deleting.
- A hide (admin) sets `status = 'hidden'` and writes a removal record. Nothing is hard-deleted by a hide; Unhide restores it. A hidden post's text is swapped in SQL on every read except the author's own view, the admin's review and the author's export, as FR-46 does for messages.

### Top: counts and the ranking formula

- Counts are denormalised on the post and comment rows and updated in the same transaction as the vote, comment, reshare or delete, under a row lock on the post (`select ... for update`), so two votes at once can't lose a count. The daily cleanup recomputes counts for posts from the last 8 days and logs `junction_counts_fixed` with a number if any were wrong.
- `top_points = upvotes + 2 × comments + 3 × reshares`, where only votes, comments and reshares by people other than the author count, and a person's several comments on one post count once (the comment insert checks for an earlier visible one by the same person).
- **Top this week** = visible posts from the last 7 days ordered by `top_points` desc, then `created_at` desc. No time decay inside the week: "Top this week" means what it says, it is easy to explain on the page ("Votes, comments and reshares from the last 7 days"), and it is deterministic. If old posts stick at the top as volume grows, a later change can divide by `(age in hours + 2) ^ 1.5`; the index then moves to a computed read.
- Votes from accounts under 24 hours old, suspended or deleting accounts are removed from the counts (a deleting account's votes go at purge; a suspension's are left, since it is reversible, but a suspended voter can't add more).

### Zod schemas to write first (`src/lib/schemas/junction.ts`, with tests before the stores)

- `postInput` (strict): kind, title, body, link (through `cleanSuggestedUrl`: https only, no IP, localhost, user name, port or shortener, tracking parameters dropped), `toRoute: boolean`, `interestIds` (0 to 3 uuids) plus `newInterests` (0 to 3 names), `showGoal: boolean`; a refinement that at least one audience is chosen and that Resource has a link. Text refusals: email addresses and phone numbers (`hasContactDetails`), and links in the title or body (`hasLink` with scheme or `www.`; bare domains are allowed as words, never turned into links).
- `postEditInput`, `commentInput` (1 to 1,000, same text refusals, no links in comments in v1), `voteInput`, `reshareInput`, `saveInput`, `pinInput` (post id, position 1 to 3), `feedQuery` (tab, interest id, cursor), `junctionReportInput` (target post or comment, reason, note), `appealInput`, `hideInput` (reason 1 to 500, rule), `appealDecisionInput`, `intakeInput`.
- Views (strict): `postCardView` (no author email, no user id of anyone but the viewer's own flag; author as name, handle, initials, route label only if the author shows it), `commentView`, `feedPage` (posts, next cursor), `railView`, `adminPostReportView`, `removalNotice`, `appealView`.
- Constants in `src/lib/schemas/constants.ts`: kinds and labels, lengths, caps, the rate limits below, `JUNCTION_RULES_VERSION`, `REMOVAL_KEEP_DAYS = 180`, `APPEAL_WITHIN_DAYS = 30`, `EDIT_WINDOW_MINUTES = 30`.

## 4. Routes, pages, components, notifications, limits, privacy, export and delete

### Routes and pages (all under `src/app/(app)/junction`, signed in only, `noindex`)

- `/junction?feed=top|new|route|following|interests&interest=<id>`: the composer, the feed tabs, the list, "Show more", and the rail (Your posts: posts, votes, reshares; Your interests with Edit and Add; On your route this week: the 5 most used interest tags on route posts this week, with counts; House rules, with "Reports are acknowledged at once and acted on within the times on the Grievances page" and a link to `/grievances`, replacing the mock's "Settings page").
- `/junction/p/[id]`: one post with all its comments (20 at a time), the comment box, and the same actions.
- `/junction/mine?tab=posts|comments|saved`: "See your posts and comments", with pins and any hidden notices and appeals.
- Server actions in `src/app/(app)/junction/actions.ts`: `createPost`, `editPost`, `deletePost`, `toggleVote`, `toggleCommentVote`, `addComment`, `deleteComment`, `toggleReshare`, `toggleSave`, `setPin`, `reportJunction`, `appealRemoval`, `acceptJunctionRules`. Each: signed in, not suspended, Zod-checked, rate-limited, the user id from the session only.
- Admin actions in `src/app/(app)/admin/reports/actions.ts`: `hideJunction`, `unhideJunction`, `decideAppeal`, `logIntake`, `setLegalHold`, `approvePending` (if pre-moderation), `hideInterest`.
- Nav: `NAV.junction.built` becomes true when `JUNCTION_ENABLED` is on (desktop top nav and the phone tab bar already list it).
- Store: `src/lib/junction/` with `store.ts` (writes), `feed.ts` (reads), `rules.ts` (pure: who may see, top points, text checks), `moderation.ts`, `fixtures.ts`, `types.ts`. Reads reuse the Network's `reachable` and block rules.

### Components (each on `/design` with example data, light and dark)

`JunctionComposer` (type buttons, Post to chips, the "where I am" switch, the rule line "Posts show your name and handle. No phone numbers, email addresses or screenshots."), `FeedTabs`, `PostCard` (vote column, author line, kind tag, interest tags, title, body, resource card, goal line, top comment, actions), `VoteButton`, `CommentList`, `CommentBox`, `ReshareButton`, `SaveButton`, `PostMenu` (Report, Edit, Delete, Pin), `JunctionReportPanel` (the Inbox panel with the post reasons), `HiddenNotice` and `AppealForm`, `HeldNotice`, `JunctionRail`, `InterestPicker`, `JunctionRulesGate`, `PinnedPosts` (profile), `AdminJunctionRow`, `AppealRow`, `IntakeForm`, and empty states for each tab ("No posts on your route yet. Ask the first question.").

Design rules: cobalt only for progress, so Post, Upvote "on" and Save use `ink` and `line-strong`, not `accent`; kind and interest tags are neutral chips (red, amber and green stay for gap status); states in words; lucide icons at 1.75; 44 px targets; phone at 390 px with no horizontal scroll; no pop-up dialogs on phone (inline panels, as Network).

### Notifications (in-app only)

New kinds, each a one-line check change in `notifications`, sentence built live on read:

| Kind | Sentence | Opens |
|---|---|---|
| `junction_comment` | "{Name} commented on your post "{title}"." / "{Name} and 3 others commented..." (one unread row per post) | the post |
| `junction_hidden` | "Your post (or comment) was hidden after a report. Reason: {rule}." | `/junction/mine` |
| `junction_appeal_decided` | "We looked at your appeal. The post stays hidden." / "...It is back." | `/junction/mine` |
| `report_decided` | "We looked at your report from {date}. We hid it." / "...We didn't find a rule break." | `/grievances` |
| `report_filed` (admins only) | "New report: {reason}. Act by {time}." | `/admin/reports` |

No notification for votes, saves or reshares (noise, and a vote count is visible anyway). Nothing for the person's own actions.

### Rate limits and anti-spam (`LIMITS` in `src/lib/shared-limit.ts`, shared by every server)

- Posts: 5 a day per person. Comments: 50 a day. Post and comment votes: 300 a day together. Reshares: 30 a day. Saves and pins: 300 a day (the `LIBRARY_CHANGES_PER_DAY` level). Reports: the existing 20 a day. Appeals: 5 a day. New interests created: 10 a day (on top of the 30 per person cap).
- Duplicates: the same title and body from one person within 24 hours is refused ("You posted this already").
- New accounts: posting needs an account at least 24 hours old with a name; links need 7 days (open decision 7). Votes from accounts under 24 hours old don't count in Top.
- Links: one per post, through `cleanSuggestedUrl` (the 31 link shorteners in `src/lib/library/links.ts`, IP addresses, localhost, ports and user names refused, tracking and affiliate parameters stripped). Rendered with `rel="ugc nofollow noopener noreferrer"` and `target="_blank"`. The server never fetches the link (no server-side request forgery, no previews).
- Text: no email addresses or phone numbers in titles, bodies or comments (`hasContactDetails`), as the mock's rule line says.
- A suspended account can't post, vote, comment or report from Junction; its content leaves feeds at once.

### Privacy

- **No resume text in posts by default.** The composer starts empty; nothing from the resume, gaps or path is copied in. The "where I am on my line" line is off by default, shows only the goal's skill name and step number (read live), and never a gap list. A post never carries pay, notice period, phone, email or city.
- **A post shows** the author's name, @handle (if they have a username) and initials. The route label ("Cyber Security Analyst") shows only if the author has "Show target role" on. Everything else follows the profile's visibility when someone opens the author's profile.
- **Junction is visible to every signed-in member** (not public, not indexed). The composer says so: "Everyone signed in to CareerMetro can read your posts."
- **Votes and saves are private**: only counts show, never who. Reshares show the resharer's name only to their connections (Following).
- **Profile**: `/u/[handle]` and Me show "On Junction" with the pinned posts and "All N" (the mock), only when the viewer may open the profile and `show_junction_posts` is on. The strip's "N posts on Junction" follows the same switch.
- **Blocks**: neither person sees the other's posts or comments, and neither can comment on, vote on or reshare the other's posts.
- **Companies** never see Junction or a person's posts in v1 (no Corporate read path). Open decision 10.
- **Logs** carry event names, ids and counts only: never a title, body, comment, tag, link or search.

### Export (`EXPORT_VERSION` 32 to 33)

Adds `junction`: your posts (with text, tags, link, counts, status, and hidden notices), your comments, the post ids you voted on and saved, your reshares, your pins, your appeals and their decisions, your `junction_rules` consents, and your removal records' snapshots (it is your own content). Other people's comments on your posts are left out (their data); their count is included. Interests already export (v28); the `interest_id` is not added.

### Account delete (30-day rule, `src/lib/account/delete.ts`)

- On the request: the person's posts, comments, reshares and pins leave every feed at once (the "deleting" rule, like suspension), and their votes stop counting at the daily recount. Restoring within 30 days brings it all back.
- At purge (after 30 days): cascade removes their posts (with the comments, votes, saves, reshares and tags on them), their comments on others' posts, their votes, saves, reshares and pins. The purge recomputes counts on the posts it touched. Their `user_interests` go; `interests` they created stay (`created_by` set null). Reports they filed and appeals stay with the person set null (grievance records). Removal records stay until `purge_after` (section 2.7).
- Other people lose their comments on a deleted person's posts. The privacy notice says so. Open decision 11 offers keeping them under a "This post was deleted" stub instead.

## 5. Tests, the e2e walk, build order, risks and open decisions

### Tests

- **Schemas** (`junction.test.ts`, first): every input strict; title and body lengths; contact details and links refused; shorteners, IPs and http refused, tracking stripped; at least one audience; Resource needs a link; at most 3 tags; views carry no email or foreign user id.
- **Rules** (pure): `topPoints` (author's own actions excluded, one comment per person), feed visibility (hidden, held, pending, deleted, suspended, deleting, blocked either way), the edit window, the deadline per new reason, the auto-hold rule.
- **DB** (`src/lib/junction/store.test.ts`, `feed.test.ts`, `moderation.test.ts`): create, edit, delete, restore; counts under concurrent votes (two transactions); Top, New, My route, Following, My interests with fixtures and the keyset cursor; blocks; pins (only own, 3 at most, positions); interests backfill from 0042 rows and Me still reading the same names; hide writes a removal record with the snapshot and audit line, text swapped for others and kept for the author; unhide; appeal once, within 30 days, decided once; report reference and stored `decide_by`; intake creates a report; cleanup purges removals after 180 days but not under legal hold, hard-deletes old soft-deleted posts and keeps a reported one's copy; account delete and restore; export v33 shape; rate limits.
- **Migration**: `rls.test.ts`, `indexes.test.ts` (every FK indexed or listed), `migrations.test.ts` (enum values not used in the same migration, expand only).
- **Actions**: signed in only, suspended refused, the user id from the session, limits hit, admin actions for admins only.
- **Guard**: a test that `JUNCTION_ENABLED` with `GRIEVANCE_OFFICER.placeholder` fails the production config check.

### The e2e walk (added to the existing walk, with the `hardening:` checks)

1. Signed out, `/junction` goes to sign-in; signed in with the flag off, it is the not-found page.
2. Person A opens Junction: the rules gate, accepts; posts a Question to My route and the "AI" interest; a phone number in the body is refused first; a bit.ly link is refused.
3. Person B (same role) sees it on My route and New; upvotes (count 1), comments, saves, reshares. A sees the comment notification in the bell.
4. B adds "Design" in the rail; My interests shows the interest's posts; the chip filters.
5. A pins the post; B opens A's profile and sees "On Junction" with it; A turns off "Junction posts" and B no longer sees it.
6. B reports the post (Harassment); sees the reference and deadline; the admin sees it on `/admin/reports` with its deadline, hides it with a reason; B's feed no longer shows it; A gets the notice, sees the banner on `/junction/mine`, appeals; the admin reverses it; both get notifications.
7. A blocks B: neither sees the other's posts.
8. A deletes the post; it is gone from B's feeds.
9. Keyboard only through the composer, tabs, a post's actions and the report panel; axe in light and dark after a reload; 390 px with no horizontal scroll.

### Build order (small PRs, one review pass each, the full check before the single push)

1. **0048 and rules** (part 1): migration, schemas and their tests first, stores, ranking, limits, export v33, delete, cleanup jobs, FR-57 in REQUIREMENTS, STATUS. No screens.
2. **Moderation** (part 2): report targets and reasons, `/admin/reports` rows, hide and removal records, appeals, intake form, reporter and author notifications, `/account/suspended` copy, terms and privacy drafts, Grievances page reasons. `/design` for the admin rows.
3. **Screens** (part 3): `/junction`, `/junction/p/[id]`, `/junction/mine`, the composer and rail, `/design`, e2e steps 1 to 4 and 7 to 9.
4. **Profile and bell** (part 4): pins on Me and `/u/[handle]`, the profile switch, comment notifications, the Today tip, e2e steps 5 and 6.
5. **Launch switch** (part 5): only after decisions 1 and 4 and the lawyer's sign-off.

Nothing needs Vercel Pro: no new cron (the existing daily cleanup runs the recount and retention), no realtime, no queues, no edge config. No billing code, no scraping, no model calls.

### Risks

1. **The 24-hour windows need a person every day.** Hobby allows one daily cron and we have no email or SMS alert yet, so only the in-app admin bell and the queue warn of a report. If nobody opens `/admin/reports` for a day, we miss the deadline. The grievance officer (or a named backup) must check at least twice a day, weekends included. Email alerts come with `RESEND_API_KEY`.
2. **Legal timings may be out of date.** Amendments since 2023 may have shortened some windows. Mitigation: one constants file and a lawyer's check before part 5.
3. **Account delete versus retention.** The 30-day purge may conflict with rule 3(1)(h) (section 2.7). Needs the lawyer.
4. **Moderation load and brigading.** Auto-hold at three reports can be abused to silence people. Mitigation: only accounts 7 days old count, holds are reviewed first, Dismiss lifts them, and a pattern of false reports can lead to suspension.
5. **Spam and recruiter posts.** Limits, link rules, the account-age rules and pre-moderation (if chosen) cover the beta. A spam wave would still need manual work.
6. **Personal data in posts.** People will post screenshots-in-words, other people's names and job-portal details. The text check catches phone and email only; the `privacy` reason and the house rules cover the rest.
7. **Scale of the Top query.** Plain points over 7 days with a partial index is fine at beta scale. A few thousand posts a week would need the decay formula and a stored score.
8. **Enum changes.** `ALTER TYPE ... ADD VALUE` is not reversible; a reason removed later stays in the enum.
9. **Interest tags as an abuse surface.** Free-text tags are public. Mitigation: the same text checks as Me, a creation limit, and admin hide for a tag.

### Open decisions for Milin

1. **Who is the grievance officer?** A real person's name and a working mailbox read every day, published on `/grievances`. This plan does not name anyone. Also who is the backup when they are away. Junction can't go live without it.
2. **Pre-moderate first posts?** Option A: a new account's first 2 posts wait for an admin (safer, slower, more admin work). Option B: post at once, with the limits and reports above (recommended for the beta's size only if the officer can check twice a day; otherwise A).
3. **Following: connections or a new Follow?** Option A (recommended): Following shows your connections' posts and reshares, keeping Network ruling 1 (no Follow). Option B: add one-way Follow (the mock's profile has a Follow button), which reverses ruling 1 and needs its own table, limits and privacy rules.
4. **The lawyer.** Who reviews the IT Rules reading, the timings, the retention, the terms and privacy changes, and the POCSO question, and by when. Part 5 waits on it.
5. **The name.** "Junction" (fits the metro language and the mock), or Platform, Signal, Interchange. "Signal" is already used for the Signal check on Today, so it would confuse. Recommended: Junction.
6. **Auto-hold**: hold at the first `child_safety` report and at three reports from accounts 7 days old (recommended), or never hold without an admin.
7. **New-account rules**: 24 hours before posting and 7 days before links (recommended), or none.
8. **The experience band** in the mock's feed label ("0 to 4 years"): leave out (recommended), or add an experience filter to My route.
9. **Automated help for moderation**: none in v1 (recommended), or a model-based classifier later (it would need a prompt, `ai_calls` logging and a plan; the model would flag, never remove).
10. **Companies and Junction**: keep companies out of Junction in v1 (recommended), or let a verified company post (the employer side is next, but company posts change the risk and the rules).
11. **Comments on a deleted post**: delete them with the post (recommended, simpler), or keep them under a "This post was deleted" stub.
12. **Hindi**: publish the Junction rules in Hindi at launch, or English first (lawyer's answer to 2.8 decides).
13. **Free or Elite**: docs/REQUIREMENTS.md (section 12 Phasing, Later: Elite tier) lists "a community" as a paid Elite extra. This plan builds Junction free for everyone. If Milin approves that, update REQUIREMENTS in the same PR as part 1 (recommended: free, since a board needs people to be useful); otherwise Junction posting waits for Elite.
