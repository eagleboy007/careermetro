# Library part 2: plan (v44 gap items 48, 49)

Development, 2026-10-20. Source: handoff 12a (data proposal: `user_resources`, `resource_reports`, `resource_suggestions`), FR-51, the v44 prototype's Library view, and `docs/plans/reports-review-plan.md` for the admin queue pattern. Pre-approved by the Project manager under Milin's delegation. One PR, with one migration.

## What the person sees

- **Save** (the bookmark on each row and in the details panel):
  - Toasts: "Saved to your Library." and "Removed from saved."
  - The Saved tab lists saved items, newest first, with the tab count.
  - Empty Saved: "Nothing saved yet. Tap the bookmark on anything you want to come back to." This replaces "Saving isn't on yet…".
- **"I finished this"**, a check box in the details panel.
  - Ticking it shows "Marked finished." When the item belongs to an open goal, it adds "Next on this goal: prove {skill} at Pitstop {n}."
  - Finished now means ride ticks, Path ticks or this box. Unticking the box removes only the box's tick.
  - The note "We can't see your progress on other sites, so Finished is your own tick…" loses its "come soon" sentence.
- **Add to my rides**:
  - Toast for 60 minutes or less: "Added to your rides." (it joins the rides of its goal, which may not be today's).
  - Toast for longer items: "Added to your rides, in parts of about 25 minutes."
  - Once added, the button reads "On your rides" (disabled). The next ride puts the item first for its goal, as "Part k of n" for split items.
- **Report a broken link** (link in the details panel): a small menu with "Link is broken", "Not free any more", "Out of date" and "Something else".
  - Then the toast "Thanks. A reviewer will check this link."
  - A second report of the same item by the same person says the same thing, and stores nothing new.
- **Suggest a free resource** (the rail panel; it replaces "Soon: send a link…"):
  - "Paste a link" (`type=url`), the person's open-goal chips plus "Other", and "Send for review".
  - Under it: "A reviewer checks it before anyone else sees it."
  - Success: "Thanks. A reviewer will check it before it goes in the Library."
  - A link already in the catalog: "That link is already in the Library." with the item opened.
  - An empty link moves focus back to the box, as in the prototype.
- **Your interests**: the empty state, "Nothing picked for this interest yet. Suggest a free resource and a reviewer will look at it.", now links to the suggest box. Interest picks themselves come with `me-editing-plan.md`.
- **Admin, `/admin/library`** (ADMIN_EMAILS, like `/admin/reports`), with two lists, oldest first, up to 200 each:
  - **Broken links**: one row per resource with open reports. It shows the title, source, the counts by reason and the last link-check result.
  - Actions on a broken link:
    - Hide link: sets `resources.hidden_at`, and it leaves the Library, paths and rides at once.
    - Show again.
    - Dismiss reports.
  - **Suggestions**: the link (opened by the admin in a new tab, `noreferrer`), the host, the goal chip and the date.
  - Actions on a suggestion:
    - Accept: noted, then added to `src/content/resources.json` by a PR.
    - Already in the Library.
    - Decline: not free, paid wall, affiliate, off topic or other.
  - Each action writes one audit line, `admin:<id>` / `resource_hidden` · `resource_shown` · `resource_reports_dismissed` · `suggestion_<decision>` / `resource:<id>` or `suggestion:<id>`.

## Data (migration 0041, export version 27)

- **`user_resources`** (new, owner-only):
  - Columns: user_id → users (cascade), resource_id → resources (cascade), saved_at, finished_at, on_ride_at (all null by default), updated_at.
  - PK (user_id, resource_id); index resource_id (FK). A row with all three timestamps null is deleted.
- **`resource_reports`** (new):
  - Columns: id, resource_id → resources (cascade), user_id → users (set null), reason (`broken`, `not_free`, `outdated`, `other`, checked), status (`open`, `hidden`, `dismissed`), created_at, decided_at, decided_by → users (set null, not indexed, as with `hidden_by`).
  - Unique (resource_id, user_id) where status = 'open'. Indexes: (status, created_at), resource_id, user_id. No free-text note, so nothing typed is stored.
- **`resource_suggestions`** (new):
  - Columns: id, user_id → users (set null), url (≤ 500, https, checked), host, skill_id → skills (null means Other), status (`open`, `accepted`, `duplicate`, `declined`), decline_reason (enum, null), created_at, decided_at, decided_by (set null, not indexed).
  - Indexes: (status, created_at), user_id, skill_id. Unique (user_id, url).
- **`resources`** gets `hidden_at timestamptz null`. `healthy` stays the link check's. Library, Path and ride reads add `hidden_at is null`.
- RLS is enabled with no policies on all three new tables.
- **Retention**: decided reports and suggestions are deleted 180 days after `decided_at` by the daily cleanup. Open ones stay until decided.
- **Export v27** adds `library: {saved, finished, onRide}` (resource titles and URLs), `resourceReports: [{title, reason, status, created_at}]` and `resourceSuggestions: [{url, status, created_at}]`.
- **Deleting an account** removes `user_resources` by cascade. Reports and suggestions keep the link record with user_id set to null: they hold no personal data, and the catalog work stays.

## Server checks and limits

- All actions take Zod-strict input and the user id from the session. Admin actions check `isAdminEmail` and take the admin id from the session.
- **Save, finish and ride**: 300 changes a day per person (`shared-limit`). The resource must be in the healthy, unhidden, free catalog. On-ride items are capped at 5 per person, and a sixth gives the toast "You have 5 on your rides. Finish or remove one first."
- **Ride split**: `buildRide` reads `on_ride_at` items for the current goal's skill first. Items over 60 minutes become ⌈minutes / 25⌉ tasks with ids `res:<id>:<k>`, ticked in `ride_days` like any task. The last part's tick sets `finished_at`.
- **Reports**: 10 a day per person. A hidden resource takes no new reports.
- **Suggestions**:
  - Limit: 5 a day and 30 open at once per person.
  - The URL must be https, with no user info or port, and a host that is not an IP or localhost.
  - Tracking and affiliate parameters (`utm_*`, `ref`, `aff*`, `tag`, `fbclid`, `gclid`) are stripped before storing.
  - A match with a catalog URL (after normalising) returns "duplicate" and stores nothing.
  - The server never fetches the link, which avoids server-side request forgery. Only the admin opens it.
- Nothing typed reaches logs: event names and counts only.

## Choices made

1. Accepting a suggestion records the decision only. The catalog changes by PR to `resources.json`, so the link check and the free-only review run as for every resource.
2. A report has fixed reasons and no note, so no text needs moderating or keeping.
3. "Hide link" is a new `resources.hidden_at`, so the daily link check (which writes `healthy`) can't bring a hidden link back.
4. Reports and suggestions outlive the reporter's account with the user set to null, as `reports` does.
5. On-ride items are capped at 5, and split into 25-minute parts as the prototype says.
6. "Finished" stays the person's own tick: the box, the ride or the Path. A finish never fills a gap (FR-51).
7. **Item 49 stays deferred.** The handoff says there is nothing paid to preview. "See the whole Elite shelf" ships when the first licensed course exists, as a no-migration follow-up: one row on For your goals with up to 3 reviewed shelf items for open goals and the link to `?tab=elite`.
8. "People on your line who finished it" stays out. It would need counting others' finishes, which is a privacy call for later.

## Not in this plan

- Interest picks (`me-editing-plan.md`) and the Elite preview row (choice 7).
- Telling the person the outcome of a report or suggestion, which waits for notifications part 2.
- Hindi labels on suggestions.

## Tests

- Schemas first:
  - `libraryActionInput`;
  - `resourceReportInput`;
  - `suggestionInput`, with URL normalising, stripped parameters, and refusing IPs, ports and http;
  - the admin decision inputs;
  - the export v27 shape.
- DB:
  - per-user rows, and another user's never readable;
  - empty rows deleted;
  - one open report per person and resource;
  - a duplicate catalog URL refused;
  - limits;
  - hidden resources gone from the Library, Path and ride;
  - cascade and set-null on deletion;
  - the 180-day cleanup;
  - FK indexes (`indexes.test.ts`, with `decided_by` listed as not indexed).
- Ride: a 90-minute item gives 4 parts, the last tick finishes it, and the 5-item cap holds.
- Admin: admins only, audit lines, and the order of both lists.
- e2e: save, finish, add to ride and report from the details panel; suggest a link; the admin hides the reported link and the Library no longer shows it. axe checks in light and dark at phone width.
- `/design`: the suggest panel's states, the report menu and the admin rows.

## Choices made while building

Development, 2026-10-20, branch `v44-library2`.

1. **Finished from the last part.** `finished_at` is the box only. The last part's ride tick counts as Finished the way every ride tick does, read from `ride_days`, instead of writing `finished_at`. So unticking that part the same day takes it back, and unticking the box still takes back only the box's tick.
2. **Task ids.** Every added item is `res:<id>:<k>`. An item of 60 minutes or less is one task, `res:<id>:1`, at its own length. Longer ones are ⌈minutes / 25⌉ parts of 25 minutes; the last part is what is left.
3. **Three tasks a ride.** The ride schema shows at most three tasks. Added items come first, and the path's courses and practice follow once those are done. Each added item moves on one part a day.
4. **Which goal.** An added item belongs to no goal id. It joins the first open goal on the line whose learn skill it teaches (its own skill, or the one "Not for me" swapped it to). A course already among that goal's ride courses isn't added twice. The Path's done tick doesn't cover added items, so adding one to such a goal brings the ride back to it.
5. **Add to my rides needs a goal.** The button shows only for items on a goal card. The server also refuses a link that teaches no open goal on the line ("This one isn't for a goal on your line, so it can't go on a ride.").
6. **Take it off my rides.** The five-item toast says "Finish or remove one first", so the panel has a small "Take it off my rides" under "On your rides" (toast "Taken off your rides."). Focus moves to Add to my rides, never to the page.
7. **The five.** The cap counts added items not finished: not ticked with the box and with a part still to do. A box tick takes an item off the ride.
8. **Report link copy.** The panel uses the prototype's words, "Link broken or out of date?", which opens the four reasons.
9. **Untick copy.** Unticking the box says "No longer marked finished.", or "Unticked. Your ride or Path tick still counts it as finished." when a ride or Path tick also counts.
10. **Suggestion index.** `resource_suggestions` has no separate `user_id` index: the unique index on (user_id, url) starts with it and serves the foreign key.
11. **Hidden links on the admin list.** Broken links also lists links already hidden, with Show again, even with no open reports. Hiding closes the open reports as `hidden`. Dismissing closes them as `dismissed` and leaves the link alone. A second Hide, or a Dismiss with nothing open, writes no audit line.
12. **The Map too.** The Map's learn stops leave out hidden links as well as the Library, Path and ride.
13. **Your interests.** No profile has interests yet, so the per-interest empty state can't show. The existing no-interests line now ends "or suggest a free resource and a reviewer will look at it", which moves focus to the suggest box.
14. **Suggested skill.** The chips offer the person's open goals and Other. The server takes any skill id in the taxonomy, or null, and refuses others.
15. **Duplicates.** Links are compared without "www.", a trailing slash, the fragment and tracking parameters. A match with a hidden or broken catalog link still says "That link is already in the Library." but opens nothing.
16. **Limits.** Every try counts once it passes the Zod check: a refused "not on a goal" counts as a change, and a duplicate counts as a suggestion. A link refused by the schema counts nothing.
17. **Export v27.** `library.saved`, `finished` and `onRide` each list `{title, url, at}`. `finished` is the box's ticks; ride ticks are already in the download's ride days.
18. **Nothing skipped.** No part needed a key, money or a legal call. Item 49 stays deferred (choice 7).
19. **What holds a ride slot.** The five-item count reads the same rows the ride does: an added link that is broken, no longer free or hidden by an admin has left the ride, so it holds no slot. A goal's own ride course (its path's first two) is on the rides already and is ticked as that course, so Add to my rides writes nothing for it, and the panel shows "On your rides" from the start (the view's `rideCourses`).
20. **Ride copy.** An added item rides with its goal, which may not be today's, so the words are "Added to your rides.", "Added to your rides, in parts of about 25 minutes." and "On your rides", never "next ride".
21. **Decided means decided.** Both review tables check that a row is open exactly when it has no decided_at.
