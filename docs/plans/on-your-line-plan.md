# On your line (C13): opt-in pitstop sharing — plan

Status: BUILT 2026-10-31 (FR-60), as section 10 decided: migration 0058, export version 39. The plan was approved by the Project manager under Milin's delegation before any code (CLAUDE.md working agreements: it touches the data model).

Sources: handoff section 5 ("On your line": count of people on the same goal, opted-in profiles only, `docs/design/post-login-handoff.md:196`), section 7 ("Rider counts come from opted-in users", `:293`), 12j/C13 (`:411`, `:654`, "Later"); FR-52 ("Show my pitstop on the map" stays a disabled switch marked soon, it needs rider counts, `docs/REQUIREMENTS.md:128`); FR-49 (Today's "On your line right now", `docs/REQUIREMENTS.md:124`).

PM defaults used: opt-in, off by default; others see only a count until a person opts in; names only between connections; never shown to companies; one switch in Settings > Privacy.

## 1. What the person sees, and where

- **Settings > Privacy** (`src/components/settings/settings-view.tsx:152`, beside `FindMeSwitch`): new switch "Show my pitstop on the map", off by default, saved at once like "Let people find me" (`src/components/settings/find-me-switch.tsx:10`). Hint: "Signed-in people on the same goal see you only as part of a count, never below 3. Your connections see your name. Companies never see it." Status line after a change: "You now show on the map." / "You are off the map. Nobody sees your pitstop." (focus moves to it, as find-me does).
- **Who sees what** table (`src/components/settings/settings-fields.tsx:358`): new row "See you at a pitstop on the map" — anyone: "Only in a count of 3 or more, with the switch on"; connections: "By name, with the switch on".
- **Me** rail "Who sees what" (`src/components/job-search/job-search.tsx:214-224`, rendered at `src/components/me/me-view.tsx:555`): the disabled "Show my pitstop on the map · soon" becomes the same live switch (same column, same action). Owner's view only, as now.
- **Map** (`src/components/map/metro-map.tsx`):
  - A goal pitstop's side panel adds "N people on this pitstop" when N ≥ 3 (`LINE_MIN_PEOPLE`, `src/lib/today/live.ts:47`), then up to 3 connection names ("Asha K., Ravi M. and 1 more connection"), each linked to `/u/<handle>` only if the viewer may open that profile; otherwise the name is plain text. Below 3 people: nothing, not "fewer than 3".
  - The "Other line" panel's `<Soon>See people on it</Soon>` (`metro-map.tsx:679`) becomes the same count at the crossing pitstop (crossings sit on the viewer's goal skills, `src/lib/map/other-lines.ts:13`), so no extra query.
  - Key "Other people's lines" (`metro-map.tsx:190`) is unchanged; no new colour (counts are neutral `muted` text, never cobalt or a gap colour).
  - The banner "Other people on it appear once profiles can be found." (`src/app/(app)/map/page.tsx:37`) is reworded to "People on the same goal show as a count; your connections by name. Turn on Show my pitstop on the map to be counted."
- Not in this build: Network's "On your line" suggestions (handoff `:411`, still Later) and the Library's "people on your line finished it".

## 2. Privacy rules (exact)

A person P is **counted** on viewer V's pitstop for skill S when all hold:
1. P ≠ V; P has `user_goals` row on S with status `active` (one row per person and skill, `user_goals_skill`).
2. P's `user_settings.show_on_map` is true (no row means off).
3. P is not deleting, not suspended, has a name (same as `countedBy`, `src/lib/today/live.ts:72-77`).
4. No block either way between P and V.

P is **named** to V only when also: P and V are connected (`connections`), and P's profile visibility is not "Only you", and P's `gaps_visible_to` is not "nobody" (a pitstop shows a gap; we never name what the person hid). Otherwise P is only in the count.

- The count shows only at 3 or more; names never appear without the count.
- Off takes P out of every count and name list on the next read (no cache).
- Never to companies: `src/lib/corporate/find-store.ts:162` `personColumns` and every corporate store stay without the column and without rider data; no corporate route reads it. Never on a public profile (`src/lib/me/public.ts`), never in email, never in Today's board.
- No browsing: there is no list of "everyone at this pitstop"; only counts and the viewer's own connections.
- Today's "On your line right now" keeps its current rule (Let people find me) in this build; see open question 2.

## 3. Data model

- One column: `user_settings.show_on_map boolean not null default false`. **Migration needed**: `drizzle/0058_show_on_map.sql` via `npm run db:generate` after editing `src/db/schema.ts:199-240`. Existing rows get false, so nobody is opted in by the migration.
- Zod: add `showOnMap` to the settings schema (`src/lib/schemas/account-settings.ts`) and a `pitstopRiders` view schema (`{ skillId, count, names: {name, handle|null}[] ≤3, more }`) in `src/lib/schemas/map.ts`; schema and tests first.
- Writes: `setShowOnMap(userId, on)` under the existing shared limit pattern (`takeShared`, `src/lib/shared-limit.ts:137`), new bucket `map-share-change`, 20 a day per person.

## 4. Queries, indexes, cost (~10,000 members)

- **Counts**, one query per Map load: `select ug.skill_id, count(*) from user_goals ug join users u … join user_settings s on s.user_id = ug.user_id where ug.skill_id = any($goalSkills) and ug.status = 'active' and s.show_on_map and <rules 3-4> group by ug.skill_id`. `$goalSkills` ≤ 20 (`MAX_GAPS`). Uses `user_goals_skill_status` (`src/db/schema.ts:636`); `user_settings` and `users` join on primary keys.
- **Names**, one query, only when some count ≥ 3: V's connections (both sides: PK `(user_low, user_high)` and `connections_user_high`, `src/db/schema.ts:848-849`) joined to `user_goals` on those skills with the naming rules, ordered by name, 4 per skill (3 shown plus "more").
- Cost: ~10 goals each gives ~100k `user_goals` rows; a popular skill has a few thousand active rows, so a load scans at most ~20k index entries: low single-digit ms. Map loads (~10k a day at most) add ~2 small queries each; no cron, no denormalised counts. A partial index `user_settings (user_id) where show_on_map` is not added now; revisit if `EXPLAIN` at 50k members shows a seq scan.
- Wiring: a new `pitstopRidersFor(viewerId, skillIds, db)` in `src/lib/map/riders.ts`, called from `mapLineFor` (`src/lib/map/store.ts:36`) inside the page's `Promise.all` (`src/app/(app)/map/page.tsx:31`), with a failure-tolerant `.catch` that logs `map_riders_failed` and draws the map without counts.

## 5. Export and deletion

- Download your data: `settings.showOnMap` in the existing settings block (`src/lib/account/export.ts:260`); bump `EXPORT_VERSION` 38 → 39 (`src/lib/account/export.ts:33`) and the ~20 tests that assert 38 (e.g. `src/lib/practice/store.test.ts:192`, `src/lib/library/marks.test.ts:316`). Other people's counts or names are never exported.
- Account deletion: the column lives on `user_settings` (cascade from `users`); while deleting, rule 3 already removes the person from every count. Nothing else is stored.

## 6. Logging

- Log event names and error codes only: `map_share_on`, `map_share_off`, `map_share_limit`, `map_riders_failed`. Never names, handles, skills of other people, counts tied to a user id, or free text. No analytics event carries the switch state with another person's data.

## 7. Tests

- Schema: `showOnMap` default false; riders view caps names at 3 and refuses count < 3.
- Store (real Postgres, like `src/lib/today/live.test.ts:254-275`): off → not counted; on → counted; 2 people → null; blocked either way, suspended, deleting, no name → not counted; connection named only with profile ≠ Only you and gaps ≠ nobody; non-connection never named; only `active` goals; 21st change in a day refused.
- Companies: `find-store.test.ts` asserts no found person or payload carries `showOnMap` or rider data; a grep test that no file under `src/lib/corporate` or `src/app/(app)/corporate` imports `map/riders`.
- Export: `showOnMap` present, version 39.
- UI: Map panel renders count and names from example data on `/design`; Me and Settings switches share one state.

**e2e walk** (`e2e/walk.mjs`): (1) A, B, C, D sign up with goals on SQL; (2) A opens Settings > Privacy, sees the switch off; (3) B, C turn it on → D's Map pitstop shows nothing (2 people); (4) A turns it on from Me → D sees "3 people on this pitstop", no names; (5) D connects with B → D sees B's name, not A's or C's; (6) B sets gaps to Nobody → B drops from names, count stays 3; (7) A blocks D → D's count disappears (2); (8) a company search shows none of this; (9) A downloads data → `showOnMap: true`, version 39.

## 8. Accessibility

- Switches reuse `Switch` (role switch, label, hint via `aria-describedby`); the status line is `role="status"` and takes focus after a change.
- Counts live in the side panel, which is already `aria-live="polite"` (handoff `:113`); the SVG gets no new tap targets. Count text reads in words ("3 people on this pitstop"); names are a plain list with links of at least 44px height.

## 9. Open questions for Milin

1. Should people who haven't opted in count anonymously in the total? This plan says no (handoff `:196`, `:293`: opted-in only), so the count stays 0 until people opt in.
2. Today's "On your line right now" counts people with "Let people find me". Move it to the new switch so there is one rule, or keep both? Moving it drops today's counts to zero at launch.
3. "Pitstop" = any active goal on the skill (cheap, this plan) or only the person's current pitstop (needs a stored current-goal column and a second migration)?
4. Named connections when their gaps are set to Nobody: leave them out (this plan) or let the switch override that choice?
5. Show the count on the SVG itself (a small chip at the pitstop) or only in the side panel (this plan)?

## 10. Decisions (Project manager, under Milin's delegation, 2026-10-31) and how they were built

1. Only people who turned the switch on are counted, never anyone else, not even anonymously. The count shows from 3. Built in `pitstopRidersFor` (`src/lib/map/riders.ts`).
2. Today's "On your line right now" moves from "Let people find me" to the new switch, so there is one rule (`countedBy` in `src/lib/today/live.ts`; its other rules stay). Counts start at zero at launch.
3. "Pitstop" means any active goal on the skill; no second migration. Goals waiting on an earlier line after a change of destination don't count (`goalOnCurrentLine`, the SQL form of `leftOnEarlierLine` in `src/lib/gaps/destination.ts`).
4. Connections whose gaps show to "Nobody", or whose profile is "Only you", are left out of the names; they stay in the count. Blocks either way, suspended, deleting and nameless accounts are left out of both.
5. The count shows in the side panels only (goal pitstops and the Other line crossing), never on the SVG.

As built: migration `drizzle/0058_show_on_map.sql` with its snapshot and journal entry; `showOnMapInput` and `pitstopRiders` Zod schemas; `setShowOnMap` (signed-in action `switchShowOnMap` in `src/app/(app)/settings/map-share-actions.ts`, 20 a day, bucket `map-share-change`); `MapShareSwitch` in Settings > Privacy and on Me; `PitstopPeople` in the Map panels (names shortened to "Asha K.", linked to `/u/<username>` when there is one); the Map is left without counts on the sample resume's line and when the read fails (`map_riders_failed`). Logs: `map_share_on`, `map_share_off`, `map_share_limit`, `map_share_failed`, `map_share_read_failed`, `map_riders_failed`, names only. `src/lib/map/riders-privacy.test.ts` keeps company, public profile and email code from reading the column or the riders. The walk's step covers section 7 except step 8 (company search), which the grep test covers; A turns the switch on in Settings and D on Me.

Anything that widens who sees what goes back to the Project manager first.
