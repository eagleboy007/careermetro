# C26 build plan: sign-up without a target role, levels L1 to L8

Approved by Milin: the flow (2026-11-17 20:49 UTC, `dev/signup-flow-no-target-plan.md`, full doc https://claude.ai/artifact/QDka1ib4s5atGZJjEYdjPX) and the design (2026-11-18 20:09 UTC, prototype v55, `design/c26/`, handoff section 4 and change row C26). This file is how Development builds it. It touches the data model and the parse prompt, so it is written before any code.

## The flow

Upload (no questions) → Where you stand (`/resume/[id]/stand`) → title picker (label only) → Where next? (paste a job description, roles near your level, or Decide later) → Gaps, Map and goals as today. Today shows "Set your destination" while there is no destination.

## 1. Parse prompt v4 (`prompts/parse-resume/v4.md`)

v3 stays as it is; `PROMPT_VERSIONS["parse-resume"]` becomes 4, so `ai_calls` logs `parse-resume/v4`. The only addition is one optional object, `levelFacts`. The model states facts; it never names a level.

| Field | Type | Meaning |
|---|---|---|
| `yearsInThisWork` | number or null | Years in the person's current kind of work, from dates |
| `thisWork` | text (≤ 60) or null | That kind of work in a few words ("IT support and security") |
| `peopleLed` | integer or null | The largest team the person led, as stated |
| `managesManagers` | boolean | They led people who lead others |
| `budget` | quote or null | The line stating a budget or P&L they owned |
| `reportsTo` | text (≤ 60) or null | Who they report to, as written ("IT manager") |
| `scope` | quote or null | The line stating scope (sites, users, regions, revenue) |
| `quotes` | per-field quote or null | The resume line behind `yearsInThisWork`, `peopleLed`, `managesManagers` and `reportsTo` |

Every quote goes through the existing exact-match check. A fact whose quote fails is dropped, except `yearsInThisWork`, which plain code can check against the role dates. `levelFacts` is optional in the Zod profile, so stored profiles from v1 to v3 still read; for them the level comes from years alone and "Behind your level" says "Not in your resume". No migration for this: it rides in `profiles.data`.

## 2. Facts to level: plain code (`src/lib/levels/level.ts`)

1. **Years.** `totalYearsExperience`, or plain code's count over role dates when the model gave none. Cut points (the same as Research's role tags): L1 under 1, L2 under 2.5, L3 under 4.5, L4 under 7.5, L5 under 11, L6 under 13.5, L7 under 16, L8 16 and more.
2. **Change of field.** With `yearsInThisWork` set, the level is the higher of "cut of years in this work" and "cut of total years, minus one". A career changer drops one step at most.
3. **Scope.** One step up, once, when any of these holds and the years reach one year below the next level's typical minimum: `peopleLed` 5 or more, `managesManagers`, a budget or P&L line, or `reportsTo` naming a CEO, MD, founder, board or a chief officer. Never above L8.
4. **The title is never read.** The title picker and parsed titles change nothing (a test checks this).

The result is `{ level, basis, facts }`, where basis lists which rules moved it. The level is worked out each time from the latest profile version, so a correction on the profile page moves it the same way.

## 3. Data model (migration 0060, on `resumes`)

- `level_step smallint` (null, -1 or +1, CHECK), with `level_stepped_at timestamptz`. "Not quite right?" saves it once per resume; the server refuses a second change. The shown level is the worked-out level plus the step, kept within L1 to L8. The step is logged (`level_stepped`, the direction and the two levels, no resume text) and kept on the row.
- `title_label text` (Zod, at most 80 characters): the picked or typed title. It is shown next to the level and on Me. It never reaches the matcher or the level code.
- No new destination column. The destination stays what FR-59 made it: the analysis the person picked last. It was always nullable, and the new state is "a read resume with no current analysis". Decide later confirms the profile (as "Looks right" does, FR-6) and goes to Today, which then shows "Set your destination".
- The sample resume can't save a step or a title (refused, like its other writes). Anonymous resumes can, through the same owner check.
- Download your data gains `levelStep`, `levelSteppedAt` and `titleLabel` per resume (export version 41). RLS is already on `resumes`.

## 4. Level data (`src/content/levels/`)

- `levels.json`: the eight levels (name, typical years, one line on what each means), plus the 43 titles with India variants for the title picker.
- `role-levels.json`: slug → `level` and `alsoLevel` for every live role. A test checks it covers every role and no other slug. Both stay `draft: true, reviewedBy: null` and are added to the expert review pack.
- The 8 L7 roles (Research batch 2026-11-17) load the usual way, with their resources and evals, flagged for sign-off in the review pack like CISO, CRO and CTO. The feed learns their titles (SENIOR_TITLES and the leader list). Titles move as Research suggests: Head of Information Security, Head of Cyber Security and VP Information Security from ciso; Head of Risk and Head - Risk Management from chief-risk-officer; Head of GRC from grc-manager; Head of Engineering and VP of Engineering to director-of-engineering. "risk management" becomes ambiguous on risk-assessment.

## 5. Screens

- **Where you stand** (`/resume/[id]/stand`): the level chip and its line, the L1 to L8 ladder, "Not quite right?" One step down / One step up (then shows the move and its date, no more buttons), Your strengths (the 3 required-skill matches with the strongest resume lines, from the parsed skills), Behind your level (each fact with its resume line), Skills we found, the title picker, and Where next. Ink and grey only, no cobalt (handoff section 4). "Fix any of them on your profile" opens the existing check page, which returns here after "Looks right".
- **Where next?**: three choices.
  - Roles near your level: 3 roles at the level and 3 one step up (role level or `alsoLevel`), ranked by the existing `suggestRoles` matcher, each with its level tag and a one-line reason built from the matched skills ("Uses your Linux and vulnerability scans"). No percentages. L8 shows only roles at the level. "See all roles" opens the existing role list.
  - Paste a job description: below L6 it opens the existing pasted-job check. At L6 and up the posting can become the main destination (Milin's change to the 2026-10-12 rule, for L6 and up only); that is the last part below.
  - Decide later: confirms the profile and goes to Today.
- **Today, no destination**: a new state between "no resume" and "first": the "Set your destination" card (target icon, "No line yet", the level and title, See roles near your level / Paste a job description), While you decide and the Timetable. Ride, signal check, goals, departures, Next interview and On your line wait for a destination.
- **Removed:** the target-role chips above the upload box and their sessionStorage carry (`src/lib/target-role.ts`); the upload now lands on Where you stand. FR-8's chip sentence is removed in REQUIREMENTS.

## 6. PRs

1. This plan, then the level data and the 8 L7 roles with the feed's title rules (content only).
2. Parse v4 and the level code: Zod, prompt, `levelFor` with tests over synthetic fixtures (no UI).
3. Where you stand, the title picker, the level step, migration 0060, export 41, `/design` entries and the walk.
4. Where next, the Today "Set your destination" state, and removing the role step and chips. REQUIREMENTS FR-8 updated.
5. A pasted job description as the main destination for L6 and up: a short addendum here first, because goals and the path come from a role profile today.

Each merge goes to Project manager 2 for Thursday's Testing round.
