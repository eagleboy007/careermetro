# Build your resume (plan)

Date: 2026-10-19. Pending item 23, approved by Milin on 2026-10-19 (decision card in the Project manager thread). The screens are handoff section 12k (C14, approved by the Project manager under Milin's delegation, prototype v39). The Project manager pre-approved this plan step. It touches the data model and the AI pipeline, so it follows CLAUDE.md's "plan first". Every choice below is **Decided by Development 2026-10-19** unless it quotes 12k or pending item 23. Requirement number: **FR-36** (pending item 23 proposed it; the number was never used).

## What it is

A person with no resume answers seven short sections instead of uploading. Their answers become a profile, the model rewords only the free-text answers, and from there the app treats the result like a parsed resume: the confirm step, Gaps, Path, Today, and the PDF and Word download (FR-20).

## Not in this plan

- Rewriting an uploaded resume for a role (FR-19's draft). This plan reuses its no-fabrication rule but doesn't build that draft.
- A photo, a cover letter or more than one template.
- Anonymous use. The builder needs an account because answers are saved as the person goes. The first-analysis flow for people who aren't signed in stays upload-only. "Build one" sends someone who isn't signed in to sign up and then to `/builder`.

## 1. Screens (12k)

- Entry: "No resume yet? Build one in about 10 minutes" under the upload box on the Resume step goes to `/builder`. "I have a resume after all" goes back.
- Seven sections, one card at a time. A section list sits on the left (numbered dots on phone). Back and Next with a cobalt progress bar, which counts sections done: progress, so cobalt is correct.
  1. Role: target role (from the role list, or "Not sure yet", which uses "Closest to your resume" on the result); Studying / Just graduated / Working / On a break; name (prefilled from the account and locked as it is everywhere since the name lock); city (PERSON_CITIES, optional; the same field as Settings).
  2. Education: degree, college, start and end year, optional marks. Add another.
  3. Projects: name, "What did you build or do?" in plain words, optional link. Add another.
  4. Internships and jobs: Internship / Job / Freelance / Volunteer, company, title, from and to month (to may be "Now"), what you did. Add another. "I haven't worked yet" skips it.
  5. Tools: chips for the role's skills (the role profile's required and nice-to-have skills, by taxonomy name). Tools named in earlier answers are pre-picked and labelled "from your project" (or "from your job"); the person can add their own.
  6. Certificates: name, issuer, month earned, optional badge link. A badge link gets the verified tick only after the Credly check, as on Me. "None yet".
  7. Links: GitHub, portfolio, LinkedIn, and the email on the resume. The phone number goes only on the downloaded file and is never stored (decided here: typed at download, held in memory for that request).
- Review page before Gaps: a plain one-column resume preview. Each line is a button that shows the answer it came from. A side panel lists "Skills we found", each with its source answer. "Suggested, not added" lists what the model would add, with "Yes, add it" and "Leave out".
- A required tick, "Everything here is true and mine.", then "Check my gaps", plus "Download PDF or DOCX" and "Edit answers".
- Same frame, fonts and tokens as the Resume step; mono labels; 44px targets; no pop-ups, panels open inline; axe in light and dark mode and at phone width in the e2e walk.

## 2. Data model (migration 0035, RLS on)

- `resume_drafts`: `user_id uuid primary key` (cascade), `answers jsonb not null` (Zod `builderAnswers`), `updated_at`, `resume_id uuid null` (the resume made from it, set null on delete). One draft per person. Saved on every Next and on blur, debounced. "Edit answers" reopens it. Deleted with the account, and included in Download your data (export version +1).
- `resumes` gets `source text not null default 'upload'` with `'builder'` as the second value (a check constraint on the new column). A built resume has `mime_type` `application/vnd.careermetro.builder+json`, `size_bytes` the answers' byte length, `status` `parsed`, no file and no storage key. Its `name_hashes` come from the account name, so the existing name check passes as it does for an upload with that name.
- The profile is stored in `profiles` like any other version 1, `ai_call_id` the reword call. Corrections on the confirm step make new versions as today.
- Nothing else changes. Gaps, Path, goals and the export read profiles, so they work unchanged.

## 3. How answers become a profile (no fabrication, FR-19)

1. **Deterministic first.** `profileFromAnswers(answers)` in `src/lib/builder/profile.ts` builds the `Profile` with no model. Education rows come from Education. Roles come from Internships and jobs (an internship gets "(Internship)" after the title only when the person picked it; freelance uses "Freelance" as employer only when they gave no client name). Projects become roles with employer "Project" and the dates left empty. Skills are the picked tools only, plus the names of certificates. Certifications are certificates with month earned. `totalYearsExperience` is computed from the job months, rounded down, with internships and projects not counted.
2. **The model rewords only free text.** `prompts/build-resume/v1.md` gets the "What did you build or do?" and "what you did" answers, each with an id, and returns at most 4 resume lines per answer, plus `suggestions[]` of `{ kind: "tool" | "number" | "wording", text, answerId }`. It may reorder and tidy words; it must not add a skill, tool, employer, date or number. Structured output with a Zod schema, as parse uses.
3. **Verify, then keep.** Each returned line passes `lineSupported(line, answer)`. Every number in the line must appear in that answer, and every taxonomy skill or tool name in the line must appear in that answer or among the picked tools. A line that fails is dropped and the answer's own text (trimmed and split into sentences) is used instead. So a bad model reply can only make the resume plainer, never untrue. `verifyProfile` then runs over the result with the concatenated answers as the "resume text", the same AI-5 step as upload.
4. **Suggestions stay out** until "Yes, add it". Adding a tool suggestion adds it to the picked tools (so it now traces to the person's own choice); adding a number or wording suggestion opens that answer for the person to edit. The model's text never goes in directly.
5. **Every skill traces to an answer.** "Skills we found" shows each skill's source: the chip pick, or the answer that named it. A skill with no source can't be built, because the profile's skills come only from picks and certificate names.
6. The reword call is logged in `ai_calls` with `prompt_name` `build-resume` and its version, as every AI call is. Cost is reserved before the call (H4) under the same daily budget as parse. If the model is unavailable, the deterministic profile (step 1, with answers split into lines) is used and the person is told the wording is plain for now. The builder never blocks on the model.

## 4. Privacy and limits

- Answers are resume text: never in logs, analytics, audit lines or URLs. Server actions take them in the request body only. `logEvent` gets section numbers and counts only.
- Limits (`LIMITS`, shared by every server): 60 draft saves an hour, and 5 rewords a day per person, which counts toward the parse budget. Each "Check my gaps" after an "Edit answers" makes a new reword, with a new profile version on the same built resume rather than a new resume.
- Answers have caps: 20 rows per section, 600 characters per free-text answer, 30 tools, and Zod lengths on every field. Typed links must be `https` (GitHub only on github.com).
- Phone: never stored (section 1).

## 5. Build, in one PR (after Network parts 1 to 3)

- Zod `builderAnswers` and the reword output schema, with their tests, first.
- `src/lib/builder/`: `profile.ts` (deterministic), `verify-lines.ts` (`lineSupported`), `reword.ts` (model call, with the local mock in `src/lib/ai/local-mock.ts`), and `store.ts` (draft save and load, `buildResume`, which makes or updates the resume and profile).
- `prompts/build-resume/v1.md`, and an eval case set in `fixtures/evals/builder/` (synthetic answers), run by a new `npm run eval:build` (not in CI), with scoring tests that run in CI without the API, as `eval:explain` does.
- Migration 0035, export version +1, delete by cascade.
- `/builder` and the review page, `/design` entries, the e2e walk (both themes, phone width, axe), and FR-36 in REQUIREMENTS.
- DB tests: a draft round-trips; a built resume reaches Gaps; a fabricated model line (a new number, a new tool) is dropped; suggestions stay out until added; another person's draft is unreachable.

## Risks checked

- Fabrication: the profile's facts are built without the model. The model's lines are checked word by word against the person's own answer, and anything that fails falls back to their own text.
- Privacy: answers are handled like resume text, and the phone number is never stored.
- Cost: one reword call per build, under the parse budget and a daily limit.
