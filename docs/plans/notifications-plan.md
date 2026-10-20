# Notifications, in-app: plan (v44 gap item 15)

Development, 2026-10-20. Source: the v44 prototype's top bar (`aria-label="Notifications, 2 new"`, the bell with its `pip`) and Settings > Notifications, plus the event sources that already exist (Network requests, application moves, interviews and Inbox). Pre-approved by the Project manager under Milin's delegation on one condition: notifications are in-app only. The email part waits on `RESEND_API_KEY` (and `EMAIL_FROM`), and is not built here. One PR, with one migration.

## What the person sees

- **The bell** in the top bar, between the streak chip and the Inbox icon, on every signed-in screen (lucide `Bell`, `strokeWidth={1.75}`).
  - Its label is "Notifications, {n} new", or "Notifications" when there is nothing new, as in the prototype.
  - A small dot shows while n > 0, with no number on it (the prototype's `pip`). The dot uses the `ink` token, like the Inbox count.
- **The panel**: the bell is a disclosure button (`aria-expanded`). It opens a popover under it; at phone width it fills the screen.
  - The heading is "Notifications". It lists the newest 20 from the last 60 days, each with an icon, one sentence, a relative time ("2 h ago", "Yesterday") and a link.
  - Opening the panel marks everything in it as read, so the dot clears. Rows that were new stay bold until the panel closes.
  - Esc and clicking outside close it, and focus goes back to the bell.
  - Empty: "Nothing new. Connection requests and updates on your applications show here."
- **What creates one**: only events that already exist. The sentences are built when the panel is read, from the live rows.

  | Event (where it happens) | Sentence | Opens |
  |---|---|---|
  | Connection request to you (`requestConnection`) | "{Name} asked to connect." | `/network?tab=requests` |
  | Your request accepted (`answerRequest`) | "{Name} accepted your request. You can message them now." | `/u/{handle}` |
  | Company moves your application (`moveApplication`) | "{Company} moved your application for {job} to {stage label}." | `/arrivals` |
  | Moved to Not this time | "{Company} closed your application for {job}. Their note is on Arrivals." | `/arrivals` |
  | Interview scheduled (`scheduleInterview`) | "{Company} set an interview for {job}: {day, time IST}." | `/arrivals` |
  | Interview cancelled (`cancelInterview`, by the company) | "{Company} cancelled the interview for {job}." | `/arrivals` |

- **Not in the bell**: chat messages, message requests and "Ask for times" (all Inbox messages). The Inbox icon's unread count already covers them, so counting them twice is avoided. Nothing the person did themselves notifies them.
- **Settings > Notifications** adds one line under the email switches: "In the app you always see connection requests and updates on your applications. Email for these comes later." The existing email switches stay "stored only".

## Data (migration 0043, export version 29)

- **`notifications`**:
  - Columns: id, user_id → users (cascade), kind (text, checked: `connection_request`, `connection_accepted`, `application_moved`, `application_closed`, `interview_scheduled`, `interview_cancelled`), actor_id → users (set null), connection_request_id → connection_requests (cascade), application_id → applications (cascade), interview_id → interviews (cascade), created_at, read_at, emailed_at (null; unused until the email part).
  - Check: exactly the reference columns the kind needs are set.
  - Indexes: (user_id, created_at desc); partial (user_id) where read_at is null (for the count); an index on each FK (actor_id, connection_request_id, application_id, interview_id).
  - Unique partial (user_id, kind, coalesce(application_id, connection_request_id, interview_id)) where read_at is null. A second move before reading replaces the first (an upsert sets created_at).
- **No text is stored.** Names, company, job and stage are read from the live rows when the panel opens. So a hidden, suspended, deleted or blocked source drops out on its own, and nothing typed is copied.
- RLS is enabled with no policies. The server reads through `src/lib/notifications/store.ts`, scoped to the session user.
- **Retention**: the daily cleanup deletes read notifications 60 days after `read_at`, and any notification 90 days after `created_at`.
- **Export v29** adds `notifications: [{kind, created_at, read_at, company?, job?}]`. Other people's names are left out.
- **Deleting an account** removes its notifications by cascade. Notifications where it was the actor lose the actor (set null) and are then not shown.

## Server checks and limits

- `notify(tx, {...})` is called inside the same transaction as each event in the table above, so an event that rolls back leaves no notification. It never writes when the recipient is the actor, or when the recipient is deleting their account or suspended.
- **Undo paths remove the notification**:
  - `withdrawRequest` deletes the request's notification;
  - `dropBetween` (a block either way, or remove) deletes notifications between the pair;
  - a withdrawn application cascades through its row when deleted, or is filtered on read when `withdrawn_at` is set.
- **Read path**: `notificationsFor(userId)` returns at most 20 rows from 60 days, in one query with joins. It drops rows whose actor is suspended, deleting, blocked either way, or gone. `newCount(userId)` is a count over the partial index, run in the signed-in layout next to `unreadChats`.
- `markAllRead(userId)` is a server action with a Zod-empty input, limited to 300 a day per person. The panel refetches the list on open, and there is no polling or realtime.
- **Write volume** is bounded by the source limits already in place: 20 connection requests a day, the company's own moves and interview steps. Notifications are never logged with names; logs carry the kind and counts only.
- **Email**: `emailed_at` and a `NOTIFY_EMAIL` flag are reserved. Part 2 sends a digest through `src/lib/email/send.ts`, honouring the Settings switches, once `RESEND_API_KEY` and `EMAIL_FROM` are in (`dev/email-sender-steps.md` step 6). It is marked **waiting on RESEND_API_KEY**.

## Choices made

1. **Stored rows, not derived on read.** A row per event, written in the event's transaction, gives a stable read state and a place for `emailed_at`. It holds ids only, never text.
2. **Messages stay on the Inbox badge** and are not in the bell, to avoid two counts for one message.
3. **The six events above** come from features that exist now. Held-proof decisions, work-email admin decisions, the saved-role "one gap away" alert (`departures-live-plan.md`) and Library report outcomes are later kinds, each a one-line check change.
4. **Opening the panel marks all as read.** There is no per-row read toggle, because the prototype shows only "N new".
5. **The dot uses `ink`, not cobalt.** The prototype's pip is `accent`, but CLAUDE.md keeps cobalt for progress only.
6. **No polling.** The count is fresh on each page load and when the panel opens, which fits Vercel Hobby limits.
7. **Repeated moves collapse** into one unread row per application, so a company dragging a card through lanes makes one notification.
8. **Company members** get no bell in this plan. Corporate already has its own unread counts.

## Not in this plan

- Email or push for any notification (waiting on `RESEND_API_KEY`).
- The later kinds in choice 3.
- A notifications page beyond the panel.
- Per-kind mute switches.

## Tests

- Schemas: `notificationView` (strict), the kind and its reference rules, and the export v29 shape.
- DB:
  - each event writes one row in its transaction, and none when the transaction rolls back;
  - no row for self-actions;
  - the unread upsert collapses repeat moves;
  - withdraw, block and remove delete the rows;
  - suspended, deleting or blocked actors are hidden on read;
  - another user's rows are never returned;
  - cascade on account deletion;
  - the 60- and 90-day cleanup;
  - FK indexes (`indexes.test.ts`).
- Layout: the count is passed to the shell, and the label reads "Notifications, 2 new".
- e2e: person B asks to connect, and person A sees the dot. Opening the panel shows the sentence, the dot clears, and the link opens Network Requests. Then a company moves A's application and the bell shows it. Esc returns focus to the bell. axe checks in light and dark at phone width.
- `/design`: the bell with and without the dot, the panel with each kind, and the empty state.

## Choices made while building

Built on branch `v44-notify` (migration 0043, export version 29). In-app only, as approved; the email part is not built (it needs `RESEND_API_KEY` and `EMAIL_FROM`), and no `NOTIFY_EMAIL` flag was added yet, since nothing would read it.

1. **One row per application.** Each sentence reads the application's live stage, so a new row about an application deletes every earlier one about it, read or not; an older row would otherwise tell the old move in today's words. A cancelled interview replaces its unread booking; a booking already read stays as history.
2. **Job search off** hides moves and closings in the bell and its count, as Arrivals is paused then (FR-52); interviews still show, as Arrivals still lists live invitations.
3. **A company the person blocked** shows nothing in the bell. Arrivals still lists the application, as before.
4. **A notification never undoes its event.** `notify` runs in a savepoint inside the event's transaction: the event rolling back takes the notification with it, but a failed notification is logged (kind and error code only) and the event goes on.
5. **The count uses the panel's rules**, so the dot never promises a row the panel won't show. It is capped at 20, the panel's length.
6. **Past 300 opens a day** the panel still shows its rows; they stay unread.
7. **Removing a connection** deletes the pair's notifications too, not only a block (`removeConnection` doesn't go through `dropBetween`).
8. **An accepted request** keeps the "asked to connect" row as history. Connect that connects at once (both asked) tells the first asker with "accepted your request".
9. **Not this time** cancels interviews ahead without an "interview cancelled" row each: the closing line covers them.
10. **`/network?tab=requests`** is the link as planned. Network doesn't read the parameter yet; it opens on Requests whenever any wait, so the row lands there.
11. **The panel** is a disclosure with a Close button (needed when it fills the phone screen), not a landmark. The CareerMetro wordmark now hides under 420 px instead of 360 px, so the bell fits beside the streak, Inbox and avatar at 360 px.
12. **The privacy draft** gains the retention line ("60 days after you read them, and never more than 90 days"), for the legal adviser's pass with the rest of it.
