# Message requests, Open to work in and Usually free: plan (v44 gap items 33, 36, 31)

Development, 2026-10-20. Source: v44 gap list items 31, 33 and 36; handoff 12b (Inbox), 12c (Account settings) and 12j (Who can find whom); the approved v44 prototype (`settings.html` Pay and location and Privacy, the Inbox availability panel); FR-35, FR-41 and FR-52. One PR, branch `v44-settings-columns`, new FR-55.

Pre-approved under Milin's delegation via the Project manager (2026-10-20); choices logged while building.

## What is there already (not rebuilt)

- Current and expected pay, private (Settings > Pay, `PayFields`, `user_pay`).
- Current city, one of `PERSON_CITIES` (`users.city`, T44), now under Profile basics. Only companies that can find the person see it, never the public profile.
- The Notice period row in Settings (`SettingsJobSearch`, FR-52), already in the Pay section. Item 36's "Notice period ... Change on profile" row is covered by it. We keep the card in Settings; we don't add a link to Me.
- "Connection requests from" (`user_settings.requests_from`, item 32, #177). It is a different rule from message requests and stays as it is.
- "Ask for times": the person picks up to 12 one-hour slots, Monday to Friday, `SLOT_TIMES` 10:00 to 18:00 India time (`candidate_slots`, corporate step 6). Companies see only the picked times.
- Today, nobody who isn't a connection gets a Message button (Network rows and `/u` show it to connections only). But `startDirect` still turns a first message to a non-connection into a request, so the server path exists.

## What the person sees

**Settings > Privacy (item 33)**
- A switch under "Connection requests from": "Allow message requests from people who aren't connections". On by default, so no one's inbox changes.
- Hint (true today): "Off: only your connections can start a chat with you. Requests you already have stay in your Inbox. Companies you applied to write in that application's chat, and companies you let find you send their own request, whatever you pick here." It is saved with the form, like "Connection requests from".
- "Who sees what", the Message you row: "One message request, if you allow it" for Anyone signed in. We drop the code comment that says there is no switch.
- The Inbox's "Who can message you" line adds: "You can turn off requests from people who aren't connections in Settings > Privacy."

**Settings > Pay and location (item 36)**
- The section is renamed "Pay and location" (nav label too), with the tag "pay is private".
- Current city moves here from Profile basics, with its present hint: only companies that can find you see it; it isn't on your profile. We don't use the prototype's "Shown on your profile": the app doesn't do that.
- "Open to work in": pressable chips (`aria-pressed`), Remote first, then the cities picked. "Add a city" is a select from `PERSON_CITIES`. You can pick up to 6 places, Remote included. It starts empty and is saved with the form.
- The line under it: "Filters Departures. Companies see it on applications you send with Express apply, and in their search if you let companies find you." The second half is true only once this PR's server parts are in.
- The Notice period card stays where it is.

**Departures (item 36)**
- Pick at least one place and the City filter gains "Your places" as its first option, selected when Departures opens. It shows roles whose city is one of yours, plus Remote roles if you picked Remote. "Any city" and the single cities still work.
- Roles that name no city ("India") are left out of "Your places".
- The empty state: "No roles in your places yet. Try Any city, or add places in Settings." with a link to `/settings#acc-pay`.
- Today's board doesn't use it. The paused card (job search off) is unchanged.

**Express apply**
- The preview shows "Open to work in: Pune, Remote" (left out when the list is empty) next to Can join, under "What the company sees". To change it: "Change in Settings".

**Inbox > Your availability (item 31)**
- Signed in, the "come with job applications" line is replaced by "Usually free". It is a grid: Monday to Friday by the eight picker times. On a phone it is one row per day with time chips. Each cell is a button with `aria-pressed`, and Save sends the grid at once.
- A summary worked out in code ("Mon to Fri 17:00 to 19:00", "Not set") shows above it.
- Copy: "Private. Companies never see it. It only pre-ticks open times when a company asks for times; you still pick and send." Saturday and Sunday aren't offered, because "Ask for times" offers weekdays only. The prototype's "Sat 10:00 to 13:00" example is not used.
- "Calendar: Not connected" with "Connecting Google or Outlook comes later." There is no button (calendar is W5).
- "Ask for times" pre-ticks the open slots that fall in Usually free, earliest first, up to 12. The person can untick any of them, and nothing is sent until they press the existing send button. With nothing set, the picker starts empty as today.

## Data (migration 0045, export version 31)

The existing columns can't hold any of the three settings, so this needs a migration. Everything goes on `user_settings`, which is already owner-only with RLS and has no FK change. One more column goes on `applications`.
- `user_settings.message_requests boolean not null default true`.
- `user_settings.open_to_work_in text[] not null default '{}'`, with a check of at most 6 entries. Zod checks each entry is "Remote" or one of `PERSON_CITIES`, with no repeats. Order is kept: Remote first, then the order the person picked.
- `user_settings.usually_free text[] not null default '{}'`, with a check of at most 40 entries (5 days by 8 times) and of each entry against `^(mon|tue|wed|thu|fri) (10|11|12|14|15|16|17|18):00$`. Zod checks the same against `SLOT_TIMES`, with no repeats.
- `applications.open_to_work_in text[] not null default '{}'`: copied from settings when Express apply sends, so the company sees what was sent with that application, as the Privacy line already promises. A later change in Settings doesn't rewrite old applications.
- We use columns, not the handoff's proposed `availability_patterns` table: one person has one pattern and it needs no history (logged choice).

The schemas come first, with tests:
- `account-settings.ts`: `userSettings` gains `messageRequests` (optional, so an older page keeps what is stored, as `requestsFrom` does) and `settingsInput` gains `openToWorkIn` (optional, same rule).
- `usuallyFreeInput` is new.
- `DEFAULT_SETTINGS` gets true and empty values.

Numbering: 0043 (notifications, v29) is merged and 0044 (mock follow-ups, v30) is in progress. If 0044 hasn't merged by push time, we rebase on it then and keep 0045/31. If it is dropped, we renumber to 0044/30 before pushing.

Privacy:
- None of the three values is logged or sent to analytics, or shown on a profile.
- Usually free never leaves the person's own pages.
- Open to work in reaches a company only on an Express apply application, and in find search while "Let companies find me" is on.
- Download your data (version 31) adds `settings.messageRequests`, `settings.openToWorkIn`, `availability.usuallyFree`, and each application's `openToWorkIn`.
- Deleting the account removes them with `user_settings` and `applications` (both cascade).

## Server checks

- **Message requests** (`src/lib/inbox/store.ts`, `startDirect`): if there is no direct chat yet and the two aren't connected, it reads the recipient's `message_requests`. Off refuses with "unavailable", checked again under the pair lock in the transaction.
  - The text is the same as for a block ("You can't message this person."). A different text would let a blocked person tell a block from the switch (logged choice).
  - It runs before the request limit is taken, so a refused try doesn't use one of the 20 a day.
  - Connections are never affected.
  - Existing chats follow their own rules: a request already sent stays, and a chat that went back to a request after Remove still takes no second message.
  - Application and found chats aren't direct chats and don't read the switch.
- **Open to work in, Departures** (`src/lib/departures/filter.ts`): "Your places" matches a post's `city` against the list, and "Remote" against `city = "Remote"`. It reads the saved list on the server and sends it to the page. It covers feed posts and CareerMetro jobs alike, using the place names the feed's `placesOf` gives (the Market places, as `PERSON_CITIES` does).
- **Open to work in, applications** (`applications-store.ts`, Express apply send): copies the list inside the send transaction. The job team sees it in the application drawer under Can join. Interviewers see the drawer as they do today, nothing more.
- **Open to work in, company search** (`src/lib/corporate/find-store.ts`): the found-person view shows "Open to work in" next to city. A city filter also matches a person who lists that city. Both apply only to people already in search: "Let companies find me" on, job search on, and none of FR-41's exclusions. The "Let companies find me" hint and FR-41 name it.
- **Usually free**:
  - New action `saveUsuallyFree`, saved apart from the form and owner only.
  - `askFor` in the Inbox store returns the person's pattern next to the ask's days.
  - The pre-tick is worked out in the browser from open slots only.
  - `offerTimes` is unchanged, so the server still checks every slot it receives.
- **Rate limits**:
  - New `LIMITS.availabilityPerUserDay`: 30 saves a day, each try counted.
  - The settings form keeps its current rules: no new cap, and the username's own limits stay.
  - Message requests keep `inboxRequestsPerUser` (20 a day).

## Not in this PR

- Calendar connection and busy greying (W5, needs OAuth keys). The panel says it comes later.
- Weekend and evening times outside `SLOT_TIMES`: the picker doesn't offer them.
- Pay used to mark roles below expected pay (still "later" in the copy).
- Filtering Today's board, Find people's own result order, or the Network by Open to work in.
- A Message button for non-connections on `/u` or Network. The switch guards the server path that exists.
- Email for any of this (no sender; in-app only).

## Docs in the same PR

- REQUIREMENTS: FR-55 (the three settings); FR-35 (the switch), FR-41 (Open to work in in search and on applications) and FR-52 (the Pay and location name).
- Handoff 12b and 12c: one built line each.
- STATUS: two or three lines, and the numbers line set to next migration 0046 and export version 31.

## Tests

- Schema tests:
  - Open to work in: an unknown city, a repeat, 7 places, "Remote" alone.
  - Usually free: a bad day, a time not in `SLOT_TIMES`, a repeat, 41 entries.
  - An older save without the new fields keeps what is stored.
- Inbox store:
  - Switch off: a non-connection's first message is refused with "unavailable" and takes no request count.
  - A connection still opens a chat.
  - An existing request stays readable and acceptable.
  - Switching off between the first look and the lock is refused.
- Departures filter: "Your places" with cities, with Remote, with an "India" post, with the list empty (no "Your places" option).
- Express apply: the list is copied onto the application, a later Settings change leaves it as it was, and the drawer shows it.
- Find-store:
  - The city filter matches a listed city.
  - Nothing is shown for a person with "Let companies find me" off or job search off.
  - The found view carries the list and no more.
- `saveUsuallyFree`: owner only, the 30-a-day limit, and the pre-tick picks only open slots, at most 12, earliest first.
- Export v31: the new keys. Deletion: the rows go with the account.
- e2e (`e2e/walk.mjs`), one step:
  - In Settings, turn off message requests, add Pune and Remote to Open to work in, and save.
  - Departures opens on "Your places" and lists only Pune and Remote roles; "Any city" lists all.
  - In the Inbox, set Mon 17:00 and 18:00 as Usually free, save, reload and see the summary.
  - Turn message requests back on.
  - Axe check on each screen.
- /design examples:
  - The Pay and location section, with chips and with none.
  - The Privacy switch on and off.
  - Usually free, set and not set.
  - The Departures "Your places" empty state.
  - The Express apply preview with Open to work in.
- The full check before the single push: `npm run lint && npm run typecheck && npm test && npm run build`.

## Choices made while building

Built on branch `v44-settings-cols` (migration 0045, export version 31, FR-55), on top of the mock follow-ups branch (0044, v30).

1. **Open to work in reaches company search only for people already in it.** The found view and the city filter use it only while "Let companies find me" is on, job search is on and none of FR-41's exclusions apply (the same `findableWhere` as the rest of the search). Turning either off takes the list out of search at once.
2. **"Your places" filters the job-board roles.** The "Posted on CareerMetro" cards above the list have no city filter today, so they are not filtered by it either. The plan's "CareerMetro jobs alike" waits for a city filter on those cards.
3. **Interviewers don't see Open to work in.** The drawer shows it to the job team (people who can move the application), not to an Interviewer, so an Interviewer's view stays as it was.
4. **Usually free is one row per day with time chips at every width**, not a 5 by 8 table on wide screens: the panel is about 270px wide beside the chat. Each chip's name is "Mon 17:00".
5. **The Inbox page reads the pattern once** and passes it to the Inbox, instead of `askFor` returning it next to each ask's days. The pre-tick is worked out in the browser from the ask's open slots, as planned; `offerTimes` is unchanged.
6. **The `usually_free` check uses `<@` against the 40 allowed values** instead of a regex: the same rule, with nothing to escape in hand-written SQL.
7. **Columns, not an `availability_patterns` table** (the plan's choice): one person has one pattern and it needs no history.
8. **The switch's refusal text is the block's** ("You can't message this person."), so a blocked person can't tell a block from the switch. It is checked before the request limit is taken and again under the pair lock.
9. **Current city keeps its present hint** ("Not on your profile. Only companies you let find you see it, and can search by it."). The prototype's "Shown on your profile" is not used.
10. **"Add a city" stays enabled when 6 places are picked** and offers no cities then ("6 places picked"), so focus doesn't drop to the page after the last pick. A city unpicked on this visit stays as a chip, so a slip is one press to undo.
11. **Express apply's preview line** reads "Open to work in: Remote, Pune." with "Change in Settings" linking to `/settings#acc-pay`, under "From you" after Can join. It is left out when the list is empty.
12. **Saving Usually free** says "Saved. Ask for times now pre-ticks these hours." and moves focus to that line. The /design example says "Example. Nothing is saved."
