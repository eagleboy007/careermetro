# Timetable: plan (events that match your goals and interests)

Development 4, 2026-10-30. Source: handoff section 10 (`docs/design/post-login-handoff.md`), the `events`, `event_topics` and `event_rsvps` rows of handoff section 13, and prototype v2 (`prototype-v2/source/evt.html`, `evt.js`, `evt.css`). This plan changes the data model; the Project manager signed off on it under Milin's delegation (2026-10-30), and migration 0055 is in PR 1. Sources come from Data research's review (section 6).

**The rules this keeps:**
- Only events whose topic matches one of the person's goals or interests are shown. Nothing is sponsored, and there are no random tech talks.
- Location comes from the profile city, never the device.
- Every event links to its source.
- Going to an event is never proof. It can only be an optional prep task.
- We never scrape. Events come from organisers' public feeds whose terms allow reuse, and from moderated suggestions.

## What is already built

| Piece | Today | Gap for Timetable |
|---|---|---|
| Nav | `/timetable` is in the top nav and the menu, marked not built (`src/components/app/nav-items.ts`). | Needs a route. |
| Today rail | `TimetableTeaser` shows example events, with "All events · soon" (`src/components/today/rail-cards.tsx`). | Needs live rows and the link. |
| City | `users.city` holds one of `PERSON_CITIES` (optional; only companies that can find the person see it). | No coordinates, no radius. |
| Interests | `user_interests` holds free text per person (`name`, `name_key`). | Free text doesn't match a topic list by itself. |
| Goals | `user_goals` holds the person's goals by `skill_id`. | Ready to use. |
| Email | The weekly My jobs email (C22) sends Monday to Wednesday at 08:00 IST, 40 a run, so 60 of Resend's 100 a day stay for sign-in codes. It stops at the limit (T142). | The digest has to share that budget. |
| Ride | Prep tasks come from pitstops (`src/lib/ride/build.ts`). | No task kind for an event. |

## 1. Data model (needs sign-off)

Migration 0055, all new tables. Zod schemas and tests come first, as usual.

### `events`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk | |
| `source` | enum `feed`, `suggestion` | Where it came from. |
| `source_key` | text | The feed's id for the event, or the suggestion id. Unique with `source`, so a re-read updates rather than duplicates. |
| `source_url` | text, https | The organiser's page. Always shown as the event's link. |
| `title` | text 1-160 | Clipped with … like job titles. |
| `organiser` | text 1-120 | |
| `kind` | enum `meetup`, `workshop`, `conference`, `online` | |
| `starts_at`, `ends_at` | timestamptz | Shown in IST. `ends_at` ≥ `starts_at`. |
| `online` | boolean | |
| `city` | text, one of `PERSON_CITIES`, null when online | The event's city as given by the source. |
| `venue` | text 0-120, null | An area such as "Baner, Pune". No street address is needed. |
| `cost` | text 0-60 | "Free", "₹200", "₹1,500 student pass". Never a payment link. |
| `status` | enum `pending`, `live`, `hidden`, `cancelled` | Feed events start `live`. Suggestions start `pending` until checked. |
| `checked_at` | timestamptz, null | The last time the feed still listed it. |
| `created_at`, `updated_at` | timestamptz | |

Indexes: (`status`, `starts_at`), and (`source`, `source_key`) unique.

There is no lat/lng column. Distance is worked out from a city table (section 3), because the person also gives only a city, and geocoding a venue would need a paid API.

### `event_topics`

| Column | Type | Notes |
|---|---|---|
| `event_id` | uuid fk → events, cascade | |
| `kind` | enum `skill`, `interest` | |
| `topic` | text | A skill id from `skills.json`, or an interest topic key (section 2). |

Primary key (`event_id`, `kind`, `topic`). Topics are found by code over the title and description: the same alias matcher the feed uses for skills, plus the interest topic list. No model is called. The description itself is not kept, only the topics found in it.

### `event_rsvps`

| Column | Type | Notes |
|---|---|---|
| `user_id` | uuid fk → users, cascade | |
| `event_id` | uuid fk → events, cascade | |
| `state` | enum `saved`, `going` | "Save" in the prototype is `saved`; "I'm going" is `going`. |
| `goal_skill_id` | text, null | The goal the prep task is for, when there is one. |
| `created_at` | timestamptz | |

Primary key (`user_id`, `event_id`). Owner only, included in Download your data (export version 36), and deleted with the account.

The prototype's "N going" count is left out until people can opt in to being counted, as On your line does.

### `user_settings` additions

| Column | Default | Notes |
|---|---|---|
| `events_radius_km` | 25 | 25 or 100 for now. "Show outside 25 km" sets 100 for this visit only; the saved value changes only in Settings. |
| `events_online` | true | "Include online", on by default. |
| `events_digest` | false | "Send me this week's events". Off until the person turns it on, as the weekly email is. |

Turning the digest off is one tap, from the email (the same one-click token as the weekly email) or from Settings.

## 2. Matching

- **Goals:** an event matches a goal when one of its `skill` topics is a skill the person has as an open goal in `user_goals`. The tag reads "Goal: SIEM".
- **Interests:** the person's interests are free text. A small content file, `src/content/interest-topics.json`, maps common interest keys to a topic key with aliases (for example `ai`, `artificial intelligence` and `genai` all map to `ai`). An event matches an interest when its `interest` topic matches a topic the person's interests map to. An interest that maps to nothing matches nothing; it is never guessed. The tag reads "Interest: AI".
- **Nothing else gets in.** An event with no matching topic is never shown to that person, however close it is.
- **Filters:** All, My goals, My interests, Include online, Show outside 25 km. The order is by start time, grouped as This week, Later this month and the next months, as in the prototype.
- **Window:** the next 60 days. Events that have started more than 2 hours ago drop off.

## 3. City and radius

- A content file, `src/content/city-centres.json`, holds one centre point (lat, lng) for each of `PERSON_CITIES`, taken from public map data. A test checks that every city has one.
- An event is near when its city's centre is within the radius of the person's city centre (haversine). The same city counts as 0 km.
- With no profile city, only online events show, plus a line: "Add your city in your profile to see events near you." It never asks for the device location.
- The why panel says: "Your city: Pune, from your profile. We never track where you are."
- Events outside the radius are counted ("3 more outside 25 km") and shown only after "Show outside 25 km".

## 4. "I'm going" and the prep task

- "I'm going" on an event with a goal tag sets `going` and asks once, "Add it as a prep task for your SIEM goal?". A yes sets `goal_skill_id`.
- On the event's day, the ride shows one optional task for that goal: "Go to Hunting with a SIEM", with a link to the source and the minutes taken from the event length (capped at 240). Ticking it counts as a ride day, like any prep task.
- It is never proof. It doesn't move a pitstop, fill a gap or show on Me. The card says so: "Going can count as a prep task. It never fills a gap on its own."
- "Add to calendar" reuses the My jobs `.ics` builder.
- An event on an interest only can be saved or marked going, but it adds no task.

## 5. Monday digest

- Monday at 07:30 IST, from a new cron, `/api/cron/events-digest`. It runs before the weekly email (08:00 IST), and Tuesday picks up anyone a cap or the limit stopped.
- It goes only to people with `events_digest` on and at least one matching event in the next 7 days. The message lists up to 5 events: title, organiser, day and time in IST, city or Online, and the source link. It names no other person.
- **Budget:** Resend's free plan allows 100 emails a day, and sign-in codes keep 60 of them. App emails (the weekly email and this digest) share one budget of 40 per India day, counted in the database (built with the weekly-email fixes T151/T153, before this PR). The digest takes at most 20 of it; the weekly email takes what is left; both catch up on Tuesday and Wednesday and stop at Resend's limit (T142). The tech-stack register already lists Resend's paid plan as the upgrade.
- A `events_digests` table (`user_id`, `week`, `sent_at`) keeps one send a week per person, the same way `weekly_emails` does.
- One-click unsubscribe (RFC 8058), using the existing token.

## 6. Sources

- **Source review:** Data research's review is in `/mnt/project-files/careermetro/data/events/sources-2026-10-30.md`. It covers 30 sources: 5 green, 21 amber and 4 red. Each has a terms note and the way to read it.
- **First feeds:**
  - FOSS United: official iCal and RSS, with Mumbai and Pune chapters, and the site is CC BY-SA. We read its terms page before turning it on.
  - confs.tech conference data: MIT-licensed JSON on GitHub, for online and India conferences.
- **Only with each organiser's written OK:**
  - Luma calendars of local groups (AWS User Group Pune, MumPy, GDG Cloud Mumbai)
  - the null community chapters
- **Typed in by hand:** NPTEL and SWAYAM semester dates, twice a year from the official notices, with a link back. These are entered as admin suggestions. Nothing is crawled.
- **Never used (red):**
  - Meetup: the API needs Pro, and commercial use needs written consent.
  - Microsoft Reactor and Learn events: their terms allow non-commercial use only.
  - NASSCOM FutureSkills Prime: no reproduction without consent.
- **Eventbrite (amber, not red):** only events of organisers we name, title and link only, since public search is gone.
- **Emails to organisers:** asking the 11 organisers on Data research's list for permission is Milin's call, since those emails leave the project.
- **How feeds are read:** each feed goes in `src/content/event-feeds.json` with its terms link and the date the terms were read. A daily GitHub Actions job, like the Departures feed, reads each feed once, upserts events by `source_key`, marks events the feed no longer lists as `cancelled`, and logs counts only.
- **Suggestions:** "Suggest an event" takes a link and the basic fields and saves them as `pending`. An admin checks each one on `/admin/reports` before it goes `live`. Members' suggestions need a grievance officer (pending item 15), so the first version takes suggestions from signed-in members but keeps them all `pending` until that is settled. Organisers suggest the same way.
- Every event links to its source; we show our own short summary (title, organiser, time, place, cost), never the organiser's description text.

## 7. Screens

- `/timetable`, built from prototype v2:
  - the header with the person's city and radius
  - the filter row
  - grouped event cards: date block, title, kind, place or Online, time, cost, the goal or interest tags, Save, Add to calendar, and I'm going on goal events
  - the "Why you see these" panel (goals, interests, city)
  - the Monday digest switch
  - "Know an event? Suggest an event"
- The empty state reads "No events match your goals or interests yet." It links to Me (add interests) and Settings (city).
- Today's Timetable teaser shows the next 2 live matches and links to `/timetable`. With none, the teaser is hidden.
- Cobalt is used only for progress. A goal tag uses the neutral tag style, since an event is not progress.

## 8. PRs

1. Migration 0055 (`events`, `event_topics`, `event_rsvps`, `events_digests`, `user_settings` columns), Zod schemas, `city-centres.json` and `interest-topics.json`, the matcher with tests, and export v36. After sign-off. **Done (2026-10-30)**: data model signed off by the Project manager under Milin's delegation; matcher in `src/lib/timetable/match.ts`, export in `src/lib/timetable/store.ts`.
2. `/timetable` and the Today teaser over the example events, then live rows, Save, I'm going and Add to calendar. **Done (2026-10-30)**: the filter row works on the screen over every match within 100 km; "I'm going" asks nothing yet (the prep-task question comes with PR 3); the Monday digest switch and Suggest an event show as soon.
3. The prep task on the ride.
4. The feed job, starting with FOSS United and confs.tech.
5. The Monday digest and its Settings switch.
6. Suggest an event (pending only) and the admin check.

## 9. Other v2 screens and controls not yet built

Excluded here, as asked: Junction (waits on a grievance officer), billing (none in the beta), Corporate and Google sign-in. This list is inferred from the controls the app marks "soon" and from the nav's built flags. It was checked against the code, not screen by screen against the prototype.

| Where | What is missing | File |
|---|---|---|
| Timetable | The whole screen (this plan) and Today's teaser, which shows example rows with "All events · soon". | `src/components/today/rail-cards.tsx` |
| Map | "Add a pitstop · soon": a person adds their own pitstop to a goal (`path_steps.source = user`, handoff section 13). | `src/components/map/metro-map.tsx` |
| Map, ways to prove | "Skill check on camera · soon", and "work you did, a manager or colleague confirms · soon". Both are proof types in `gap_proofs` (handoff section 6) with no flow yet. They need a plan: the on-camera check touches the AI pipeline and privacy, and the confirmation emails a third party. | `src/components/map/metro-map.tsx` |
| Me | "Show my pitstop on the map · soon", which shows the person's current pitstop to others on the line. It waits on the On your line opt-in rules. | `src/components/job-search/job-search.tsx` |
| Library, Elite | Paid courses stay "Coming soon" slots until licensing deals exist (a business step, not a build). | `src/components/library/elite-shelf.tsx` |
| Reviews held back | Timed-test questions, Elite playbooks and drills, role tracks and mock follow-ups are built but hidden in production until an expert reviews them (pending item 27). The review pack is in `docs/review/pack/`. | |

Junction's links ("Ask on Junction", "Discuss on Junction") stay "soon" with Junction.
