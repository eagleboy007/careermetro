# Network: connections and people search (plan)

Date: 2026-10-19. Asked by the Project manager under Milin's delegation ("start Network now", 19 October 2026, 21:51 UTC). It changes the data model, and the Project manager approved this plan in advance unless Development finds a real risk. The design thread is drawing the screens at the same time; its output is a fidelity pass afterwards, not a blocker. Every choice below is **Decided by Development 2026-10-19** unless it quotes the handoff or the platform plan.

Sources: handoff section 12 ("People appear as Name · status. Lists show only counts of shared skills and interests. A profile shows 'In common with you'"), section 12b (Inbox: "connections chat freely; anyone else sends one message request"), section 12 "Gaps show only to connections unless the user turns that on", and `docs/plans/platform-plan-accounts-to-network.md` section 5 (connect, search by name or handle, block and report, hidden from search until the user opts in).

## Not in this plan

- Posts, feeds, votes, comments, reshares (Junction): these wait on Milin's legal decision, pending item 15. A connection carries no content, so it adds no IT Rules intermediary duties beyond the Inbox's.
- Follow (one-way): left out. Connect alone covers the handoff, and one kind of relationship keeps privacy simple.
- "People aiming for your role" suggestions and "who viewed you": later.
- Groups and teams.

## 1. Request, accept and remove

- **Connect** on a person (search result or `/u/[handle]`) sends a request. There is no note; a person who wants to say why can send the Inbox's one message request, as today.
- The receiver sees it under **Requests** on `/network`, and as a count on the Network entry in the avatar menu. **Accept** connects both. **Ignore** hides it without telling the sender, like Delete on an Inbox request. **Block** blocks the person, as in the Inbox, and removes the request.
- The sender sees **Requested** and can **Withdraw**. An ignored request still reads Requested to the sender (they are never told). A request expires after 30 days, then it can be sent again.
- Two people who request each other at the same time are simply connected.
- **Remove** a connection from either side, from `/network` or their profile. The other person isn't told; the connection just goes.
- A block, in either direction, removes any connection and request between the two, at once.
- Suspended or deleted accounts: their connections and requests stop showing at once (the same `reachable` rule as the Inbox). Deleting an account deletes its rows (cascade).
- **Limits**, shared by every server (`LIMITS`): 20 new requests a day per person, 100 requests waiting on others at once, and 30 searches an hour.

## 2. The `/network` page

- Added to the avatar menu as "Network" (handoff 12c lists it there; the menu doesn't have it yet), with a count of requests waiting. Not in the phone tab bar (handoff: Network moves to the avatar menu under 760px).
- Same frame, fonts and tokens as Find people, Inbox and Me. Mono labels, cobalt only for progress, so Connect and Accept use the ink button, not accent.
- Four parts, as tabs: **Connections** (count), **Requests** (count), **Sent**, and **Find people**.
- A person row everywhere: name, then "· target role" if they show it, then "N skills in common" (handoff: lists show only counts). The row links to `/u/[handle]` when they have a username. Phone and email are never shown.
- Empty states: Connections "No connections yet. Find people you know, or people on your line." Requests "No requests." Sent "Nothing waiting."
- Phone: one column, the tabs scroll sideways, rows stack the actions under the name. 44px targets, keyboard and screen reader the same as Find people.

## 3. Network name search

- On the Find people tab of `/network`: one box, "Name or username".
- Matches the start of each word of the name, ignoring case, dots and accents (`nameMatches`, as company Find people), or the exact username. At least 2 letters or digits (the T63 rule).
- Finds only people who turned on **Let people find me** (section 5), are signed up with a name, aren't suspended or deleted, and haven't blocked or been blocked by the searcher. The searcher is never in their own results.
- Up to 20 results, best first: connections of yours first, then most skills in common, then name. No paging in v1; a longer name narrows it.
- Results show the same person row with **Connect**, **Requested**, **Connected** or **Accept** as fits.
- This is also the "Network name search" that T44 left waiting.

## 4. A connection on the profile

- `/u/[handle]` gains, for a signed-in viewer: **Connect** / **Requested** / **Connected** with Remove, and "In common with you": shared skills (names) and the same target role, if shown. Report and Block stay on the profile.
- What a connection can see: the profile visibility setting gets a fourth choice, **"Your connections"**, between "People on your line" and "Only you". A connection also sees gaps when the person has "show gaps" on, and "Gaps show only to connections unless the user turns that on" means the existing switch now reads "Show my gaps to connections".
- **Inbox:** a direct chat between connections opens straight away (status open), with no request step. A request already waiting between two people who then connect becomes an open chat.

## 5. Who can find whom, and the privacy switch

- New switch in Account settings, Privacy: **"Let people find me by name"**, off by default (platform plan: hidden from search until the user opts in). Off takes the person out of Network search at once. It doesn't affect companies (that is "Let companies find me").
- Anyone can still connect from a profile they can already see (its visibility setting decides that), even with the switch off.
- Blocking is two-way invisible: neither person finds or sees the other.
- Requests per day and searches per hour are limited (section 1).

## Data model (migration 0034, RLS on, as every table)

- `connections`: `user_a uuid`, `user_b uuid` (the pair always stored with `user_a < user_b`, check constraint), `status` (`pending` | `accepted`), `requested_by uuid`, `ignored_at` (set by the receiver; the sender is never shown it), `created_at`, `accepted_at`. Primary key (`user_a`, `user_b`). Index on `user_b`. Both users cascade on delete.
- `user_settings.people_can_find boolean not null default false`.
- `profile_visibility` enum gains `connections`.
- Export (`EXPORT_VERSION` 20): your connections (their name and username as shown to you), requests you sent and got with dates, and the switch. Account delete removes all of it (cascade).
- Logs and audit lines carry event names and ids only: never a name, a username or a search.

## Build, in small PRs

1. **Data and rules:** migration 0034, schemas, store (`requestConnection`, `answerRequest`, `withdrawRequest`, `removeConnection`, `connectionsOf`, `searchNetwork`), the block and reachable rules, limits, export and delete, unit and database tests. No screens. FR-49 in REQUIREMENTS.
2. **`/network` page and the switch:** the four tabs, the avatar-menu count, the Settings switch, the profile visibility choice, `/design` entries, e2e walk with axe in light and dark and at phone width.
3. **Profile and Inbox:** Connect and "In common with you" on `/u/[handle]`, open chats between connections, gaps for connections, STATUS.

## Risks checked

- Privacy: everything is off by default, and nothing shows a person to a stranger who couldn't already see their profile.
- Abuse: request and search limits, silent Ignore and Block, Report on every profile.
- Legal: no user-written content is added, so pending item 15 isn't triggered.
