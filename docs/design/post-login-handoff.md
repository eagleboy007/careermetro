# Post-login design handoff

The signed-in app for job seekers: sign-up, the daily ride, goals, the map, jobs, events and the profile. This file collects every screen, rule, font and style agreed in the prototype so development can build from one place.

- **Prototype (source of truth for look and behaviour):** https://claude.ai/artifact/WK113KMpYfq9FnmCPVXTFP, version 28 (2026-10-09). It has a "Dev notes" drawer with the same rules as below.
- **Prototype source:** `careermetro/careermetro-prototype-v2.html` in the project files.
- All people, companies and resumes in the prototype are made up. Use synthetic fixtures in `/fixtures` only.
- If this file and `docs/REQUIREMENTS.md` disagree, the requirements win until this file's change is approved there.

Not designed yet, so out of scope here: organization sign-up, employer job posting, the B2B employer side and the Elite screens. They are on the pending list.

---

## 1. Build order

Small PRs, one feature each. Every PR runs `npm run lint && npm run typecheck && npm test && npm run build`.

| # | PR | Touches data model or auth? |
|---|----|----|
| 1 | Board tokens, plus Today components on `/design` with fixture data (ride card, streak chip, departures board, Your goals card, user-state switch) | No |
| 2 | Signed-in app shell: top nav, phone tab bar, avatar menu, `/today` page from fixtures behind a preview flag | No |
| 3 | Sign-in (Google + email magic link), session, `users` linked to resumes, save the pre-sign-up analysis on sign-up (FR-2) | **Yes, plan approval first** |
| 4 | User state from the server: No resume, First sign-up, Returning | Yes (reads) |
| 5 | Goals and pitstops: `user_goals`, `path_steps.goal_id` and `kind`, `gap_proofs` | **Yes, plan approval first** |
| 6 | Today live: ride, streak (`ride_days`), signal check | Yes |
| 7 | Map view from the path | No new tables |
| 8 | Departures page from pasted posts and public ATS feeds; work type | Yes |
| 9 | Your profile (`/me`), Experience, Education, Your stories | Yes |
| 10 | Tracks and "Not for me" | Yes, needs role profiles with tracks |
| 11 | Timetable, Arrivals, Junction, Network | Later; Junction needs the grievance officer decision first |

---

## 2. Design system

### Colour tokens

Use tokens only. Never a literal colour in a component. Every token has a light and a dark value, and `data-theme` overrides the system setting.

Existing tokens are in `src/app/globals.css` and exposed to Tailwind as classes:

| Token | Light | Dark | Use |
|---|---|---|---|
| `bg` | `#f4f5f8` | `#0c0e13` | Page |
| `surface` | `#ffffff` | `#14171f` | Cards |
| `surface-2` | `#eceff4` | `#1b1f29` | Wells, inputs, chips |
| `ink` | `#12151c` | `#eceef3` | Text |
| `muted` | `#586072` | `#9aa2b3` | Secondary text |
| `line` | `#dce0e8` | `#2a2f3b` | Borders, future line on the map |
| `accent` | `#2448f5` | `#7e94ff` | **Progress only**: train, done stops, ring, primary button |
| `accent-soft` | `#e6ebff` | `#1d2452` | Progress backgrounds |
| `on-accent` | `#ffffff` | `#0c0e13` | Text on accent |
| `good` / `good-soft` | `#0f7a56` / `#e2f4ec` | `#4cc79a` / `#11302a` | Gap met, "Boarding now" |
| `warn` / `warn-soft` | `#9a5800` / `#fff0d8` | `#f0b45a` / `#382a12` | Gap weak |
| `bad` / `bad-soft` | `#c0342a` / `#fde7e5` | `#ff7e71` / `#3a1a18` | Gap missing |

New tokens from the prototype, to add in PR 1:

| Token | Light | Dark | Use |
|---|---|---|---|
| `board` | `#12151c` | `#07080b` | Departures board background (always dark) |
| `board-ink` | `#f4f5f8` | `#eceef3` | Board text |
| `board-dim` | `#8b93a6` | `#8b93a6` | Board labels |
| `board-line` | `#262b36` | `#1f2430` | Board row dividers |
| `shadow` | `rgba(18,21,28,0.35)` | `rgba(0,0,0,0.6)` | Soft shadow colour for raised cards and the board |

Colour meaning, never broken:

- Cobalt (`accent`) means progress only. Don't use it for links that aren't progress, decorative highlights or "Going" style toggles. Toggles use the ghost button with `aria-pressed`.
- Red, amber and green mean gap status only: missing, weak, met. "Boarding now" is green because it means zero gaps left.
- Other people's role lines on the map use `line` and `muted`, never status colours.

### Type

Loaded through `next/font` (already set up as `--font-bricolage`, `--font-geist-sans`, `--font-geist-mono`).

| Role | Font | Weight | Notes |
|---|---|---|---|
| Headings (`h1` to `h3`, big numbers, board titles) | Bricolage Grotesque | 500 to 700 | `letter-spacing: -0.02em`, `text-wrap: balance` |
| Body, buttons, inputs | Geist | 400 to 600 | |
| Labels, eyebrows, pitstop tags ("4 · LEARN"), board rows, times | Geist Mono | 400 / 500 | Uppercase for eyebrows and map tags, `letter-spacing: 0.04em` to `0.08em` |

Scale used in the prototype:

| Use | Size |
|---|---|
| Page title (`h1`) | `clamp(1.9rem, 4.5vw, 3rem)`, line-height 1.05 |
| Section title (`h2`) | 1.5rem to 2rem, line-height 1.1 |
| Card title (`h3`) | 1.05rem to 1.2rem, `letter-spacing: -0.015em` |
| Body | 0.95rem to 1rem |
| Small body, list rows | 0.84rem to 0.9rem |
| Labels and chips | 0.72rem to 0.8rem |
| Micro labels (mono, map tags) | 0.62rem to 0.7rem |

### Shape and spacing

- Radius tokens: `--radius-sm` 8px (chips, inputs), `--radius-md` 12px (buttons, small cards), `--radius-lg` 20px (main cards, the board). Pills use 999px. Avatars and lamps are circles.
- Cards: `surface`, 1px `line` border, padding 18 to 22px, 16px gap between cards.
- Shadows only on raised things (the board, the train, popovers): `0 20px 40px -30px var(--shadow)`.
- Page max width about 1240px; two columns on desktop (main plus a 340px rail), one column under 960px.

### Icons

`lucide-react`, `strokeWidth={1.75}`, 16 to 20px. Outline only. Icon-only buttons get an `aria-label`.

### Motion

- Train moves along the line, flap board flips, ring fills, small confetti when a pitstop is cleared.
- `prefers-reduced-motion: reduce` turns off the flap board, confetti and pulses. The train jumps instead of sliding. `globals.css` already shortens all animations.

### Accessibility

- Every pitstop on the map is a button with a visible focus ring (`:focus-visible` is a 2px accent outline). The side panel is `aria-live="polite"`.
- Status is never colour alone: lamps carry a word (Missing, Weak, Met).
- Readiness is words, never a percentage or score (FR-13).

### Words

- Step names: Resume, Gaps, Path, Practice, Match.
- Metro words for the signed-in app: ride, line, pitstop, train, Departures, Arrivals, Timetable. "Stop" is shown to users as "Pitstop".
- Plain, short sentences. No jargon in the UI ("prove it" not "proof artifact").
- Never name or compare competitor job portals. Say "job portals".
- People show as Name · self-set status ("Working at X", "Freelance", "Looking for a next role", "Studying" or none). Phone, email, salary and notice period are never shown to other people.

---

## 3. Routes and navigation

| Route | Screen |
|---|---|
| `/today` | Signed-in home. Signed-in visits to `/` land here. |
| `/map` | Your journey (metro map) with a Life line switch |
| `/departures` | Jobs |
| `/arrivals` | Applications a company moved forward |
| `/timetable` | Local events |
| `/junction` | Community board (name not confirmed) |
| `/network` | People |
| `/library` | Learning resources |
| `/me` | Own profile, from the avatar |
| `/u/[handle]` | Someone else's profile |

- Desktop: top nav with Today, Map, Departures, Arrivals, Timetable, Junction; avatar menu on the right.
- Phone (under 760px): bottom tab bar with Today, Map, Departures, Arrivals, Junction. Network, Library and Timetable move to the avatar menu.

---

## 4. User states (sign-up and returning)

Pick the state on the server, never from the client.

| State | Rule | Today shows |
|---|---|---|
| **No resume** | No `resumes` row for the user | Target role chips, upload drop zone (PDF or DOCX, 5 MB), parse progress in four steps (Reading file, Finding skills, Matching to role, Building your line), then First sign-up. Board, map and skills are locked with a one-line reason. |
| **First sign-up** | A resume, but no ride day yet | Welcome with a count-up of skills found, gaps and pitstops; the first ride (Pitstop 1, two tasks); three setup taps: hours a week (changes the estimate), people lists opt-in, job search on or off. Streak chip reads "Day 1" until a task is ticked. |
| **Returning** | Has a resume and at least one ride day | The ride, streak, signal check, departures board and Your goals |

FR-2 still holds: a person can run one gap analysis before signing up, and it is saved to their account on sign-up.

---

## 5. Today

Layout: ride card and signal check on the left, Your goals on the right rail, the departures board below, Timetable teaser in the rail.

### Ride card

- Today's ride is the next 2 or 3 prep tasks for the current pitstop, picked by plain code from the path and the user's hours a week.
- Ticking tasks moves the train along the dotted stretch toward the pitstop and fills the weekly ring.
- When the learn pitstop is done, the next card is the prove pitstop (skill check, certificate or confirmed work).
- Header chip: "Pitstop N of M".

### Streak

- One ticked task makes that day a ride.
- A missed day pauses the count; it never resets.
- Store one row per day (`ride_days`), not a counter.

### Signal check

- One question a day from the Practice bank, for the current or next goal's skill.
- Answering ticks the day's last task. No score shown.

### Departures board

- A split-flap board (`board` tokens) of roles from public ATS feeds and pasted posts, ordered by gaps left.
- "Boarding now" means 0 required gaps. Other rows say gaps left in words.
- Hidden when job search is off.

### Your goals

- One goal per gap, each with three lamps (missing red, weak amber, met green).
- Tapping a goal shows the quoted resume line as evidence and the goal's pitstops in order.
- A suggested extra pitstop per goal (for example labs), added with one tap.
- Below the list: goals met with proof this month, and a suggested new goal.
- Track chip at the top (see Tracks).
- "On your line": count of people on the same goal, opted-in profiles only.

---

## 6. Core logic

### Goals, pitstops and proof (Milin's rule)

- A **goal** is one gap.
- A **pitstop** is a halt on the way to it. Each pitstop is either **learn** (free course plus daily or weekly tasks) or **prove**.
- Videos, reading, practice tests, events and signal checks are prep. They move the train toward a pitstop. **They never fill a gap.**
- A gap is filled only by proof, any one of:
  1. A skill check for that skill (timed, on camera, retake after 7 days).
  2. A certification the role profile accepts for that skill, verified with the issuer or a Credly badge.
  3. Work experience: a role on the profile where the skill was used, backed by a course or certificate on the resume, confirmed by a manager or colleague (pending until confirmed).
- Only an accepted proof turns the gap to met and moves the train past the pitstop.
- Missing skill: learn then prove. Weak skill: prove only, with an optional learn pitstop suggested.

### How Your goals is filled, for any role

Matching is deterministic code. The model only parses the resume and writes the "why" lines. Nothing here is specific to cyber security.

1. **Inputs.** Resume skills, each with the line it came from. The destination role and track. Job posts for that role and track in the user's city (pasted and public ATS feeds), refreshed weekly.
2. **Default track.** For each track: score = required skills met or listed, divided by required skills. Preselect the highest. The user can switch at any time.
3. **Skill list.** Each skill in a track has a level (`required`, `one_of` with a group, or `nice`) and a weight: the share of that track's posts that ask for it. Levels come from the hand-written role profile reviewed by an expert. Weights come from posts.
4. **Gap status.**
   - met: accepted proof, or used in a job or project on the resume.
   - weak: listed but never used.
   - missing: not on the resume.
   - A `one_of` group is met when any member is met.
5. **Which gaps become goals.** Every required or `one_of` gap, plus nice gaps with a weight of 30% or more, plus goals the user adds.
6. **Order.**
   - Prerequisites first, from a skill graph: Cloud basics before AWS security, or HTML and CSS before React.
   - Then higher weight, then less effort.
   - A goal already in progress never moves. New gaps are appended.
7. **Pitstops per goal.** Learn pitstops draw from the curated free resource bank. Prove pitstops list the accepted proofs for that skill.
8. **Suggestions.**
   - Extra pitstop: the next unused resource for that skill.
   - New goal: a skill in 30% or more of the user's saved and board posts that is not in the track list.
9. **Not for me.** See below. Every skip, swap and removal is stored, so a recompute never brings it back.
10. **Recompute** when the resume changes, the destination or track changes, a proof is accepted, or the weekly refresh moves a weight by more than 10 points.
11. **Role with no profile yet.**
    - Build a draft from at least 5 pasted posts.
    - Levels come from frequency: 70% or more is required, 30 to 70% is nice.
    - Label the card "Draft profile" and queue it for expert review.

Examples:

- Frontend developer: tracks Frontend, Full-stack, Mobile. React is `one_of` with Vue and Angular. Accessibility is nice.
- Data analyst: tracks BI and reporting, Product analytics. SQL is required. Power BI is `one_of` with Tableau.
- Digital marketing: tracks SEO, Performance, Content. Google Ads is `one_of` with Meta Ads.

### Tracks

- A destination role has tracks. For security they are SOC and detection, GRC and compliance, Data protection, Application security, and Cloud security.
- Switching the track chip recalculates gaps against that track's skill list. Proof carries over. Departures filters to the track.

### Not for me (per goal)

- **nice**: remove it. The match doesn't change.
- **one_of**: swap within the group (Sentinel for Splunk). Pitstops update and the match doesn't change.
- **required**:
  - Show how many target posts ask for it.
  - Offer another track or "Skip anyway".
  - A skipped goal stays a gap, and roles that need it stay amber.
- **Your choice**: goals the user adds have their own pitstops and proof and show on the profile. They never count in the match.

### Job search switch and notice period

- `job_search` on or off, shown on Departures, Arrivals and `/me`.
- Off pauses Departures and Arrivals: no job alerts, no Express apply, hidden from employer search, and the Today board is hidden. Rides, streak, map and Junction keep running.
- Notice period is private:
  - The user enters days, plus the resignation date once they confirm they resigned.
  - Show a countdown to the last working day.
  - Employers see only a "Can join from" date. It is never on a profile.
  - Search stays open after an offer is accepted, until the joining date.
- Built (2026-10-20, FR-52, `docs/plans/job-search-plan.md`): `job_search`, `notice_days` and `resigned_on` live on `user_settings`, not `profiles`. Companies see the Can join choice (Immediately, within 30, 30 to 60, 60 to 90 days), which the countdown prefills on applying; there is no "Can join from" date field yet. The switch is also in Settings > Pay, where Me's Change status goes. Job alerts and "open until the joining date" wait for the email sender and offers.

---

## 7. Map

- An SVG drawn from the path: Resume, Gaps, pitstops, Practice, Match. The prototype shows 11 pitstops across 9 goals.
- Colours: cobalt for done, `line` for ahead. The current pitstop has a dotted prep stretch with the train on it.
- Labels read "N · LEARN" or "N · PROVE", with the goal name below. Labels alternate above and below the line so they don't collide. Done pitstops get a check.
- Pitstops and goals the user adds are drawn as spurs labelled "ADDED BY YOU" or "YOUR CHOICE".
- The destination is the next role, not the last one in a career.
- Other lines are other role profiles that share a skill with the user's path. They cross at the shared skill. Rider counts come from opted-in users.
- **Life line** (switch at the top of the map):
  - Years run along the bottom, with rows for Journey, Education, Work, Certificates and Interests.
  - Only big moments go on it, never pitstops or prep. Journey starts at the end of first education. "Joined CareerMetro" is a point on it.
  - Zoom: "Last 5 years" is the default for careers over 7 years, with older moments behind an "N earlier moments" button. "Whole career" gives the recent 5 years 64% of the width.
  - Rows with 3 or more older moments group them into one numbered dot.
  - On phone it scrolls sideways and opens at Now.

---

## 8. Departures (`/departures`)

- Search (role, skill, company), city filter, work type filter, "Boarding now only", and tabs: All, Saved, Applied.
- **Work type**:
  - Full time, Part time or Freelance, taken from the post. The default is Full time.
  - Each row and the detail view show it, with hours or project length.
  - Part time and freelance roles show gaps and readiness the same way.
  - Freelance work the client confirms can become work proof.
  - The profile's "Open to" setting picks the default filter and alerts.
- Each role shows readiness in words and its gaps, each with the pitstop that closes it.
- "Apply on company site" opens the careers page. We record "applied", and the user moves it through Heard back, Interview and Offer.
- **Express apply** (bolt icon):
  - Sends a prefilled packet: contact, skills for the role, verified certificates, proof tasks, resume, and an editable note.
  - Nothing is sent until the user ticks a consent line naming that one company. Log every consent.
  - Gaps and the path are never sent.
  - Only for companies that accept it.
  - Each employer gates it per role: DigiLocker identity, verified skills, a skill-check level shown in words, a certificate, notice period, and gaps allowed. Each unmet criterion links to its fix.
- Saved roles notify the user when they are one gap away.
- Paste a job post: runs the same gap check against that one post.
- Never source roles from sites whose terms forbid it.

## 9. Arrivals (`/arrivals`)

- Applications a company moved forward, in lanes: Shortlisted, Level 1 AI interview, Level 2 team, Offer.
- A 10-day strip and a "Next up" card for the nearest date.
- "Not this time" keeps closed applications, with the company's note and the pitstop that would help.
- The Level 1 AI interview:
  - Says it is an AI before it starts.
  - Records only with consent and offers a person instead.
  - A person at the company decides.
- The practice round is Elite (not designed yet).

## 10. Timetable (`/timetable`)

- Lists only events whose topic matches one of the user's goals or interests. Nothing sponsored.
- Location comes from the profile city with a 25 km default radius, never the device. Online events are on by default. Events outside the radius are opt-in.
- Sources: organisers' public pages and feeds whose terms allow reuse, and moderated suggestions. Each event links to its source.
- "I'm going" on a goal event adds an optional prep task. It is never proof.
- A Monday digest goes out only when something matches. Turning it off is one tap.

## 11. Your profile (`/me`)

- Sections, in order:
  - Journey timeline
  - Skills by gap status (have, weak, missing)
  - Interests
  - Experience (current role marked Current), then **Your stories**, then Education
  - Proof tasks
  - Certifications (Credly)
  - Resume file
  - Who-sees-what switches
- **Current job is verified with a work email code** (Milin's requirement, 2026-10-10, Testing thread): adding the current or latest job needs a one-time code sent to the user's official email at that company, the same check as the HR work-email step in the Corporate tab. Details in 12d.
- "View as others" hides private sections and edit controls. It shows exactly what `/u/[handle]` shows a stranger.
- Gaps show only to connections unless the user turns that on.
- **Your stories**:
  - Every piece of work is written as a STAR story (Situation, Task, Action, Result).
  - Stories are sorted into six common boxes: Ownership, Problem solving, Delivering results, Learning, Working with others, Speaking up. A story can sit in more than one box.
  - Layouts: Board or List.
  - A SMART check (Specific, Measurable, Achievable, Relevant, Time-bound) shows as a checklist with one hint for the missing letter, never a score.
  - The model drafts stories from resume lines, and the user edits them.
  - Stories from proved goals are tagged "From your goal". Stories backed by work proof show "Confirmed".
  - Freshers start from college projects, internships and volunteering.
  - No company-specific principle labels.
  - Recruiters see stories on the profile under the normal visibility settings. There is no separate share button.

## 12. Junction and Network (later)

- Junction is a posting board with posts, votes, comments, reshares and pins, plus a My interests feed. The name is not confirmed.
- People appear as Name · status. Lists show only counts of shared skills and interests. A profile shows "In common with you".
- When users can post, CareerMetro becomes an intermediary under India's IT Rules 2021. That needs a grievance officer, complaint handling within 24 to 72 hours, moderation, and Report on every post. Decide this before Junction ships.

---

## 12a. Library (`/library`)

Designed 2026-10-09 (prototype v2, Library tab; dev notes have the full list).

- Tabs: For your goals (default), Your interests, Saved, Finished. Search, plus filters for type (course, video, docs, practice), length and language (Hindi).
- For your goals: one card per open goal, in map order. Each card has a **Learn** part (free resources, with the one behind the current pitstop marked "On your ride") and a **Prove** part (skill check, issuer-verified certification, manager-confirmed work, or a script you wrote). The card says that learning moves the train and only proof fills the gap. A goal that starts at proof shows "Brush up" instead of Learn.
- Details panel: what it covers, the pitstop it counts toward, cost, certificate (a free completion badge shows on the profile as learning, never as proof), how many people on your line finished it, Add to my rides (long courses split into daily tasks of about 25 min), Open on the source site, "I finished this", and Report a broken link.
- We can't see progress on other sites, so Finished is the user's own tick. Finishing learn resources prompts the proof; it never fills the gap.
- Your interests: picks for profile interests, labelled "Your choice". They never change goals or job match.
- Rules: free to learn only; an exam fee is shown before the click; no ads or affiliate links; reviewers re-check broken or outdated links; "Suggest a free resource" goes to a review queue.
- No resume: the goals tab asks for a resume; interests, saved and search still work.
- Data proposal (needs approval): `resources`, `user_resources` (saved, on_ride, finished_at), `resource_reports`, `resource_suggestions`.
- Built, part 1 (FR-51, 2026-10-20, against the frozen v44 copy): the four tabs, search, filters, goal cards with Learn or Brush up and Prove, "On your ride", the details panel and How the Library is picked, read only from the catalog, goals, path and ride ticks. Finished is the person's own ticks on Today's ride or the Path. Saved, "I finished this", Add to my rides, Report a broken link and Suggest a free resource wait for `user_resources`, `resource_reports` and `resource_suggestions` (a migration), and the screen says so. Your interests waits for profile interests. "People on your line who finished it" waits for a count we don't keep. The fifth tab, Elite, is the Elite shelf (12l, built in Elite part 5).

## 12b. Inbox (`/inbox`)

Added to prototype v2 on 2026-10-09, matching the Corporate mockup.

- Message icon with unread count in the top bar on every screen. Filters: All, Applications, People, Requests. On phone the list shows first and a chat opens full screen.
- Applications: one conversation per application, owned by the company and read by its job team; safety line about money, OTPs and bank details; link to Arrivals.
- "Asking for interview times": the user picks slots; a connected calendar greys out busy times (busy or free only); the company sees only the picked times. The calendar is never on the profile; "Usually free" only pre-fills picks.
- People: connections chat freely; anyone else sends one message request (Accept, Delete without telling the sender, Block and report). Report and Block on every chat. Phone and email never shown.
- Data proposal (needs approval): conversations, conversation_members, messages, blocks, reports, availability_patterns, calendar_links.
- Built (FR-55, 2026-10-20, `docs/plans/settings-columns-plan.md`): signed in, Your availability has "Usually free", Monday to Friday by the eight picker times as one row of time chips per day (the panel is narrow), saved from the Inbox, with a summary in words; "Ask for times" starts with the open slots in it ticked, and nothing is sent until Send. The pattern is a `user_settings.usually_free` column, not `availability_patterns`. No calendar yet: "Calendar: Not connected", "Connecting Google or Outlook comes later." "Who can message you" points to the new message requests switch in Settings > Privacy.

## 12c. Account settings (`/settings`)

Added to prototype v2 on 2026-10-09 (Milin's comment). Library is parked as designed.

- Reached from the new avatar menu (Your profile, Account settings, Inbox, Library, Network, Sign out) and from the profile page.
- Profile basics: photo, first and last name, username (careermetro.com/u/handle, availability check, change once every 30 days, old link redirects 14 days), optional headline.
- Email is locked: the sign-in identity can't be changed and is never shown to people or companies.
- Sign-in: Google, password change (12+ characters, leaked-password check, other devices signed out), signed-in devices.
- Two-step verification: authenticator app (TOTP) plus 10 backup codes; required for recruiter and HR access.
- Pay (current and expected, lakh a year): optional, private, never on the profile or sent to companies; used only to mark roles below expected pay. City on profile; "Open to work in" filters Departures.
- Built (FR-55, 2026-10-20, `docs/plans/settings-columns-plan.md`): Pay is now "Pay and location" with Current city (moved from Profile basics; not on the profile, only companies that can find you see it) and "Open to work in" chips, Remote first, up to 6, which open Departures on "Your places", go with Express apply applications and show in company search while you are in it. Privacy has "Allow message requests from people who aren't connections", on by default. Pay doesn't mark roles yet.
- Privacy (profile visibility, people lists, company search, message requests), notifications, download data, delete account (30-day grace). Sticky save bar.
- Your plan: Free during the beta; Elite card with prices Milin accepted for now (INR, 2026-10-09): monthly ₹299, yearly ₹2,499, Elite Pass ₹799 for 3 months paid once. UPI, card, net banking; GST invoices; cancel renewal; "Upgrade to Elite" in the avatar menu. No billing code during the beta.
- Data proposal (needs approval): profile fields on `profiles`; pay in a separate owner-only table, never logged; email, password, MFA and sessions stay in Supabase Auth.

## 12d. Verified current job (work email code)

Milin's requirement (2026-10-10; rule in section 11): the current or latest job on Experience is verified with the user's official work email and a one-time code. Milin approved the points below on 2026-10-10. Development builds it with the profile tables after Inbox and Account settings. No prototype screen yet.

- When: adding a job marked Current, or editing the company or start date of the current or latest job. Saving it as Current needs the code. Older jobs never ask.
- How: "Verify with your work email" in the job form. The user types their email at that company, gets a 6-digit code (valid 10 minutes, 5 tries), types it in the same field. Same mechanism as the HR work-email check in the Corporate tab; one check covers both.
- Domains: free mail (gmail, yahoo, outlook, hotmail, rediffmail, icloud, proton and similar) is refused with a plain line why. The domain must match the company; an unknown domain is accepted but queued for a quick review before the badge shows.
- Badge: "Verified with work email · Oct 2026" on the job in /me and wherever companies see the profile. The email address is never shown to anyone; we keep only the domain and the date, and discard the address after the check.
- No work email: Freelance and Self-employed jobs skip the check and show "Self-declared". "Looking for next role" has no current job, so nothing to verify. Someone at a company without work email can save the job as "Not verified"; it shows as such and they can ask a manager to confirm later (same route as PROVE by work experience).
- Re-check: changing the company or start date clears the badge and asks again. Adding an end date keeps the badge ("Verified while there").
- Limits: 3 code sends an hour and 10 a day per account, plus a per-domain limit, so the sender can't be used to spam a company. Ties to pending item 21 (code-send rate limit and proper email sender).

## 12e. Corporate workspace (employer side, mockup v1)

Approved by Milin on 2026-10-12 (C7). Mockup: https://claude.ai/artifact/X7dXtu2tpBaFD4KXm91PUk, source `corporate-mockup/source/v2/build-v2.py`. Its "Logic and dev notes" tab has every rule and table.

- One login only: the personal account. A Recruiter admin gives a person a role (Recruiter admin, at least 2 per company; Hiring HR; Interviewer). They then see a Corporate tab and confirm a work email on the company's verified domain with a 6-digit code, once. Removing the role ends access; the personal profile stays.
- Screens: Overview; Jobs (a six-lane board per job: Applied, Shortlisted, L1 AI, L2 team, Offer, Not this time, the same stages candidates see on Arrivals); candidate drawer (Profile, Match to this job, Stories, Resume, Activity); Interviews (the candidate's offered slots plus interviewers' busy times); Team and access; Messages.
- Recruiters see "Match to this job" only: the job's skills against the candidate's public skills and proofs, in words. Goals, path, streak, notice period (only "Can join"), salary, other companies' interviews and phone (until an interview is accepted, unless Express apply shared it) are never shown. An employee's own job search is hidden from their employer.
- Only applications made through CareerMetro appear; companies can't browse people.
- Application messages: one conversation per application, owned by the company (job team can write, assigned interviewers read only), with "Ask for times" and "Ask a question". Verified badge, anti-scam reminder, Report and Block.
- Tables (proposed): org_members, email_otps, application_events, interviews, interview_feedback, candidate_slots, conversations, conversation_members, messages, blocks, reports.

## 12f. Organization sign-up (`/corporate/new`)

Approved by Milin on 2026-10-12 (C8, pending item 17). In the Corporate mockup as the "New company" role.

- Four steps: Company, Verify, Company page, Review. Free during beta.
- Company: type (Company, College, Training partner), registered name, name candidates see, website, the person's work email, size, head office city. Free mail domains are refused; a domain already claimed shows "Ask for access" to that company's admins instead of a second company; a website and email domain that don't match are flagged for review.
- Verify: 6-digit code to the work email (10 minutes), or a DNS TXT record the IT team adds (checked for 7 days). After this, anyone added later confirms with a code on the same domain.
- Company page: logo, about (400 characters), industry, offices, optional GSTIN or CIN (private, never shown), invite a second Recruiter admin within 14 days.
- Review: CareerMetro checks every new company by hand before its jobs go live. The person can set up the team and draft jobs while waiting.
- The person signing up becomes the first Recruiter admin; their personal account and job search stay hidden from the company.
- Tables (proposed): organizations adds type, legal_name, display_name, website, email_domain, size, city, about, logo_url, gstin_or_cin (private), domain_verified_at, review_status, reviewed_by, reviewed_at; new org_domain_checks.

## 12g. Post a job (`/corporate/jobs/new`)

Approved by Milin on 2026-10-12 (C9, pending item 18). Opened from "Post a job" on Overview and Jobs.

- Starts from a role profile, which fills the track and skills. Title as posted, experience range, openings.
- Skills in three groups, same as role profiles: Required (at most 8), One of these, Nice to have (never blocks). Candidates see how they match these in words; Required skills decide Express apply.
- Work type (Full time, Part time, Freelance), workplace (On-site, Hybrid, Remote), city, optional pay range in ₹ lakh a year (blank shows "Pay not listed"), plain description.
- Applying: Express apply toggle for people who proved every required skill; stage list with the L1 AI interview on or off; Hiring HR and interviewers.
- Before sending, three required ticks: the job is real and open; no fee, deposit or paid training; no screening by gender, religion, caste, age, disability or marital status. Every new job is checked before it goes live; anyone can report a job and reports are looked at within 24 hours. Live preview shows the Departures card.
- Tables (proposed): jobs (org_id, role_profile_id, title, min_years, max_years, openings, work_type, workplace, city, pay_min, pay_max, description, express_apply, ai_round, owner_id, status draft/in_review/live/paused/closed, reviewed_by, reviewed_at), job_skills, job_interviewers, job_reports.

## 12h. Practice (`/practice`)

Approved by Milin on 2026-10-15 (C10, "Approve both" on the design thread card). Prototype v37. From Development's plan (dev/practice-match-plan.md, FR-21 to FR-23).

- Opens from the Path step "Practice", the avatar menu, the map's Practice pitstop and "Practice confidence" on Me.
- Skill picker: the user's goals, tagged current goal, goal ahead or goal met. 5 questions per skill from a reviewed question bank; the model never writes questions.
- Question card: the question, one line on what interviewers look for, an answer box with a word count, "Get feedback" (needs 5 words) and "Skip question". Privacy line: only you see answers, kept 30 days, in the data download.
- Feedback card: Structure, Specificity and Correctness in plain words, then "A stronger answer" (a sample to learn from, not a script). No score anywhere. Prompt prompts/practice-feedback/v1, logged in ai_calls; answers never logged.
- After feedback: "How sure do you feel about this now?" Not yet / A little / Fairly / Very. That self-rating is the only input to the confidence trend (FR-23), shown beside the question and on Me.
- Me: "Practice confidence" section, one sparkline per skill with the latest rating and session count. Private: hidden in "View as others" and never shown to companies.
- Practice never fills a goal or moves the train. On a met goal it says practice "keeps it sharp".
- Limits: 10 answers a day per person, shown as "N of 10 answers left today"; "Get feedback" disables at 0.

## 12i. Match (`/match`)

Approved by Milin on 2026-10-15 (C11, "Approve both" on the design thread card). Built 2026-10-15. Prototype v37. No AI; reuses the Nearby lines and "Closest to your resume" matcher (FR-24).

- Two groups. Ready now: every required skill met or proved. Within N weeks: path hours left on that role's open goals divided by the user's hours a week (3, 6 or 10), rounded up, sorted by weeks; the heading shows the largest N. Roles more than 26 weeks away stay off.
- Each card: role, "on your line" tag when it's on the destination line, weeks and path hours, cobalt bar of required skills met (progress), the open goals as chips, "Gaps for this role" and "N open jobs in Departures".
- Empty state ("No roles to show yet") when there's no resume or nothing within 26 weeks, with "Add your resume" and "Browse departures".

## 12j. Network (`/network`)

Approved 2026-10-19 by the Project manager under Milin's delegation, with the rulings below (prototype v39, Network tab, Arjun's profile and Account settings > Privacy). Asked for by the Project manager so Development can build Network next. Posts and feeds (Junction) are left out until pending item 15 is decided.

**Rulings (Project manager, under Milin's delegation, 2026-10-19):** (1) no Follow; (2) no note on requests; (3) keep "Only you" as it is and add "Your connections" as a new option, default for new users only, no rename and no loosening of anyone's saved choice; (4) gaps default to "Your connections" for new users only.

**Fidelity pass against Development's plan (`dev/network-plan.md`), 2026-10-19:** Development builds from its plan; this section now follows it where they differed (Find people tab, 30 searches an hour, 100 requests waiting, 20 results, "On your line" later). The design extras marked *(C13)* were approved on 2026-10-19 by the Project manager under Milin's delegation. "On your line" stays Later. The three-way gaps choice applies to new users only, and no saved choice is ever loosened.

**Connections**
- A connection is two-way and needs the other person to accept. There is no Follow and no feed until Junction ships.
- Connect from a Find people result or a profile. There is no free-text note, so a request can't carry spam or abuse. *(C13)* The sender picks how they know the person (On the same line, Worked together, Studied together, Met at an event, Other), shown to the receiver and on the connection row.
- If two people ask each other, they are connected at once.
- Limits: 20 new requests a day and up to 100 waiting on others at once; one open request per pair; a request expires after 30 days, then it can be sent again.
- The person asked sees it under Requests on `/network`, with a count on the Requests tab and next to Network in the top nav and avatar menu. Nothing on Today. Accept, or Ignore (silent: the sender isn't told and their copy ends after 30 days).
- The sender sees it under Sent as "Requested", with Withdraw.
- Remove: from the connection's row menu or their profile menu, confirmed inline. The other person isn't told. What only connections get ends at once (gaps shared with connections, free chat; the old chat stays in Inbox, new messages need a message request). Either person can connect again.
- Block ends any connection or request, hides both people from each other's search, lists and profiles, and stops messages between them. Unblock in Account settings. Report uses the same review queue as Inbox reports.

**`/network` page**
- Header, then a "Let people find me" bar (the same switch as in Settings), then tabs: Connections (count), Requests (count), Sent (count), Find people (the name search). On phone the last tab shows as "Find".
- Connections: sort Recent or Name A to Z. Each row: avatar, name, verified tick, @handle, status, target role only if they show it, city, shared-skill count, connected date; Message; menu with View profile, Remove connection, Block, Report. *(C13)* how you know each other.
- Requests rows show when it came. Sent rows show when it was sent and when it ends.
- *(C13, Later)* "On your line": up to 3 people aiming at the same role who turned on "Let people find me" and aren't connected, ordered by shared skills, never by anything paid. Drawn with a Later tag.
- Empty states: no connections (Find someone you know, Copy your profile link), no requests, nothing sent, no search results.
- Phone: tabs fill the width, actions sit under each row, inline panels (connect, remove, block) open under the row. No pop-up dialogs.

**Name search (T44 member search waits on this)**
- At least 2 letters, or an @handle. Matches the start of the first name, last name or handle.
- Shows only people who turned on "Let people find me", are signed up with a name and aren't suspended. Never people you blocked or who blocked you. *(C13)* Your own connections are always findable by you.
- Up to 20 results, best first: your connections, then most skills in common, then name. No paging in v1.
- Each result: the same row as above and the right button (Connect, Requested, Accept, Message). Never email, phone, employer history, gaps or pay. *(C13)* Optional filters Aiming for my role, my city, Verified, and a mutual-connection count.
- 30 searches an hour per person; results are never exportable.
- No result: "People who keep Let people find me off can't be found by name. Ask them for their profile link instead."

**On a profile (`/u/[handle]`)**
- Header button by state: Connect; Requested (Withdraw in the menu); Accept request and Ignore; or Message plus a quiet "Connected" with Remove in the menu.
- "In common with you" shows shared skills and target role. *(C13)* "Mutual connections" there, listing only people you are both connected to. Nobody can browse anyone else's connections, and no connection count shows on other people's profiles.
- A connection sees gaps the person shares with connections; the "Gaps and path" block says why.

**Who can find whom, and privacy (Account settings > Privacy)**
- "Who can open your profile": Everyone signed in / People on your line / Your connections / Only you. "Your connections" is new and is the default for new users only. "Only you" stays exactly as built (nobody, connections included), and nobody's saved choice changes (ruling 3, 2026-10-19).
- Gaps: the plan keeps the existing "Show my gaps" switch, read as "Show my gaps to connections"; new users start with it on (ruling 4), existing users keep what they saved. Companies never see gaps. *(C13)* A three-way choice instead: Nobody / Your connections / Everyone who can open your profile, for new users only; existing users keep their saved choice, mapped without loosening it.
- "Let people find me": off by default. Separate from "Let companies find me", which stays as built.
- *(C13)* "Connection requests from": Anyone who can reach you (default) / Nobody.
- "Allow message requests from people who aren't connections" stays.
- A "Who sees what" table in Settings sums it up for anyone signed in versus your connections.

| What | Anyone signed in | Your connections |
|---|---|---|
| Find you by name | Only with "Let people find me" | Always |
| Open your profile | As set in "Who can open your profile" | Unless you picked "Only you" |
| See your gaps | Only with "Everyone who can open your profile" | Unless "Nobody" |
| Ask to connect | Unless "Nobody" | Already connected |
| Message you | One message request, if allowed | Chat freely |
| See who you are connected to | Never | Only the people you both know |

**Data (Development's plan, migration 0034)**
- `connections`: `user_a`, `user_b` (pair stored with `user_a < user_b`), `status` pending / accepted, `requested_by`, `ignored_at`, timestamps.
- `user_settings.people_can_find` (default false). `profile_visibility` gains `connections`, the default for new users only; `only_me` is unchanged and no saved value is migrated.
- Uses the existing `blocks`, `reports` and `rate_limits`.
- *(C13)* would add `connections.how` and `user_settings.requests_from` (anyone / nobody), and turn the gaps switch into `gaps_visible_to` (nobody / connections / profile). Each needs approval before any migration.

## 12k. Build your resume (`/builder`)

Approved 2026-10-19 (C14) by the Project manager under Milin's delegation, for pending item 23 (approved by Milin 2026-10-19). Prototype v39: the "No resume yet? Build one" link on the Resume step (User: No resume) opens it. Development builds it after Network. Needs `prompts/build-resume/v1.md`, logged in `ai_calls`.

- Entry: "No resume yet? Build one in about 10 minutes" under the upload box on the Resume step. "I have a resume after all" goes back.
- Seven short sections, one card at a time, with a section list on the left (a row of numbered dots on phone) and Back / Next with a cobalt progress bar: Role (target role, Not sure yet; Studying / Just graduated / Working / On a break; name; city), Education (degree, college, start and end year, optional marks), Projects (name, "What did you build or do?" in plain words, optional link; add another), Internships and jobs (Internship / Job / Freelance / Volunteer, company, title, from and to month, what you did; add another; "I haven't worked yet" skips it), Tools (picked chips for the role, tools named in earlier answers pre-picked and labelled "from your project", add your own), Certificates (name, issuer, month earned, optional badge link checked before a verified tick; "None yet"), Links (GitHub, portfolio, LinkedIn, email on the resume; phone only on the downloaded file).
- Answers save as you go and are used only to write the resume. They never go into logs or analytics, like resume text.
- Review page before Gaps: a plain one-column resume preview. Every line is a button that shows the answer it came from. A side panel lists "Skills we found", each with its source answer; a skill with no answer behind it is never added. "Suggested, not added" lists what the model would add (a tool it guesses, a missing number) with "Yes, add it" or "Leave out"; nothing there enters the resume until the person adds it.
- Required tick "Everything here is true and mine." before "Check my gaps", which runs the same confirm step and gap match as an upload. Also "Download PDF or DOCX" (FR-20, ATS-friendly: one column, standard headings, no photos or tables) and "Edit answers".
- No-fabrication rule (FR-19): the model only rewords what the person typed. It never adds a skill, tool, employer, date or number. In the prototype, the numbers in the lines ("3 home machines", "about 20 tickets a week") come from the sample answers.

## 12l. Elite (`/elite`, `/mock`, Library Elite shelf)

Approved by Milin on 2026-10-19 (C15), for pending items 10 and 20, together with the Elite status, violet colour and Library Elite tab added after his questions (prototype v44). Prices stay as shown for now; Milin will revisit them before launch. Free during the beta: no billing code, no card, no checkout. Built in parts (`docs/plans/elite-plan.md`); part 1 (FR-50) is the plan switch below, part 2 is `/mock`'s timed test and question bank, and part 3 the mock interview. The Library Elite shelf comes in a later part and is copied here when it is built.

- `/elite` upgrade page: headline, what stays free (gaps, path, daily rides, Library free shelf, Departures), a Free and Elite table, and "Turn on Elite, free in the beta" (not cobalt). Turning it on unlocks everything until the beta ends. Copy promises at least 30 days' notice before the beta ends; doing nothing returns the person to Free with everything they made kept, and nothing renews on its own.
- Prices after the beta, labelled "not charged now" and "not final": Elite monthly ₹299, Elite yearly ₹2,499 (Best value, about ₹208 a month), Elite Pass ₹799 for 3 months paid once. Links to "Your plan" in Account settings (prototype v33).
- Free and Elite rows: Practice 10 answers a day vs no daily cap; question bank 5 questions vs the full bank with model answers; mock interviews, timed tests, the Arrivals practice round, the Elite shelf and the Elite badge are Elite only. Proof still fills gaps on both.
- Library Elite tab and shelf (v44, Milin asked for paid courses and materials): a fifth Library tab "Elite" (lock icon while off). It holds three groups: Paid courses, included (video courses with labs and exam-prep packs, each showing "Usually ₹X · Included"; an exam fee stays separate and is said so), Expert playbooks and walkthroughs (including recorded mock interviews with notes), and Drills and labs (browser labs, nothing to install). On "For your goals" a preview shows the paid-courses row with "See the whole Elite shelf". Free users see every card dimmed with "Opens with Elite, free during the beta" and Turn on Elite. Rules: nothing is bought separately, no ads or affiliate links, we earn nothing from what is opened; we pay the experts and course makers; order follows the person's goals, never who made it; finishing moves the train, only proof fills a gap. Licensing paid courses is a business decision for Milin before launch.
- Built in part 5 (Development, 2026-10-20): the Elite tab (`/library?tab=elite`) with the lock icon while off, the locked panel's Turn on Elite to `/elite`, and three groups from `src/content/elite-shelf.json`, the person's goals first. Until licensing deals exist (elite-plan "Not in this plan"): Paid courses are "Coming soon" slots with no maker, price ("Usually ₹X") or link; Playbooks and walkthroughs (named without "Expert" until people in the role write or check them) and Drills and labs hold free catalog sources and a few playbooks and drills Development wrote, marked "Not yet checked" and shown on local and preview only until someone who works in the role checks them. On Free the cards show what they are with "Opens with Elite", not dimmed (dimmed text fails contrast), and no link or step is sent. No recorded mock interviews and no "For your goals" preview row yet: there is nothing paid to preview.
- Verified tick: never for sale. It shows after an identity check (one-time ID check, or a work email for a current job, section 12d) and on a certificate whose badge link matched its issuer. The Elite badge is separate, says nothing about identity or skill, never ranks anyone in search or Departures, and is off on a profile unless the person turns it on.
- Where Elite shows once it is on (added v41 after Milin asked): a small award mark on the avatar; "Elite · beta" under the name in the avatar menu, whose Elite item reads "Elite is on"; a "Your plan" card on your own profile (only you see it; hidden in View as others) with "Show the Elite badge on my profile" (off by default) and a Mock interview link; the Elite badge next to your name when that switch is on, as on Arjun's profile; Account settings > Your plan shows "Elite, free in the beta" with the badge switch and Turn off. Free users see "You're on Free" on that card with See Elite.
- Entry points in the app (v43): avatar menu "Interview prep" (Elite label) and "Build your resume"; Practice's "Mock interview" button; a job's "Interview prep for this role" in Departures and Arrivals' "Practice round" open /mock; your profile's Resume card "Edit in builder" and the Resume step's "No resume yet? Build one" open /builder.
- Colours (Milin, 2026-10-19): Elite has its own violet, used for nothing else, so it stands apart from progress (cobalt) and gap status (red, amber, green). New tokens `elite` #6d3fd6, `elite-soft` #efe8fd, `on-elite` #ffffff; dark mode `elite` #b49bff, `elite-soft` #2a1f4a, `on-elite` #120c22. Used for the Elite badge and labels, the avatar mark, the Turn on Elite and See Elite buttons, the Best value price, the Elite column of the comparison table, the profile plan card and the badge switch. Not gold.
- Built in part 1 (Development, 2026-10-20): everything above except the links to `/mock` (Interview prep, the plan card's Mock interview link, Practice's button, Departures and Arrivals), which come with `/mock`. The verified tick's one-time ID check is not built (needs a provider); the tick keeps today's routes.
- `/mock` Interview prep with three tabs. Locked panel with "Turn on Elite" when off.
  - Mock interview: role, length (Quick 10 min / 4 questions, Full 20 min / 8 questions), focus (Mix, Your gaps, Technical, About you), answer by typing or speaking (text kept 30 days, audio never kept). States that the interviewer is an AI and can be wrong; questions come from a people-checked bank. Running: a countdown timer (inverts in the last minute), question with the AI interviewer, answer box, Next and "End and get feedback". Feedback: a summary in words, then per question your answer, "What worked" and "Add next time"; skipped questions link to the bank. No score. Practice never changes gaps.
  - Timed test: 12 multiple-choice questions in 15 minutes, like company screening tests, then a review of every question with the right answer explained and a count of right answers (the only number shown).
  - Question bank: by role, filter by topic, each question opens a "strong answer covers" note and "Practise this one". Free users see 5 open and the rest locked.
- Built in part 2 (Development, 2026-10-20): `/mock` with the timed test and the question bank, the locked panel, and the entry points avatar menu "Interview prep" (Elite label), Practice's "Mock interview" button and the plan card's link (named "Interview prep" until the mock interview exists). The Mock interview tab says it comes next (part 3). The timer is ink, inverting in the last minute; cobalt is only the test's progress bar. The time used is not shown in the review, so the count right stays the only number. Departures' "Interview prep for this role" and Arrivals' "Practice round" wait for those screens' parts. The multiple-choice questions are Development's own and marked unreviewed; production uses only reviewed ones.
- Built in part 3 (Development, 2026-10-20): the Mock interview tab, where Elite now opens. Set-up: Role (a picker, the target role by default), Length (Quick round, 10 min · 4 questions; Full round, 20 min · 8 questions), Focus (Mix, Your gaps, Technical, About you), Answer by (Typing or Speaking, shown only where the browser turns speech to text on the device, with "The audio never leaves your device and is never sent or kept"), the note "The interviewer is an AI and it can be wrong. The questions come from CareerMetro's question bank, not from AI. We keep the text of your answers 30 days.", and Start mock interview (ink, not cobalt). Running: "Question N of M · topic", the timer (ink, inverting in the last minute), the cobalt progress bar, the AI interviewer row with the question, the answer box with a word count, Next question (Finish on the last), End and get feedback, and Speak or Stop when speaking. Feedback: "Feedback on your round" with the role and "N of M answered", the summary in words (or why there is none: nothing answered, not available today, not available just now), each question with the answer (cut at 220 characters), What worked and Add next time, "Skipped. Open it in the bank" on skipped ones, "Practice gets you ready. Proof fills the goal. Mock interviews never change your gaps.", Another round and Study these in the bank. No score. The prototype's "asks follow-ups like a person would" is not built: the questions come from the bank only. The profile plan card's link now reads Mock interview.

## 13. Data model proposals (need Milin's approval before any migration)

Current tables: organizations, users, consents, waitlist_entries, resumes, profiles, skills, skill_aliases, role_profiles, job_descriptions, ai_calls, gap_analyses, resources, resource_checks, paths, path_steps, audit_logs.

| Change | Fields | For |
|---|---|---|
| Auth tables (from the chosen provider), plus `resumes.user_id` | | Sign-up |
| `users` adds `handle`, `status_text`, `job_search`, `open_to` (work types), `city`, `radius_km` | | Profile, Departures, Timetable |
| `ride_days` (new) | user_id, day, tasks_done | Streak |
| `role_tracks`, `role_track_skills` (new) | track_id, skill_id, level, group_id, weight | Tracks |
| `skill_prereqs` (new) | skill_id, needs_skill_id | Goal order |
| `user_goals` (new) | user_id, skill_id, source (gap or user), status, skipped_at, swapped_to | Goals, Not for me |
| `path_steps` adds `goal_id`, `kind` (learn or prove), `source` (app or user) | | Pitstops |
| `gap_proofs` (new) | user_id, skill_id, type (skill_check, certification, work), evidence, verified_at, verifier | Proof |
| `notice_periods` (new, private) | user_id, days, resigned_on | Job search |
| `saved_roles`, `applications` (new) | user_id, role or posting, status, dates, consent_id | Departures, Arrivals |
| `stories`, `story_competencies` (new) | user_id, title, s, t, a, r, source, confirmed; story_id, competency | Your stories |
| `events`, `event_topics`, `event_rsvps` (new) | title, kind, start, end, city, lat/lng, online, cost, source_url, status | Timetable |
| `interests`, `user_interests` (new) | | Interests, Junction, Timetable |

Rules for all of them:

- Write the Zod schema and tests before the code that fills them.
- Resume text never goes into logs or analytics.
- Log the prompt version on every AI call.

## 14. Open decisions

1. Sign-in provider: Auth.js or Clerk (Google plus email magic link; phone OTP later). Needed before PR 3.
2. Approval of the data model in section 13, one PR at a time.
3. Names: Junction, Timetable and Arrivals are working titles.
4. Grievance officer for user posts (pending item 15). Needed before Junction or member-suggested events.
5. Change of destination role: the proposal is that gaps are recalculated, proof carries over, and the old line greys out while the new one branches off. Milin's answer is pending.

## Changes since handoff v1

Every change to prototype v2 after this handoff was first given to Development. Status is "proposed" until Milin approves it in the design thread, then "approved"; only approved entries are handed to Development. Section numbers above stay stable.

| # | Date | Screen | What changed | Prototype | Section | Status |
|---|---|---|---|---|---|---|
| C1 | 2026-10-09 | Library (`/library`) | New screen: goal cards with Learn resources and Prove options, interests tab, saved, finished (user's own tick, prompts proof, never fills a gap), details panel, suggest a resource. Milin parked it as designed. | v29, v30 | 12a | proposed |
| C2 | 2026-10-09 | Inbox (`/inbox`) | New screen: message icon with unread count in the top bar; applications, people and message requests; "Ask for times" slot picker with calendar busy greying; availability panel. Same rules as the Corporate mockup. | v31 | 12b | approved (Milin, 2026-10-10) |
| C3 | 2026-10-09 | Account settings (`/settings`) and avatar menu | New screen: profile basics, locked email, username rules, password, two-step verification (required for recruiter and HR), private pay, city, privacy, notifications, download and delete. Avatar now opens a menu (profile, settings, inbox, library, network, sign out) instead of going straight to `/me`. | v32 | 12c | approved (Milin, 2026-10-10) |
| C4 | 2026-10-09 | Account settings: Your plan | Elite upgrade section with suggested prices (monthly ₹299, yearly ₹2,499, Elite Pass ₹799 for 3 months), payment methods, invoices and cancel; "Upgrade to Elite" in the avatar menu. Prices accepted for now in INR (Milin, 2026-10-09). Design only: no billing code during the beta. | v33 | 12c | approved (design and prices; build waits for billing to be scheduled) |
| C5 | 2026-10-10 | Experience: verified current job | Current or latest job needs a code sent to the user's work email at that company; free mail refused; badge shows, email never shown; freelance and self-employed are "Self-declared"; re-check when company or start date changes; send limits. From Milin's requirement R1 (Tester thread). Rule in section 11; details in 12d go to Milin with Development's plan. No prototype screen yet. | none yet | 11, 12d | approved (requirement and 12d details, Milin, 2026-10-10) |
| C6 | 2026-10-12 | Market (`/market`), top nav and avatar menu | New screen asked for by Milin: search by role, state or city; tile map of India (one square per state) coloured by openings or median pay, tap a state for its top roles, top cities and pay; role trend (Growing, Steady or Shrinking over 12 months); pay bands by experience (middle half and median); top cities; Nearby lines (related roles, shared skills and required skills to add, real from role profiles); compare the same role in two places. Fewer than 15 openings a month shows "Not enough data". Every card names its source and month; all market figures are example data until Data research's tables land, in the same row shape (role × state [× city] × experience band, openings, pay p25, median, p75, source, month). Heat map in five plum steps (v36, after Milin asked for colour), kept apart from cobalt and the gap-status colours; cobalt only on the shared-skills progress bar. | v35, v36 | new (dev/market-plan.md) | approved (Milin, 2026-10-12); built 2026-10-13 |
| C7 | 2026-10-12 | Corporate workspace (employer side) | Corporate mockup v1 brought into the handoff: Corporate tab and roles, work-email code, Jobs board lanes, candidate drawer with "Match to this job" only, Interviews, Team and access, company-owned application messages. Milin set Corporate before Market and Nearby lines (2026-10-12). | corporate v1 | 12e | approved (Milin, 2026-10-12) |
| C8 | 2026-10-12 | Organization sign-up | New flow: company details, domain check (free mail refused, claimed domain asks for access), code or DNS verify, company page, second admin within 14 days, manual review before jobs go live. First Recruiter admin. Pending item 17. | corporate v2 | 12f | approved (Milin, 2026-10-12) |
| C9 | 2026-10-12 | Post a job | New form: from a role profile, required / one-of / nice-to-have skills, work type, workplace, city, optional pay, Express apply, stages with L1 AI toggle, three required honesty ticks, review before live, live Departures preview. Pending item 18. | corporate v2 | 12g | approved (Milin, 2026-10-12) |
| C10 | 2026-10-15 | Practice (`/practice`) and Me | New screen from Development's Practice plan: skill picker, question with answer box, feedback in words with a stronger sample answer (no score), self-rated confidence feeding a private per-skill trend on Me. Never fills a goal; 10 answers a day. | v37 | 12h | approved (Milin, 2026-10-15) |
| C11 | 2026-10-15 | Match (`/match`) | New screen from Development's Match plan: roles grouped "Ready now" and "Within N weeks" (path hours ÷ hours a week), open goals per role, links to Gaps and Departures, empty state. No AI. | v37 | 12i | approved (Milin, 2026-10-15); built 2026-10-15 |
