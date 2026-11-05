# v2 coverage (2026-11-05)

This compares every entry in the handoff's "Changes since handoff v1" table (C1 to C25) and every other screen section of `docs/design/post-login-handoff.md` against main at commit `af2ceb1` (PR #317). Of 36 rows, 23 are Built, 11 Partly, 1 Not built and 1 Deferred. Most Partly rows are built code that stays switched off until keys, the lawyer or expert review arrive.

| Item | Status | Evidence | Waits on |
|---|---|---|---|
| C1 Library | Built | FR-51, #172, #185 (PM treated C1 as approved in the v44 baseline; tracker row still says parked) | — |
| C2 Inbox | Partly | FR-35, `/inbox`; calendar connect (gap list W5) needs OAuth keys | Milin (Google and Microsoft keys) |
| C3 Account settings and avatar menu | Partly | #124, #192; photo upload and two-step verification wait on keys and real sign-in (W1, W3) | Milin (storage and Supabase keys) |
| C4 Your plan, Elite prices and payments | Deferred | On hold by Milin: no billing in the beta; free Your plan only (#170) | Milin (schedule billing) |
| C5 Verified current job | Partly | FR-47, #151; check switched off until email keys | Milin (`RESEND_API_KEY`, `EMAIL_FROM`, `NAME_HASH_KEY`) |
| C6 Market | Partly | #125, `/market`; openings are live from the Departures feed, but pay figures are example data until licensed data exists | Milin (a licensed pay source) |
| C7 Corporate workspace | Built | #113, #118 to #122 (steps 1 to 7); L1 AI round in its own row | — |
| C8 Organization sign-up | Partly | #113, `/corporate/new`; production shows "opens soon" until email keys | Milin (email keys) |
| C9 Post a job | Built | #118, `/corporate/jobs/new` | — |
| C10 Practice | Built | FR-21 to FR-23, #145; draft questions hidden until reviewed | — |
| C11 Match | Built | FR-24, #143 | — |
| C12 Network | Partly | FR-49, #165 to #167; find people switched off until keys | Milin (keys) |
| C13 Network extras | Built | #182 (Report, filters), #296 (On your line, FR-60) | — |
| C14 Build your resume | Built | FR-36, #169, #179 | — |
| C15 Elite, mock, Elite shelf | Partly | FR-50, #170 to #174; timed test and Elite shelf hidden in production | Experts (review of banks and shelf) |
| C16 Copy fixes | Built | #178 | — |
| C17 Top bar on narrow phones, bell | Built | FR-54, #190 | — |
| C18 My jobs | Built | #240, #242 | — |
| C19 Before sign-up check | Built | #243 | — |
| C20 Today: Next interview | Built | #267 | — |
| C21 Share from the phone | Partly | #250; not yet checked on a real Android phone (STATUS Queue 6) | Milin (real-phone test) |
| C22 Weekly My jobs email | Built | #251, #253 | — |
| C23 Me: Show more per section | Built | #277 | — |
| C24 My jobs compact phone row | Built | #280 | — |
| C25 Change of destination | Built | FR-59, #293, #295 (built on PM's call; Milin's answer pending) | — |
| 3 Routes and navigation | Built | `src/components/app/nav-items.ts` (Junction marked not built while flagged off) | — |
| 4 Sign-up and returning | Partly | `src/lib/auth/config.ts`; real sign-in off, Google needs `GOOGLE_SIGNIN=1` | Milin (Supabase values) |
| 5 Today | Built | #175, #193, `/today` (open in prod via `TODAY_PREVIEW=1`) | — |
| 6 Core logic: goals, tracks, Not for me, job search | Built | FR-48, FR-52, FR-56; #155, #180, #195 | — |
| 7 Map | Built | #123, #181, #285 (FR-58) | — |
| 8 Departures | Built | FR-25, #184 | — |
| 9 Arrivals | Built | #119, #183; L1 AI interview in its own row | — |
| 10 Timetable | Partly | FR-57, #276 to #283; hand-entered events only, organiser feeds off | Milin (organiser emails) |
| 11 Your profile (Me) | Built | FR-53, #188, #277 | — |
| 12 Junction | Partly | FR-61, #310; behind `JUNCTION_ENABLED`, off in production | Milin, lawyer (backup grievance officer, mailbox) |
| Level 1 AI first interview (12e, 9) | Not built | "The L1 AI round isn't available yet" (`interviews-screens.tsx`); pending item 45 | Milin (item 45) |

Not compared: handoff sections 13 (data model) and 14 (open decisions), which are not screens. Plans parked outside the handoff (proof confirmed by a manager, on-camera check) are not built and wait on Milin and a lawyer.
