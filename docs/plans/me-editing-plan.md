# Me editing: plan (v44 gap item 23)

Development, 2026-10-20. Source: handoff section 11 "Your profile", `dev/profile-plan.md` (Milin, 2026-10-10: the `stories`, `story_boxes` and interests tables, and drafting with a prompt), the v44 prototype's Me view, and `src/components/me/me-view.tsx`. Pre-approved by the Project manager under Milin's delegation. One PR, with one migration; no AI call (choice 1).

## What the person sees

The four "· soon" controls on `/me` become real. Each opens an inline form on the page (no modal). Save gives the toast "Saved." and Cancel puts focus back on the control.

- **Experience, "+ Add role"**:
  - Fields: Job title, Company, Started (month and year), Ended (month and year), "I work here now". At most one row can be current; ticking it here clears the box on the others.
  - The section label stays "{total} · from your resume". An added role carries a small "Added by you" label and Edit and Delete links. Resume roles keep "Replace" and "Edit in builder" on the Resume card and are never edited here.
  - A role added as current gets the same work-email badge and "Verify with work email" flow as a resume role (FR-47). That flow is off in production until the email sender exists, so it shows "Work-email checks open soon."
  - With no resume, the empty state "Your roles fill in from your resume." becomes "Your roles fill in from your resume, or add them by hand."
- **Education, "+ Add"**: Qualification, Institution and Year (free text, such as "2024" or "2021 to 2024"), with "Added by you", Edit and Delete. With no resume: "Degrees and courses fill in from your resume, or add them by hand."
- **Your stories, "+ Add story"**:
  - The prototype intro stays: "Every piece of work you have done, as a short Situation, Task, Action, Result story, sorted into what interviewers ask about. Recruiters see it when they open your profile."
  - Form:
    - Title, and "Where and when" ("Konkan Co-operative Bank · 2025").
    - Situation, Task, Action and Result, each a box of up to 400 characters with a live count.
    - The six box chips (Ownership, Problem solving, Delivering results, Learning, Working with others, Speaking up), at least one.
    - An optional "From a goal", which picks one of the person's goals.
  - The Board and List layouts, the per-box empty line "No story yet. Think of a time you {…}." and the count "{n} stories · {k} boxes empty" now read saved stories.
  - Each card shows the SMART checklist with one hint for the first missing letter, never a score. "From your goal" shows when a goal is linked. "Confirmed" shows when that goal's skill has accepted work proof.
  - Each story has Edit and Delete. Delete asks "Delete this story?" with Delete and Keep.
  - The "drafted … saved · soon" line becomes: "Write your first story: a time at work, college, an internship or volunteering. Keep each part short."
- **Interests, "+ Add"**: a chip input, "Add an interest, e.g. Photography" and Add (the prototype's placeholder). Each chip has a remove ×. The label "anything, not only work" stays.
- **View as others and `/u/[handle]`**: added roles and education show under the Experience and Education switches. Stories show when Experience is on. Interests show whenever the profile is visible. Resume lines stay hidden, as now.

## Data (migration 0042, export version 28)

All tables are owner-only. RLS is enabled with no policies, and every FK is indexed.
- **`me_roles`**:
  - Columns: id, user_id → users (cascade), title (1–120), employer (1–120), start_month (YYYY-MM), end_month (YYYY-MM or null), is_current, created_at, updated_at.
  - Checks: end ≥ start; end null when current. One current row per user (partial unique index where is_current). Index (user_id, start_month).
- **`me_education`**: id, user_id → users (cascade), qualification (1–160), institution (1–160), year (≤ 40, null), created_at, updated_at. Index user_id.
- **`stories`**:
  - Columns: id, user_id → users (cascade), title (1–120), where_text (≤ 120), situation, task, action and result (each ≤ 400), goal_id → user_goals (set null), source (`user`; `resume`, `goal` and `college` are kept for drafting later), created_at, updated_at.
  - Indexes: (user_id, updated_at), goal_id.
- **`story_boxes`**: story_id → stories (cascade), box (a check against STORY_BOXES). PK (story_id, box).
- **`user_interests`**: user_id → users (cascade), name (1–40), name_key (lower, trimmed, single spaces), created_at. PK (user_id, name_key).
- **Caps**: 20 roles, 12 education rows, 50 stories and 30 interests per person, checked in the store.
- **Retention**: kept until the person deletes them or the account goes. No cleanup job.
- **Export v28** adds `meRoles`, `meEducation`, `stories` (with their boxes and the goal's skill name) and `interests`.
- **Deleting an account** removes all five tables by cascade, and a deleted goal sets `stories.goal_id` to null.

## Server checks and limits

- Zod-strict inputs (`meRoleInput`, `meEducationInput`, `storyInput`, `interestInput`) come first, with tests. The user id comes from the session, and edit and delete match on `(id, user_id)`. Someone else's row is a 404.
- Text that shows to others (role, education, story, interest) refuses email addresses, phone numbers and links, with the same check as the Express apply note (`applicationNote`). The message is "Leave out email addresses, phone numbers and links."
- A role matching a resume role (same title and employer, ignoring case) is refused: "That role is already on your resume."
- `goal_id` must be one of the person's own goals.
- Rate limit: 100 Me edits a day per person (`shared-limit`). Story text never goes into logs or analytics; only event names are logged.
- **SMART check** in plain code (`src/lib/me/smart.ts`), worked out each time a story is shown and never stored:
  - S, Specific: Where and Action both filled, with Action at least 12 words.
  - M, Measurable: a number in Result.
  - A, Achievable: Task names the person's own part ("I", "my").
  - R, Relevant: a goal is linked, or a box is chosen beyond the first default.
  - T, Time-bound: a year, month or duration anywhere in the story.
  - Hint: one line per letter, for the first one missing.
- `buildMe` merges added roles with resume roles by start date. `experienceTotal` counts the union of spans. The matcher, gaps and company Match still read only the confirmed resume profile.

## Choices made

1. **Stories are hand-written only in v1.** No model call, so nothing changes in `ai_calls`. Drafting from resume lines (`prompts/draft-story/v1.md`, already approved in profile-plan with 10 drafts a day) is part 2, in its own PR with the eval. That is why the prototype's toast "We draft it as Situation, Task, Action, Result; you edit it before it is saved" is not used yet.
2. Added roles and education live in their own tables, not as a new profile version. The person's resume, gaps and company Match stay what the resume says.
3. Resume-derived rows are not editable on Me. Corrections go through the resume review, Replace, or Edit in builder.
4. Stories follow the existing Experience switch. Interests show on any visible profile. No new switches.
5. Interests are free text per person, stored with a normalised key. A shared `interests` table waits for Junction.
6. "Confirmed" is worked out from accepted work proof on the linked goal's skill, never set by the person.
7. One current role at a time. The FR-47 work-email check applies to an added current role as it does to a resume one.
8. Public text refuses contact details and links, as the Express apply note does, so a story can't be used to share contact details.

## Not in this plan

- Story drafting (choice 1).
- Interest-based Library picks ("Your choice") and Junction topics.
- Status line ("Change status", which is job-search-plan) and "Show my pitstop on the map".
- Reordering stories.

## Tests

- Schemas: limits, the month order, one current role, the contact-detail refusal, at least one box, and the export v28 shape.
- `smart.ts` unit tests for each letter and the hint order.
- DB:
  - another user's rows are never read or changed (a 404);
  - the caps;
  - duplicate interest keys;
  - a resume-duplicate role refused;
  - cascade on account deletion;
  - a deleted goal leaves the story with no goal;
  - FK indexes.
- `buildMe` merges and sorts roles, and the total covers overlapping spans. View as others and `/u/[handle]` show added rows only under their switches.
- e2e: add a role, education, a story (in the Board, then List) and two interests. Edit and delete one of each. Check View as others. axe checks in light and dark at phone width.
- `/design`: each form, a story card with a full and a partial SMART check, and the "Added by you" rows.

## Choices made while building

Development, 2026-10-20, in the same PR as the plan's build.

1. **Ending another current role.** Ticking "I work here now" on one added role ends the other: its end month becomes the new role's start month, or its own start month when that is later, so an end never comes before a start.
2. **An ended role needs an end month.** The database holds `is_current = (end_month is null)`, so a role is either current with no end or ended with one. The form says "Pick when it ended, or tick I work here now."
3. **Months are two selects.** Started and Ended are a Month select and a Year select (1970 to this year), because `<input type="month">` is missing in some browsers. A half-picked month is refused with "Pick a month and year."
4. **Only a title and one box are required for a story.** Situation, Task, Action and Result may be empty; the SMART hint coaches the rest. No box is picked for the person.
5. **SMART, as built** (`src/lib/me/smart.ts`). R counts "a box beyond the first" as more than one box chosen. T counts a year from 1990 to 2039, a month name (not "May" alone, which is also a verb), a number or word with a duration ("3 weeks", "two months", "a year") or daily, weekly, monthly, quarterly, yearly or overnight. A counts "I", "my", "me", "myself" and "I'm", "I've", "I'd", "I'll" as whole words in the Task.
6. **What others see of a story.** Title, Where and when, the four parts, its boxes, "Confirmed" and "From a goal". The SMART letters, the hint and the goal itself are the owner's coaching and stay on their own view. Row ids are replaced in the public profile, so nothing an Edit uses reaches another browser.
7. **"Added by you" is shown to the owner only.** Others see an added role or course like a resume one. The rows follow the Experience and Education switches.
8. **Links.** Text others read (roles, education, stories, interests) refuses email addresses and phone numbers with the Express apply note's check (`hasContactDetails`), and links: `http://` or `https://`, `www.`, or a name on a common top-level domain (.com, .in, .org, .io, .me, .ly, .link, .xyz, .site, .online, .co, .info, .app, .dev, .gg, .to). `.js` and `.net` are left out on purpose, so Node.js and ASP.NET pass. The domain must be lowercase, so "Pune.In 2023" passes. A company or institution may be a domain ("Booking.com", "Amazon.in"), so those two fields skip the domain check; `http(s)://` and `www.` are refused there too.
9. **Delete asks first everywhere.** Roles ("Delete this role?") and education ("Delete this?") ask as stories do, with Delete and Keep. Keep puts focus back on Delete; after a delete, focus moves to the section's add control.
10. **Interests' add control is the box itself.** On the person's own view the chip input "Add an interest, e.g. Photography" with Add is always shown under the chips, as in the prototype's interests form, rather than behind a "+ Add" toggle. Removing an interest that is already gone is fine.
11. **"Interests in common" on `/u/[handle]`.** The strip gains "N shared interests" and In common gains "Interests · N of your M" with the shared ones as the owner wrote them and "<name> also lists …" (three, then "and N more"). It shows only when both people list interests. Interests show on any profile the viewer may open (choice 4), so nothing hidden is compared.
12. **"From a goal" lists all the person's goals,** by skill name in map order, whatever their status. "Confirmed" uses the goal's swapped skill when the goal was swapped ("Not for me", FR-48).
13. **Companies.** The found-person view and the Express apply packet keep reading the confirmed resume only, as plan choice 2 says for the matcher and Match. Added rows reach a company only through `/u/[handle]`, under the owner's switches.
14. **The daily limit** counts every add, edit and delete that passes the input check, refused or not (a full list, a resume duplicate, someone else's row). Input the schema refuses isn't counted.
15. **Copy.** The work-email check's "no job" message now reads "Add your current job to your resume or on your profile first." The note above Me reads "Others see only the parts you choose in Account settings. Your resume lines never show. Interests show to anyone who can open your profile." in place of "Your stories and interests come next."
