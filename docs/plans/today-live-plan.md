# Today's live cards: Signal check, Departures board, On your line (v44 gap items 8, 9, 10)

Development, 2026-10-20. This is PR 2 of `docs/plans/departures-live-plan.md` (its "Today (PR 2)" and "Server checks" sections are the plan; approved in the v44 baseline under Milin's delegation via the Project manager). No migration: the `user_goals (skill_id, status)` index came with 0040.

## What changed

- **Signal check** (`src/lib/today/signal.ts`, `answerSignal` and `todayRideFor` in `src/lib/ride/store.ts`): one multiple-choice question a day from the Practice bank (`mock-bank.json`), for the skill today's ride goal learns, else the next open goal's. Picked by `hash32(userId|indiaDay)`; reviewed questions only in production (`unreviewedAllowed`). The page gets the question without its answer; `answerSignalCheck` re-picks it on the server, checks the key, ticks the day's signal task (`signal:<India date>`) in `ride_days` and returns the right answer and why. No model call, nothing stored about the pick, nothing logged.
- **Departures board** (`src/lib/today/live-board.ts`, `todayBoardFor`): the open posts `/departures` lists, read for fit by the same `postView`, grouped by role and city, up to five rows by gaps left. Not read at all with job search off.
- **On your line** (`onYourLineFor` in `src/lib/today/live.ts`): the count and up to four initials of people counted under the Network rules; hidden below three. No tip.
- The Today banner now says only the Timetable is example data. Signed out and No resume keep the example cards.

## Choices made while building

1. The signal task is added to the ride on the page (`withSignalTask`), not inside `buildRide`, so `tickTask` keeps refusing it and the ride's own task ids and week counts don't change. It takes the third task slot, as in the prototype; the third learn task waits for the next day.
2. The task id carries the India date, so each day has its own signal task, and an earlier day's answer never shows today's as done.
3. The answer goes to the browser only after the person answers (or when they answered earlier today). The question id is sent back with the key, so a page left open after a goal was proved gets nothing rather than the wrong question's answer.
4. Only the current goal and the next one are tried, as the plan says. A question with more than four options or an option over 120 characters can't be drawn on the card and is skipped. Today all 48 choice questions are `reviewed: false`, so production shows no card and no signal task until someone who works in the role reviews them.
5. The board reads the newest 300 open posts, the ones the All tab of `/departures` shows, so a row's count matches what All departures lists. A row's gaps are those of its closest post. Posts with no library role, no fit or that are closed are left out. Example board rows stay for signed out and No resume (locked).
6. With no rows (no confirmed resume, or no post matched) the board says "No roles to show yet…". The board's footer now says "From public company job-board feeds", since pasted posts never reach it.
7. On your line counts a person only if they turned on "Let people find me", aren't suspended, deleting or nameless, have no block either way, and the viewer may see both their profile and their gaps under the "Who sees what" rules: gaps to everyone who can open the profile on a profile open to everyone signed in, or a connection with gaps to connections or more on any profile but Only you. "People on your line" profiles count only for connections, because sharing a goal doesn't mean aiming at the same role. Job search off doesn't matter here: the card is about learning, not hiring.
8. "On your line" uses `user_goals.skill_id` with status `active` (the goal's own skill, so a swapped goal still meets people on the same gap). Initials put connections first, then the newest on the goal.
9. On the first day the card counts people who took the goal on in the last 7 days, and reads "started on the {goal} goal this week, like you." instead of the prototype's "started this line this week", which would claim the same role.
10. A failed read of the board or the line logs its event name only and leaves the card out (the board shows its empty line); it never fails the page.
11. /design keeps static example data: the live board rows are built from `exampleLiveJobs` at module level with no clock, and the waiting and failed signal states and the first-day line have their own region names.
12. The e2e walk answers the signal check when the bank has a question for the walk's goal (preview allows unreviewed questions), checks that it ticks the streak, and checks that no example board, tip or question shows.

## Not in this change

- The tip block on On your line and "Ask on Junction" wait for Junction.
- "Discuss on Junction" on the signal check stays "soon".
- The Timetable teaser stays example data.
