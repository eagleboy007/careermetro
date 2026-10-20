# Tracks on Your goals (v44 gap list item 11)

Pre-approved plan (Project manager under Milin's delegation, 2026-10-20): "draft the role-track content as a file (dev/ role-tracks draft, reviewed:false), then build the tracks UI behind it, hidden in production until reviewed."

## What changes

- **Content.** `src/content/role-tracks.json`: for each role profile, up to five tracks, the kinds of work within that role. A track is a deterministic edit of the role's own skill list: `add` (nice-to-have skills the track asks for, which become goals), `drop` (required skills the track doesn't ask for, which leave the goals) and `first` (skills that come first, in that order). The file and every track carry `reviewed: false`. A readable draft for review is `dev/role-tracks-draft.md` in the project files.
- **Schema and checks.** `src/lib/schemas/role-track.ts`. At import (`src/content/index.ts`) the file is checked against the role profiles and the taxonomy: every id exists, `add` names a nice-to-have of the role, `drop` a required skill outside any "one of these" group, `first` a skill the track requires, at most five tracks per role, unique ids and names, at least three required skills left.
- **Matching stays code.** `src/lib/tracks/apply.ts` works the track's goals out from the person's stored gap analysis (which already holds every required gap, the met skills and the nice-to-have statuses): no new resume reading, no model call.
- **Where the choice is kept.** No migration. The chosen track id is saved as `trackId` inside the person's current `gap_analyses.result` (owner-checked through the resume), and read back as the newest of the person's analyses for that role that has one, so it stays per role across a new resume. Null means the whole role.
- **What follows the track.** Today's ride, Your goals, the signal check and the Library's goal order (`rideGoalsFor`), and the Map's line (`mapLineFor`). Goals sync from the tracked gaps, so an added skill gets a goal; a dropped skill's goal is kept but leaves the line, and comes back on switching back. Proof is per skill, so it carries over. The Gaps page, Match, Me and Departures keep the whole role.
- **UI.** The Track chip on Your goals opens the picker (prototype copy and layout: `trk-q`, `trk-list`, `trk-prev`), each option with its goal count and met count; choosing one shows a preview (the first goals it would bring) with Switch track and Cancel. Escape closes it and focus goes back to the chip.
- **Production.** Only reviewed tracks are offered (`unreviewedAllowed`, as for the mock bank). All are unreviewed, so production shows the chip as plain text, as before, and ignores any saved track.
- **Action.** `chooseTrack` in `src/app/(app)/today/actions.ts`: signed in, Zod-checked, 20 changes a day (`LIMITS.trackChangesPerUserDay`), writes only the person's current analysis.
- **Tests.** Content checks, `apply.test.ts`, a DB test for the store, the summary schema, `/design` examples, an e2e step.

## Choices made while building

1. Storage in `gap_analyses.result.trackId` instead of a new table: no migration, owner-scoped by the existing join, exported with the analysis already (no export version bump). A later `user_tracks` table can replace it if tracks reach production.
2. "The whole role" is an extra first option in the picker (the role title, "Every skill the role profile asks for"), so a person can always switch back. It is not one of the five tracks.
3. Tracks can only use the role's own skills, so every goal a track adds has a status from the stored analysis. A skill a track adds keeps the role's expectation as its requirement and gets template words; it has no resume quote, since the stored analysis keeps quotes only for required gaps.
4. iOS Developer has no tracks: it has one nice-to-have skill, so a track would change almost nothing. Its chip stays plain text.
5. Readiness (hours and "You cover X of Y") stays the whole role's on the Gaps page; Today's first-day line hours stay the analysis's.
6. A track's `first` reorders the line (ride and Map) by the track's order, then by goal order; it doesn't rewrite stored goal positions, so switching back restores the person's own order.
