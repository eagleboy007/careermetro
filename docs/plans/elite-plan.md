# Elite, free in the beta (plan)

Date: 2026-10-19. C15, handoff section 12l, prototype v44. Milin approved the design himself in the design thread on 2026-10-19 at 23:08 UTC ("all elite and new screens are good ... pricing lets keep the same for now ... proceed"). The Project manager pre-approved this plan unless it finds a real risk. It touches the data model and the AI pipeline, so it follows CLAUDE.md's "plan first". Every choice below is **Decided by Development 2026-10-19** unless it quotes 12l. Requirement number: **FR-50**.

## What it is

Elite is a switch a person turns on, free until the beta ends. It unlocks mock interviews, timed tests, the full question bank, no daily cap on Practice and the Elite shelf. There is **no billing code**: no card, no checkout, no payment provider, no price ids. Prices show as "not charged in the beta" and "not final".

## Not in this plan

- Any payment, invoice or renewal. Turning Elite off, or the beta ending, returns the person to Free with everything they made kept.
- An ID check for the verified tick (needs a provider and its own privacy review). The tick keeps today's routes only: an accepted proof, a verified current job (FR-47) or a Credly-matched badge.
- The Arrivals practice round (12l lists it as Elite only; Arrivals' AI round isn't built, so it follows that).

## Risks found (need a decision before the shelf ships)

1. **The Elite shelf needs the Library.** `/library` (12a, C1) is still "proposed" and parked, and the nav marks it not built. This plan builds the shelf's data and gate, and shows the shelf on `/library` only once the Library is approved and built. Until then the Elite page lists the shelf as "coming with the Library". Nothing else waits on this.
2. **Expert-checked shelf content and the people-checked mock question bank need content work.** The bank starts from the existing Practice bank (`src/content/practice-questions.json`, 95 questions, already people-checked) plus model-answer notes written by a person and reviewed like resources; nothing the model writes goes into the bank. Shelf items are curated like resources, still with no ads or affiliate links.

## 1. Screens (12l)

- `/elite`: headline, what stays free, the Free and Elite table, the three prices labelled "not charged now" and "not final", and "Turn on Elite, free in the beta" (ink, never cobalt). Copy promises at least 30 days' notice before the beta ends. Links to Account settings, Your plan.
- Where Elite shows when on: the ink award mark on the avatar, "Elite · beta" in the avatar menu (whose item reads "Elite is on"), a "Your plan" card on your own `/me` (hidden in View as others) with "Show the Elite badge on my profile" (off by default), the badge next to your name on `/u/[handle]` only when that switch is on, and Settings, Your plan with the switch and "Turn off". Free users see "You're on Free" with See Elite.
- `/mock` with three tabs; a locked panel with "Turn on Elite" when off.
  - **Mock interview:** role (target role by default), Quick (10 min, 4 questions) or Full (20 min, 8 questions), focus (Mix, Your gaps, Technical, About you). Typed answers; spoken answers use the browser's own speech-to-text, so audio never leaves the device and is never sent or kept. States that the interviewer is an AI and can be wrong. A countdown (inverting in the last minute), the question, an answer box, Next and "End and get feedback". Feedback in words, then per question "What worked" and "Add next time"; skipped questions link to the bank. No score.
  - **Timed test:** 12 multiple-choice questions in 15 minutes, then every question with the right answer explained and the count of right answers (the only number shown).
  - **Question bank:** by role, filter by topic, each question opens "a strong answer covers" and "Practise this one". Free users see 5 open and the rest locked.
- The Elite badge never ranks anyone in Network, Departures or company search. Practice never changes gaps.
- Colours: ink for Elite everywhere; cobalt only for the mock's progress bar.

## 2. Data model (migration 0036, RLS on every new table)

- `user_plans`: `user_id` pk (cascade), `elite_since timestamptz null` (null is Free), `badge_shown boolean default false`, `updated_at`. Turning off sets `elite_since` null and keeps everything else. No row means Free.
- `mock_sessions`: `id`, `user_id` (cascade), `role_slug`, `length` (`quick` | `full`), `focus` (`mix` | `gaps` | `technical` | `about`), `question_ids text[]` (bank ids, chosen deterministically), `started_at`, `ended_at null`, `feedback jsonb null` (summary in words), `ai_call_id null`. Index (`user_id`, `started_at`).
- `mock_answers`: `session_id` (cascade), `position smallint`, `answer text` (1 to 4,000 characters), `what_worked`, `add_next_time` (text, null until feedback). Primary key (`session_id`, `position`). Answer text is kept 30 days, then the daily clean-up deletes the answers and keeps the session's dates and summary, as Practice does (`PRACTICE_KEEP_DAYS`).
- `timed_tests`: `id`, `user_id` (cascade), `role_slug`, `question_ids text[]`, `picks smallint[]`, `started_at`, `ended_at`, `right smallint`. Deterministic scoring, no model.
- Content: `src/content/mock-bank.json` (Zod `mockQuestion`: id, roleSlugs, skillId, topic, kind `open` | `choice`, question, strongCovers for open, options and answer index and explanation for choice, level). People-checked, built from the Practice bank.
- Export version +1 (plan, sessions with answers still kept, tests). Account delete removes all of it (cascade).

## 3. The mock interview prompt

- `prompts/mock-interview/v1.md`, one call at "End and get feedback" for the whole session (questions as data from the bank, answers as the person's text, both escaped as Practice does). Structured output with a Zod schema: `summary` and per question `whatWorked` and `addNextTime`, in words, never a score, grade, rating or "ready". Logged in `ai_calls` with `prompt_name` `mock-interview` and its version, inputRefs ids only. Answers never reach logs or analytics.
- The questions come from the bank; the model never writes the questions it asks.
- **Its own daily budget:** `MOCK_DAILY_BUDGET_USD` (default $3) across everyone, checked from `ai_calls` where purpose is `mock-interview`, separate from the parse budget; plus `LIMITS.mockSessionsPerUserDay` (5) and `LIMITS.mockFeedbackPerUserDay` (5). Past the budget the session still ends and saves, and the page says feedback isn't available today.
- An eval set (`fixtures/evals/mock/`, synthetic answers) run by `npm run eval:mock`, never in CI, with scoring tests that run in CI: no number or score words, nothing that says ready or not ready, length caps.

## 4. Gates

- One server check, `eliteOn(userId)`, read by every Elite page and action. A Free person calling an Elite action gets "Turn on Elite to use this", never a crash. Practice's 10 answers a day apply to Free only.
- Turning on and off is limited to 10 changes a day per person (shared limit), so it can't be scripted.
- The verified tick stays exactly as built: it is computed from proofs and checks, never from the plan.

## 5. Build, in small PRs (after the resume builder)

1. Plan switch: migration 0036 (`user_plans` only), `/elite`, Settings Your plan, avatar mark and menu line, badge on profile, Practice cap for Free only, `/design`, FR-50.
2. Mock bank content and `/mock` question bank and timed test (no model), `timed_tests`.
3. Mock interview with the prompt, its budget and limits, `mock_sessions` and `mock_answers`, the eval set.
4. Elite shelf, once the Library is approved and built.

Each PR copies the 12l lines it builds into `docs/design/post-login-handoff.md` and updates STATUS.

## Risks checked

- Money: no billing code anywhere; prices are copy only.
- Fairness: the badge never ranks and never stands for identity or skill; the tick is never for sale.
- Privacy: audio never leaves the device; answers are treated like Practice answers (30 days, never logged).
- Cost: its own daily budget and per-person limits; the session never blocks on the model.
