# Job search switch and notice period: plan (v44 gap items 7, 22, 25, 37)

Development 4, 2026-10-20. Source: handoff section 6 "Job search switch and notice period", the v44 prototype (`srch-in`, `npcard`, `me-status`) and C1–C15. This change touches the data model, so it needs approval before building.

## What the person sees

- **One switch, "Looking for a job"**, shown in three places: the Departures header, the Arrivals header, and Me's "Who sees what" rail. Turning it on shows the toast "Job search is on. Departures and Arrivals are back." Turning it off shows "Job search is off. Your rides and map keep going."
- **When search is off**:
  - Departures and Arrivals each show the prototype card: "Job search is off. Departures and Arrivals are paused: no job alerts, no Express apply, and companies can't find you. Your daily rides and your map keep going." with a Turn on job search button.
  - Today hides the Departures board and shows the "Job search is off" card in its place.
  - Express apply is refused on the server.
  - The person is left out of company search (find-store), even if "Let companies find me" is on.
  - The Arrivals count badge hides.
  - Rides, the streak, the Map and Network keep running.
  - Applications already sent stay as they are; companies can still message about them.
- **Me status line**:
  - On: "Looking for a next role".
  - Off: "Working at {company}" from the latest current role on the resume, or no status line when there is none.
  - "Change status" opens Settings. The status shows on the profile as it does today; the switch itself is never shown to others.
- **Notice period card** (private, label "only you see this"), on Arrivals and as a row in Settings > Pay and location:
  - Days: 15, 30, 60 or 90.
  - "I have resigned" asks for the resignation date (not later than today), then "Start countdown".
  - The countdown shows days left, "Last working day: {date}", "Free to join from {date}" and a progress bar (cobalt, since it is progress), plus the three notes from the prototype.
  - "Change" edits the date or the days; clearing the date stops the countdown.
- **Applying**: when a countdown is running, Can join is prefilled with the nearest option that is not earlier than "Free to join from" (now, 30, 60, 90). The person can still change it. Companies keep seeing only Can join, never the days or the dates.

## Data (migration 0039, export version 25)

New columns on `user_settings`. The table is already owner-only, with RLS and no change to FKs.
- `job_search boolean not null default true`. Existing rows get true, so no one's Departures disappear.
- `notice_days smallint null`, with a check that it is one of 15, 30, 60 or 90.
- `resigned_on date null`, with a check that it is null or `notice_days` is not null.

The Zod schemas in `account-settings.ts` and a new `jobSearchInput` / `noticeInput` come first, with tests. The server rejects a `resigned_on` in the future.

Never logged, never in analytics, never on a profile or sent to a company. Download your data adds the three values (export version 25). They are deleted with the account.

## Server checks

- `jobSearchOn(userId)` is one helper, used by:
  - the Express apply action, which refuses with "Turn on job search to apply.";
  - find-store's company search, which adds `job_search = true`;
  - the Today board query;
  - the Arrivals badge.
- Rate limit: 20 switch or notice changes a day per person, like the other settings.

## Not in this PR

- "Show my pitstop on the map" (from the Me rail in the prototype) needs rider counts. It stays a disabled switch labelled "Soon".
- Job alerts don't exist yet (there is no email sender), so "no job alerts" is only copy for now.
- "Search stays open after an offer is accepted, until the joining date" waits for offers, which don't exist yet.

## Tests

- Schema tests.
- Store tests for the switch, the notice checks and the countdown dates. The date maths runs in IST.
- Find-store excludes people with search off.
- Express apply refuses when search is off.
- Export v25 tests.
- e2e: turn the switch off on Departures, see the card, turn it back on; then the notice countdown.
- /design examples for the off cards and the three notice states.
