# Change of destination role

Handoff section 14, open decision 5: "gaps are recalculated, proof carries over, and the old line greys out while the new one branches off. Milin's answer is pending." The Project manager asked Development (2026-10-31) to check what exists and to build what is missing if no migration is needed. **No migration is needed** (section 3), so it is built in the same PR. Milin's answer is still pending: everything here can be undone without touching data (section 3).

## 1. What exists today (origin/main at 2411dcf)

How a role changes. No action or route sets "the destination". The destination is the role of `currentAnalysis`: the person's newest gap analysis by `created_at` (`src/lib/gaps/current.ts:17-30`). A person changes it from "Change your target role" (Map, `src/components/map/metro-map.tsx:667`; Me and Market `changeRoleHref`) or Match's "Gaps for this role" (`src/components/match/match-view.tsx:42`). Each leads to the role step and then to `/resume/[id]/gaps/[slug]` (`src/components/gaps/role-picker.tsx:75`). Opening the Gaps page for a role never analysed inserts a new analysis (`src/lib/gaps/store.ts:165`), and that analysis becomes current.

| Behaviour | State | Evidence |
|---|---|---|
| Gaps recalculated | **Partly** | A new role gets a fresh analysis, and on the next view the goals sync to it: new gaps become goals at the end (`src/lib/goals/sync.ts:84-90`), and the line shows only goals that are gaps of the current analysis (`src/lib/ride/store.ts:30-34`). **Bug:** going back to a role analysed before reuses the stored row under the same id without changing `created_at` (`src/lib/gaps/store.ts:65-94`, `:142`). The other role stays current, so A → B → A leaves the person on B. |
| Proof carries over | **Done** | Proof is per person and skill, not per role (`src/db/schema.ts:659-662`). A new gap that already has accepted proof starts as met (`src/lib/goals/sync.ts:87`), and an existing one turns met (`:73`). Learn ticks carry to the new path by skill (`src/lib/path/store.ts:161-176`), but only once the person opens Path for the new role. Until then the Map reads the new analysis's path, which doesn't exist yet (`src/lib/map/store.ts:49`). |
| Own pitstops (`path_steps.source = 'user'`) | **Done, hidden on the old goals** | They are read by goal, not by path (`src/lib/pitstops/store.ts:30`, `:64-88`) and move to each new path (`src/lib/path/store.ts:191`, `src/lib/pitstops/store.ts:248`). They show on the new line for goals both roles share. On goals only the old role had, they are kept but drawn nowhere, because the goal leaves the line (`src/lib/map/store.ts:144`). |
| Old line greys out, new line branches off | **Missing** | The Map draws only the current analysis's line (`src/lib/map/store.ts:42-44`, `src/lib/map/layout.ts:107`, `height: MAP_HEIGHT` at `:202`). Nothing reads the earlier analysis. |

Side effect today, not changed here: goals of the old role that the new one doesn't need stay `active` (`src/lib/goals/sync.ts:21`), and some readers count them: the Library goal cards (`src/lib/library/store.ts:293`), Timetable matching (`src/lib/timetable/store.ts:106`) and "On your line right now" (`src/lib/today/live.ts:99`).

## 2. Changes, smallest first

1. **Coming back makes a role current again.** When the Gaps page reuses a stored analysis for a signed-in person and it is not their current one, it sets `result.chosenAt` from the database clock (`pickAgain` in `src/lib/gaps/store.ts`). This never happens for the sample resume or an anonymous visitor. `currentAnalysis` orders by `coalesce(chosenAt, created_at)` (`pickedAt` in `src/lib/gaps/current.ts`). A rebuilt older cut keeps `chosenAt` and `trackId` (`keepChoices`). Opening the current role writes nothing.
2. **The earlier destination.** `previousAnalysis` reads the analysis picked last for another role, from the latest profile versions of the person's own resumes (never the sample). `earlierLine` (`src/lib/map/previous.ts`, plain code) turns it into `MapLine.previous`: the role, the gaps the new line doesn't need (each with its proof and own-pitstop count) and how many gaps both lines share. `mapLineFor` adds one read, run in parallel with the others.
3. **Map.** `layoutLine` adds `earlier`: from the Gaps station the branch drops below the map (y 600), runs level to a closed end with one small stop per goal left there (at most 8), and is labelled "EARLIER LINE · title". The map grows from 560 to 648 to hold it, and the new line's stations, train and counts don't move. It is drawn in muted grey at half opacity, under the new line and never in cobalt. One button opens the "Earlier line · greyed out" panel. The panel says the gaps were worked out again and the new line branches off at Gaps, and that N goals are on both lines so their proof, learn ticks and own pitstops came along. It lists what was left on the earlier line (proved / N pitstops added by you, kept / kept) and offers "Switch back to {role}", which opens that role's Gaps page (change 1 makes it current). The key gains "Your earlier line, to {role} (greyed out)".
4. **/design.** "Change of destination" example (`exampleSwitchedMapLine`, built by the real `earlierLine`).

Later, for Milin's answer (not built):
- An explicit "Make this my destination" on the Gaps page. Today any first visit to a role's Gaps page, including from Match, switches the destination. Change 1 makes coming back behave the same way, and does not change that rule.
- "Hide earlier line".
- Pausing the old role's left-behind goals so Library, Timetable and "On your line" stop counting them.
- The new line's learn ticks before Path is opened.

## 3. Data model

**No migration.** `chosenAt` is an optional field inside `gap_analyses.result` (jsonb), checked by the Zod `gapAnalysis` schema. This is the same pattern as `trackId` (`docs/plans/tracks-plan.md`). The earlier line is read from existing `gap_analyses`, `user_goals`, `gap_proofs` and `path_steps` rows. No table or column changes, and no index changes: a person has a handful of analyses, and the reads already filter by user. Download your data already carries `result` whole, so `chosenAt` shows there with no version change. To undo: drop the ordering on `chosenAt` and the field is ignored.

## 4. Tests and walk

- `src/lib/map/previous.test.ts`: covers what is left on the earlier line, in order, with proof and own pitstops capped at 3, and the shared count. It draws nothing for the same role and clips long names. Schemas: `previousLine` caps, `mapLine` with and without `previous`, and `chosenAt` only as an ISO date-time.
- `src/lib/map/layout.test.ts`: no branch without `previous`. The branch starts at Gaps and runs below every station, label and crossing, inside the map. It has at most 8 stops between its ends. The new line's stations, train, track, counts and crossings are unchanged, and a short line widens to fit.
- `src/lib/gaps/store.test.ts` (database): A → B → A brings back A's analysis by id, with no model call, marked `chosenAt` and current. B becomes the previous one. Opening the current role writes nothing, and an anonymous visitor's analysis is never marked. `keepChoices` keeps the track and `chosenAt`.
- `src/lib/map/store.test.ts` (database): after a switch, the line is the new role's, proof carries over, and the earlier line lists the old gaps the new line lacks. Left goals are kept, and switching back swaps the lines.
- `e2e/walk.mjs`, step "change of destination": pick Cloud Engineer on the role step, and the Map's header names it. The earlier line is "EARLIER LINE · DATA ANALYST". It opens with Enter, and the panel's words are checked with axe in light, in dark after a reload, and at 390 px with no sideways scroll. Switch back returns to Data Analyst, with Cloud Engineer as the earlier line. `finally` puts the walk's role back.
