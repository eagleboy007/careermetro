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
| `good` / `good-soft` | `#11805b` / `#e2f4ec` | `#4cc79a` / `#11302a` | Gap met, "Boarding now" |
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
