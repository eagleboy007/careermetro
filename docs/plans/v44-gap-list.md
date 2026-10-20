# v44 gap list

On 2026-10-20 Development 4 compared the frozen approved prototype (`prototype-v2/approved/careermetro-prototype-v2-v44-approved-2026-10-19.html`) with the app on `main` at 9cee276. That commit already includes Library (#172), the mock interview (Elite part 3) and the Elite shelf (#174). The comparison went screen by screen, against handoff entries C1 to C15 in `dev/change-tracker.md` and `docs/design/post-login-handoff.md`. C4 billing is skipped because the beta has no billing code. The method had three parts. First, every visible text string in each prototype view, plus the strings its scripts render, was checked against `src/`. Second, each miss was read by hand. Third, the prototype's flows (buttons, states, links) were compared with the app's components. The list leaves out pixel differences that the tokens already cover, and example names and figures. Some screens are not drawn in v44 or are left out on purpose:
- Gaps and Path have no v44 screen; they were checked only through their entry points.
- Corporate is in the separate corporate mockup, not v44; only its entry point was checked.
- Timetable and Junction have no route and stay "Soon". Junction waits on pending item 15, so the "Ask on Junction" and "Discuss on Junction" links are not listed.

Each item is in this form: **Screen**: what is missing or different. Prototype: grep-able string. App file. Size. PR group. Paths are relative to the repo root. "(inferred)" marks a point that was not checked directly.

## Sign-up, Today and the top bar

1. **Today, No resume**: the target role chips above the upload box are missing. The app asks for the role after the parse, at `/resume/[id]/role`, so this is a flow difference. Prototype: `aria-label="Target role"` (Cyber Security Analyst, Data Analyst, Cloud Engineer, More roles). App: `src/components/today/no-resume-hero.tsx`, `src/components/resume/upload-form.tsx`. M. Group: today-no-resume.
2. **Today, No resume**: the four-step parse progress is missing. The app shows only "Reading your resume…". Prototype: `Finding your skills`, `Comparing with Cyber Security Analyst`, `Drawing your line`. App: `src/components/resume/upload-form.tsx`. S. Group: today-no-resume.
3. **Today, No resume**: the drop zone's copy and buttons are different. "Try a sample resume" is missing, and the heading reads "Choose a PDF or Word file / Or drop it here" instead of "Drop your resume here". Prototype: `Drop your resume here`, `Read once to find your skills; never shown to anyone`, `Try a sample resume`. App: `src/components/resume/upload-form.tsx`. S. Group: today-no-resume.
4. **Today, No resume**: the subline ends early. The prototype's sentence ends "...a goal for each gap, with pitstops to fill it." Prototype: `with pitstops to fill it`. App: `src/components/today/no-resume-hero.tsx`. S. Group: today-no-resume.
5. **Today, While you decide**: all three rows are marked "· soon", but `/roles` ("Explore role lines") and `/me` ("Set up your profile") exist. Only "Read Junction" should stay soon. Prototype: `Explore role lines`, `Set up your profile`. App: `src/components/today/no-resume-hero.tsx` (WhileYouDecide). S. Group: today-links.
6. **Today, On your line**: "See people · soon" should link to `/network`, which is now built. Prototype: `See people` (`data-go="network"`). App: `src/components/today/rail-cards.tsx`. S. Group: today-links.
7. **Today, job search switch**: there is no `job_search` setting anywhere. The "Job search is off" card with Turn on is missing, and so is hiding the board when search is off. Prototype: `Job search is off.</b> Your ride keeps going`, `data-srch-on`, handoff section 6 "Job search switch and notice period". App: no setting; `src/components/today/today-preview.tsx`. L, because it changes the data model and needs a plan first. Group: job-search-switch.
8. **Today, Signal check**: for signed-in people the question is example data. The spec is one question a day from the Practice bank, for the skill of the current or next goal. Prototype: `Signal check`, handoff 5 "Signal check". App: `src/app/(app)/today/page.tsx` (the banner says "The other cards are example data"), `src/lib/today/`. M. Group: today-live-cards.
9. **Today, Departures board**: example rows for everyone. It depends on item 40. Prototype: `roles you're heading toward`. App: `src/app/(app)/today/page.tsx`, `src/components/today/departures-board.tsx`. M. Group: today-live-cards.
10. **Today, On your line**: the count, avatars and tip are example data. The real version counts opted-in people on the same goal, and the Network opt-in now exists. Prototype: `On your line right now`, `are on the SIEM goal with you`. App: `src/components/today/rail-cards.tsx`, `src/app/(app)/today/page.tsx`. M. Group: today-live-cards.
11. **Today, Your goals**: the Track chip is static text. In the prototype it opens a track picker with five tracks, goal counts and a preview, and switching recalculates the goals. Prototype: `What kind of work do you want there?`, `trk-list`. App: `src/components/today/goals-card.tsx`. L; it needs role-track content first (STATUS says tracks wait for role tracks). Group: tracks.
12. **Top bar, desktop**: the top nav has no Network and no Library. The prototype nav is Today, Map, Departures, Arrivals, Timetable, Junction, Network, Library, Market. Prototype: `<a href="#network" data-go="network">Network</a>` in `.topnav`. App: `src/components/app/nav-items.ts` (TOP_NAV). S. Group: shell-nav.
13. **Top bar**: Arrivals has no count badge. In the prototype the badge hides with no resume, on the first day, and with job search off. Prototype: `tabcount arrcount`. App: `src/components/app/app-shell.tsx`, `src/app/(app)/layout.tsx`. S. Group: shell-nav.
14. **Avatar menu**: the menu doesn't show the @handle under the name. Prototype: `<small>@priya-n</small>` in `.av-menu .who`. App: `src/components/app/app-shell.tsx` (ShellUser has no username). S. Group: shell-nav.
15. **Top bar**: the notifications bell with its new-count dot is missing. The app has no notifications at all. Prototype: `aria-label="Notifications, 2 new"`. App: `src/components/app/app-shell.tsx`; no data model. L, needs a plan (inferred). Group: notifications.

## Core loop: Resume, Gaps, Path, Practice, Match (and Map, Interview prep)

16. **Map, Life line**: the dotted links "where one fed another" are missing, along with the legend key for them and the link sentence in a moment's panel. Prototype: `Where one fed another`, `P_LINKS`, `Dotted links show where one fed another`. App: `src/components/map/life-line.tsx`, `src/lib/map/life-layout.ts`. M; needs a source for the links (inferred). Group: map-life-links.
17. **Map, Role line legend**: the first legend label is different. The app reads "Ridden: learned, or proved ✓"; the prototype reads "Gaps filled with proof ✓". Prototype: `Gaps filled with proof`. App: `src/components/map/metro-map.tsx`. S. Group: map-life-links.
18. **Map, No resume lock**: the subline is different. App: "Your line appears here, crossing the lines of other roles." Prototype: `Until then, the lines of other roles are here to explore.` App file: `src/components/map/metro-map.tsx`. S. Group: map-life-links.
19. **Match, role card**: "N open jobs" goes to `/departures` with no filter. The prototype says the card links to that role's open Departures jobs. Prototype: dev note `a link to Gaps for that role and to its open Departures jobs`. App: `src/components/match/match-view.tsx`. S (inferred: Departures has no role filter param). Group: match-links.
20. **Interview prep, Mock interview**: the interviewer asks no follow-ups. In the prototype it probes after an answer; the app picks bank questions by code and makes one feedback call at the end. Prototype: `It asks follow-ups like a person would`, `Before blocking anything, say how you would tell a known scanner`. App: `src/components/mock/mock-interview.tsx`, `src/lib/mock/interview.ts`, `prompts/mock-interview/`. L; it is the AI pipeline, so it needs a plan. Group: mock-followups.
21. **Interview prep, setup**: the note about audio under "Answer by" is missing. Prototype: `Speaking needs your microphone. We keep the text of your answers 30 days and never the audio.` App: `src/components/mock/mock-interview.tsx`. S. Group: elite-copy.

## Me and profiles

22. **Me, header**: the status chip reads "Status · soon" and the button reads "Change status · soon". The prototype status line ("Looking for a next role" or "Working at …") follows the job search switch. Prototype: `id="me-status"`, `Change status`. App: `src/components/me/me-view.tsx`. M. Group: job-search-switch.
23. **Me, editing**: four add controls are marked soon: "+ Add role" (Experience), "+ Add" (Education), "+ Add story" (story saving says "saved · soon") and Interests "+ Add". Prototype: `+ Add role`, `+ Add story`, `#addedu`, Interests `+ Add`. App: `src/components/me/me-view.tsx`. L; new tables, plan first. Group: me-editing.
24. **Me, Resume card**: "Replace" and "Edit in builder" read "Replace and Edit in builder · soon". "Edit in builder" is a C15 entry point to `/builder`. Prototype: `Edit in builder`. App: `src/components/me/me-view.tsx` (around line 336). S. Group: c15-entry-points.
25. **Me, Who sees what rail**: the prototype has four switches here. The app shows a read-only summary of Settings. The "Show my pitstop on the map" setting doesn't exist at all. Prototype: `Looking for a job`, `Show me in people lists`, `Show my pitstop on the map`, `Show my gaps to everyone`, `Job search off pauses Departures and Arrivals`. App: `src/components/me/me-view.tsx`. M. Group: job-search-switch.
26. **Profile `/u/[handle]`**: the strip of shared counts is missing (shared skills, shared interests, shared gaps, mutual connections). Prototype: `shared interests`, `shared gaps`, `mutual connections` in `.common`. App: `src/app/(app)/u/[handle]/page.tsx`, `src/components/network/profile-connect.tsx`. M. Group: profile-in-common.
27. **Profile, In common with you**: three parts are missing:
    - Interests in common ("2 of your 4").
    - "Gaps and path · same role, N steps apart", with both people's current steps.
    - "Mutual connections · only people you both know". `mutualConnections()` exists in `src/lib/network/store.ts`, but nothing uses it.

    Prototype: `<h4>Interests<small>2 of your 4`, `Gaps and path`, `only people you both know`. App: `src/components/network/profile-connect.tsx`, `src/lib/network/store.ts` (inCommonWith). M. Group: profile-in-common.

## Network

28. **Network and Profile, row and profile menus**: there is no Report. Handoff 12j lists the menu as "View profile, Remove connection, Block, Report", with reports going to the Inbox review queue. Prototype: `isn't told who reported`. App: `src/components/network/network-view.tsx`, `src/components/network/profile-connect.tsx`. S/M. Group: network-c13.
29. **Network, Find people**: the optional filters (C13) are missing: Aiming for my role, In &lt;city&gt;, Verified. Prototype: `data-f="role"`, `data-f="city"`, `data-f="ver"`. App: `src/components/network/network-view.tsx`, `src/lib/network/store.ts`. M. Group: network-c13.
30. **Network, page**: two sections are missing. "On your line" (tag Later) has a note, and "Mentors" (tag After the beta) is a teaser card. Prototype: `On your line<span class="tag">Later`, `Mentors<span class="tag">After the beta`. App: `src/components/network/network-view.tsx`. S. Group: network-c13.

## Inbox

31. **Inbox, Your availability**: signed-in people can't set their usual free times. The app says these "come with job applications". The calendar connection is item W5. Prototype: `Your availability`, `availability_patterns` (dev note). App: `src/components/inbox/inbox-view.tsx` (line 504). M; may need the availability table (inferred). Group: inbox-availability.

## Settings (including Your plan)

32. **Settings, Privacy**: "Connection requests from" (Anyone who can reach you / Nobody) has no control. `user_settings.requests_from` exists and `src/lib/network/store.ts` enforces it. Prototype: `Connection requests from`, `Anyone who can reach you`. App: `src/components/settings/settings-fields.tsx` (PrivacyFields). S. Group: settings-privacy.
33. **Settings, Privacy**: the switch "Allow message requests from people who aren't connections" is missing. Prototype: `Allow message requests from people who aren't connections`. App: `src/components/settings/settings-fields.tsx`. S (it may need a setting column, inferred). Group: settings-privacy.
34. **Settings, Privacy**: there is no list of blocked people with Unblock; only blocked companies are listed. The Network dev note says "Unblock in Account settings". Prototype: dev note `Block ... Unblock in Account settings`. App: `src/components/settings/settings-view.tsx`, `src/components/settings/company-discovery.tsx`. M. Group: settings-privacy.
35. **Settings, Privacy**: two labels and the reference table are different:
    - The question is labelled "Who can see your profile" in the app and "Who can open your profile" in the prototype.
    - The prototype's "Who sees what" table (Anyone signed in vs Your connections, six rows: find by name, open profile, see gaps, ask to connect, message, see connections) differs from the app's table.

    Prototype: `Who can open your profile`, `See who you are connected to`. App: `src/components/settings/settings-fields.tsx`. S. Group: settings-privacy.
36. **Settings, Pay and location**: the section is "Pay" in the app and "Current city" sits under Profile basics. The "Open to work in" chips are missing; in the prototype they filter Departures and show on applications. The Notice period row with "Change on profile" is also missing (see item 37). Prototype: `Pay and location`, `Open to work in`, `Filters Departures. Companies see it on your applications.` App: `src/components/settings/settings-view.tsx`, `src/components/settings/settings-fields.tsx`, `src/components/settings/profile-link-fields.tsx`. M; "Open to work in" needs a setting. Group: settings-pay-location.
37. **Notice period card**: the private card is missing. It has days 15/30/60/90, "I have resigned" with "Start countdown", days left, "Last working day", "Free to join from", the "Can join from" notes, and the Settings row. Prototype: `npcard`, `I have resigned`, `Start countdown`, `Last working day`. App: no component (the prototype puts it on Arrivals, `src/components/arrivals/arrivals-view.tsx`, and Settings). M/L; new fields, plan first. Group: job-search-switch.
38. **Settings, Notifications**: the Language select (English; "Hindi (coming later)") is missing. Prototype: `Hindi (coming later)`. App: `src/components/settings/settings-fields.tsx` (NotificationFields). S. Group: settings-pay-location.
39. **Settings, Your plan (Free)**: the six-item list of what Elite adds and the line "Mentor sessions are separate" are missing. The price cards and payment parts are C4 and are skipped. Prototype: `AI mock interviews for your target role, with written feedback`, `Mentor sessions are separate`. App: `src/components/settings/plan-card.tsx`. S. Group: elite-copy.

## Departures and Arrivals

40. **Departures**: the public-board roles are example data for everyone, and a signed-in person's Saved and Applied lists aren't stored. The page says "Example roles for now". Prototype: `Roles from public company job boards and posts you paste`. App: `src/app/(app)/departures/page.tsx` (lines 66–85), `dev/departures-plan.md`. L; job-post tables, plan first. Group: departures-live.
41. **Departures, "Saw a role somewhere else?"**: the paste box is disabled with "Check my gaps · soon", although the pasted-job check exists at `/resume/[id]/job` (#109–#117). Prototype: `Saw a role somewhere else?`, `The post is saved to your Departures; it is never shared.` App: `src/components/departures/departures-view.tsx` (PasteBox). S/M. Group: departures-paste.
42. **Departures, header**: the prototype shows "Updated 19:42 · N roles"; the app shows the count with no freshness time. The "Looking for a job switch · soon" is item 7. Prototype: `Updated 19:42`. App: `src/components/departures/departures-view.tsx`. S. Group: departures-live.
43. **Departures, job detail**: "Interview prep for this role" is "· soon". In the prototype it has an Elite label, five questions with only the first open on Free, "Practice a mock round" to `/mock`, and the lock note. Prototype: `Interview prep for this role`, `Practice a mock round`, `One question free. All five, model answers and a timed mock round come with Elite.` App: `src/components/departures/departures-view.tsx` (line 419). M. Group: c15-entry-points.
44. **Arrivals, interview**: the "Practice round" link to `/mock` is missing. It is a C15 entry point. Prototype: `Practice round: the same kind of AI interviewer, on this company's topics.` App: `src/components/arrivals/interviews.tsx`, `src/components/arrivals/arrivals-view.tsx`. S. Group: c15-entry-points.
45. **Arrivals, Level 1 AI video interview**: the company-side AI first interview is missing, with its "About Level 1" box, "Pick your Level 1 slot", "Check camera and mic" and "You are told it is an AI before it starts". Prototype: `About Level 1: AI video interview`, `Check camera and mic`. App: `src/components/arrivals/interviews.tsx`; it needs the corporate side. L (inferred: not in corporate-plan). Group: ai-first-interview.
46. **Arrivals, interviews**: "Add to calendar" is missing. An .ics download needs no keys. Prototype: `Add to calendar`, `Added to your calendar with a reminder the evening before.` App: `src/components/arrivals/interviews.tsx`. S/M. Group: arrivals-extras.
47. **Arrivals, groups and copy**: the "Offers land here. Your line keeps going while you wait." section is missing, and so is "N more applied, waiting to hear". The "Not this time" subtitle reads "With the company's note" instead of "kept so you can learn from it". The prototype line linking a closed role to a goal ("AWS security is a goal on your line (Pitstop 9). Ask again once you prove it.") is missing. Prototype: `Offers land here`, `kept so you can learn from it`, `Ask again once you prove it`. App: `src/components/arrivals/arrivals-view.tsx`. S/M. Group: arrivals-extras.

## The rest: Library, Elite, Builder, Market, Corporate

48. **Library**: several actions aren't built yet:
    - Save and "I finished this", with Saved and Finished from those ticks.
    - "Add to my rides".
    - "Report a broken link".
    - "Suggest a free resource", with a link box, goal chips and "Send for review"; the panel shows "Soon: send a link…".

    Prototype: `Suggest a free resource`, `Send for review`, `Paste a link`. App: `src/components/library/library-view.tsx` (lines 262, 485). L; needs `user_resources`, `resource_reports` and `resource_suggestions`, plan first (STATUS). Group: library-part-2.
49. **Library, For your goals**: the Elite shelf preview row with "See the whole Elite shelf" is missing. It is deferred under the PM rule until paid content exists (handoff 12l, part 5). Prototype: `See the whole Elite shelf`. App: `src/components/library/library-view.tsx`, `src/components/library/elite-shelf.tsx`. S, later. Group: library-part-2.
50. **Elite `/elite`**: the hero's second action "See a mock interview" (to `/mock`) is missing, and so is the "Free and Elite" table's role subtitle ("for Cyber Security Analyst"). Prototype: `See a mock interview`, `<h3>Free and Elite</h3><span class="label">for`. App: `src/components/elite/elite-view.tsx`. S. Group: elite-copy.
51. **Builder, review**: the prototype puts "Download PDF or DOCX" on the review page. The app sends people to the confirm page to download (STATUS). This is a flow difference. Prototype: `Download PDF or DOCX`, `The file is plain and readable by hiring software`. App: `src/components/builder/builder-view.tsx`. S. Group: builder-download.

Market had no gaps beyond example data, which is approved. Corporate is not in v44. The app's avatar menu has a "Corporate" item that the v44 menu doesn't; it comes from the corporate plan, so no change is needed.

## Waiting on keys

- W1. **Settings, Profile basics, Photo** ("Upload photo", "Remove", JPG or PNG up to 5 MB): needs storage keys. App: `src/components/settings/settings-view.tsx`. M.
- W2. **Sign-in, Google** ("Continue with Google"; Settings shows "Google · Connected"): needs the Supabase values and `GOOGLE_SIGNIN=1`. App: `src/app/sign-in/page.tsx`. S once the keys are in.
- W3. **Settings, Two-step verification**: authenticator setup, backup codes, and "Where you're signed in" with a device list and Sign out per device. Shown as "Soon" until the real sign-in exists. Prototype: `Turn on with an authenticator app`, `Where you're signed in`. App: `src/components/settings/settings-view.tsx`. L.
- W4. **Settings, Password** ("Change password", "Forgot it? Send a reset link"): doesn't apply while sign-in is an emailed code or Google; it needs Milin's decision if a password is ever added (inferred). S.
- W5. **Calendar connect**: Inbox "Connect Google or Outlook", busy and free only; Settings > Your data "Calendar · Manage in Inbox". Needs Google and Microsoft OAuth keys. App: `src/components/inbox/inbox-view.tsx`, `src/components/settings/settings-view.tsx`. M.
- W6. **Email sending** (`RESEND_API_KEY`, `EMAIL_FROM`): the Notifications choices (ride reminder, weekly summary, company messages by email) are stored only, and Me's "Work-email checks open soon" waits on it. App: `src/components/settings/settings-fields.tsx`, `src/components/me/me-view.tsx`. M.
- W7. **Verified tick by one-time ID check** (DigiLocker, Express criteria "Identity verified with DigiLocker"): needs a provider and a privacy review, and is deferred to Milin (change tracker 2026-10-19 23:10). L.
- W8. **Certificate upload** (file proof): needs storage keys (STATUS "Switched off until keys arrive"). M.

## Proposed PR groups, in order

1. today-links: 5, 6
2. shell-nav: 12, 13, 14
3. today-no-resume: 1, 2, 3, 4
4. c15-entry-points: 24, 43, 44
5. elite-copy: 21, 39, 50
6. departures-paste: 41
7. today-live-cards: 8, 9, 10 (9 after departures-live)
8. job-search-switch, plan first: 7, 22, 25, 37
9. network-c13: 28, 29, 30
10. profile-in-common: 26, 27
11. settings-privacy: 32, 33, 34, 35
12. settings-pay-location: 36, 38
13. map-life-links: 16, 17, 18
14. match-links: 19
15. arrivals-extras: 46, 47
16. builder-download: 51
17. inbox-availability: 31
18. departures-live, plan first: 40, 42
19. library-part-2, plan first: 48, 49
20. me-editing, plan first: 23
21. tracks, needs content: 11
22. mock-followups, plan first: 20
23. notifications, plan first: 15
24. ai-first-interview, corporate side: 45
