# Mock interview follow-ups: plan (v44 gap item 20)

Development, 2026-10-20. Source: handoff 12l (Elite part 3: "asks follow-ups like a person would" is not built), the v44 prototype's mock interview, `src/lib/mock/interview.ts` (questions picked by code; the model's only part is feedback in words when the session ends) and `prompts/mock-interview/v1.md`. Pre-approved by the Project manager under Milin's delegation. It touches the AI pipeline (a new prompt version), so the CLAUDE.md rules apply: the prompt version is logged in `ai_calls`, the budget stays as it is, and there is an eval. Two PRs: PR 1 is the code, the migration, prompt v2 and the eval; PR 2 is the follow-up content for the bank.

## What the person sees

- **Set-up note**: for a role with follow-ups, the prototype's line replaces today's. "The interviewer is an AI. It asks follow-ups like a person would, and it can be wrong. Questions come from a bank checked by people who work in the role." The sentence "We keep the text of your answers 30 days." stays.
- **Running**:
  - After the person presses "Next question" on an answer of 20 words or more, the AI interviewer row may ask one follow-up before the next question.
  - The row reads "Follow-up · {topic}" above the follow-up's text, such as "Before blocking anything, say how you would tell a known scanner from a user who forgot a password." (the prototype's own line).
  - A fresh answer box opens with its word count. The buttons are "Next question" ("Finish" on the last) and "Skip follow-up".
  - The progress bar and "Question N of M" don't move for a follow-up. The timer keeps running, so a follow-up takes time from the round, as in a real interview.
  - When the person ends the round or time runs out, any open follow-up draft is saved with the rest.
- **Feedback**: each question shows the answer (cut at 220 characters), then the follow-up asked and its answer, labelled "Follow-up" and cut the same way, then "What worked" and "Add next time" covering both.
  - A follow-up skipped or left empty says "Follow-up skipped." and gives no link.
  - The rest of the feedback screen is unchanged: the summary in words, "N of M answered" (main questions only), no score anywhere.
- **Question bank tab**: each open question lists its follow-ups under "a strong answer covers", so people can study them. Free users see them only for their 5 open questions.

## Data (migration 0044, export version 30)

- **`mock_answers`** gets two columns (an expand-only migration):
  - `follow_up_id text null`: the bank follow-up asked after this answer.
  - `follow_up_answer text null`: the person's reply.
  - Checks: `char_length(follow_up_answer) between 1 and 4000`, and `follow_up_answer is null or follow_up_id is not null`.
- There are no new tables or FKs, so no new index is needed. RLS on the table is already enabled.
- **Retention**: unchanged. `clearOldMockAnswers` deletes the answer rows after 30 days, follow-up answers with them. The text is never logged, and never goes to `ai_calls` or analytics.
- **Export v30** adds `followUp: {question, answer}` to each answer in `exportMockSessions`.
- **Deleting an account**: no change. The cascade from users to `mock_sessions` to `mock_answers` already covers it.
- **Content (`src/content/mock-bank.json`)**: each open question gains `followUps: [{id, text (≤ 200), skipIf: string[] (≤ 8 words or phrases)}]` (0 to 2 of them) and `followUpsReviewed: boolean`.
  - Development writes them in PR 2 for the other 85 open questions, using the prototype's style. Each one names the next step a team would expect.
  - They are marked `followUpsReviewed: false`, so production asks none until someone who works in the role checks them, as with the timed test. Local and preview builds use all of them.

## Server checks and limits

- **Picked by code, never by the model.** `pickFollowUp(question, answer, used)` in `src/lib/mock/interview.ts` returns:
  - nothing when the answer has fewer than 20 words, or when the round has used its share: up to 2 follow-ups in a Quick round and 4 in a Full one;
  - otherwise the first follow-up for which no `skipIf` word or phrase appears in the answer (case-insensitive, on word boundaries, so an answer that already covers the point is not asked it again);
  - otherwise nothing.
- **Saving**:
  - `saveMockAnswer` saves the answer and runs `pickFollowUp` in the same transaction. When it picks one, it stores `follow_up_id` and returns the follow-up's text.
  - A new `saveFollowUpAnswer({sessionId, position, answer})` is Zod-strict, 1–4,000 characters, and only for a position whose `follow_up_id` is set. It follows the same closed-session and grace rules as answers (`sessionClosed`, `ANSWER_GRACE_MS`).
  - A follow-up can't be asked twice for one position. Saving the main answer again after a follow-up was picked keeps that follow-up.
- **No new AI call.** The one end-of-round call stays the only model call:
  - it moves to `prompts/mock-interview/v2.md`, and `loadPrompt("mock-interview").id` logs v2 in `ai_calls`;
  - v2 adds, inside `<mock_interview>`, the follow-up asked for each position, and puts the reply in `<follow_up position="N">` tags;
  - v2 asks for whatWorked and addNextTime to cover the answer and its follow-up together, within the same 40-word caps;
  - every v1 rule stays: no score, never "ready", no invented facts, data not instructions.
- **Budget and limits unchanged**:
  - `MOCK_DAILY_BUDGET_USD` (default $3);
  - 5 rounds and 5 feedbacks a person a day;
  - the per-purpose advisory lock.
  - `IN_FLIGHT_MOCK_USD` goes from 0.12 to 0.15 for the longer input, and the call's `max_tokens` is unchanged. With at most 4 extra answers of up to 4,000 characters each, the input stays well under the model's window.
- `feedbackProblems` and `feedbackShowable` are unchanged. The `given` text for the number check now includes the follow-ups and their answers.

## Choices made

1. **A follow-up is not a model call per answer.** Follow-ups come from the bank, picked by code.
   - CLAUDE.md keeps the model to parsing and explanations, and `interview.ts` promises "the model never writes or picks a question".
   - A per-answer call could add up to 8 calls to a Full round, which is 8 times today's spend against the same $3 budget.
   - It would add 2–5 seconds of waiting while the timer runs.
2. Feedback on follow-ups is folded into the existing single end-of-round call (prompt v2). There is no second call.
3. At most one follow-up per question, 2 a Quick round and 4 a Full one, so a round still covers its questions in the time.
4. `skipIf` keywords stop a follow-up the answer already covers. This is plain matching that can be tested, and no score is involved.
5. Answers under 20 words get no follow-up. The feedback's "Add next time" covers short answers.
6. The timer runs through follow-ups, as the prototype's one clock does.
7. Follow-ups wait for review in production (`followUpsReviewed`), like the timed test's choice questions. Until then production behaves as today; the set-up line switches to the prototype's wording only for a role that has reviewed follow-ups.
8. A follow-up does not count toward "N of M answered", which counts bank questions only.

## Not in this plan

- Spoken follow-ups read aloud (text-to-speech).
- Company-specific follow-ups for Arrivals' practice round.
- Follow-ups for the timed test.
- Model-written follow-ups (choice 1). These would need Milin's approval and a change to CLAUDE.md.

## Tests

- Schemas:
  - `mockOpenQuestion` with `followUps` (strict, ≤ 2, text ≤ 200);
  - `saveFollowUpAnswerInput`;
  - the v2 feedback input;
  - the export v30 shape.
- A bank content test: every follow-up id is unique, `skipIf` is not empty when there are two follow-ups, and there is no follow-up text in production while `followUpsReviewed` is false.
- `pickFollowUp` unit tests: the 20-word floor, skip words, the per-round cap, first match wins, stable for the same input.
- DB (`interview-store.test.ts`):
  - a follow-up is stored once and answered once;
  - it is refused after the session closes or on a position with no follow-up;
  - another user's session is a 404;
  - the 30-day cleanup clears follow-up answers;
  - the export includes them.
- Feedback: one call per round still, with v2 logged in `ai_calls`. The fake client sees follow-up tags, and the budget and limit refusals still end the round with the answers saved.
- `npm run eval:mock` gains two fixtures with follow-ups (one covering the point, one dodging it) and checks the v1 rules over v2 output. It is never run in CI.
- e2e: a Full round where a long answer gets a follow-up, a short answer doesn't, Skip follow-up works, and the feedback shows both. axe checks in light and dark at phone width.
- `/design`: the running state with a follow-up, and a feedback item with one.

## Choices made while building

Built on branch `v44-mock-followups` (migration 0044, export version 30, `prompts/mock-interview/v2.md`), on top of the notifications branch (0043, v29).

1. **Scope of PR 1.** The code, the migration, prompt v2 and the eval, plus follow-ups for the 10 about-you questions (`communication-1` to `-5`, `stakeholder-management-1` to `-5`, all `followUpsReviewed: false`). Every role's Mix and About you rounds use those, so the e2e walk and `/design` can show a follow-up and the eval can use bank follow-ups. The other 85 open questions get theirs in PR 2. Production asks none of them until they are reviewed.
2. **`pickFollowUp(question, answer, { used, length, allowUnreviewed })`.** The plan's `used`, plus the round's length for the cap (2 Quick, 4 Full) and the review gate (`unreviewedAllowed`, as for the timed test). Skip words match whole words in any case, so "log" is not found in "login", and a phrase may have any spaces between its words.
3. **The set-up note has three states** (`MockRole.followUps`):
   - `none` keeps today's line.
   - `draft` (local and preview only) says "It asks follow-ups like a person would, and it can be wrong" and keeps "The questions and follow-ups come from CareerMetro's question bank, not from AI". Nothing has been checked, so it doesn't use the prototype's "checked by people who work in the role".
   - `checked` shows the prototype's line, once every follow-up a role's rounds can ask is reviewed.
   - A role's state counts its own open questions and the about-you ones.
   - Reviewer: the prototype's line also says the bank's questions were checked by people who work in the role. Today the 95 questions are self-checked only (STATUS, Next up item 3), so set `followUpsReviewed` only after the questions are checked too.
4. **Next waits for the server only when it might matter**: a changed answer of 20 words or more. Shorter answers save in the background as before. A follow-up on the last question is allowed, and its button reads Finish.
5. **Skip follow-up saves nothing.** The asked id stays, so the feedback says "Follow-up skipped." The same goes for a follow-up left empty when the round ends.
6. **Replies can be saved again** (the newer one wins), so a retried save never fails. A reply that didn't save is kept on the page and goes with "End and get feedback", with the open follow-up's draft.
7. **Reloading the page resumes at the next unanswered question.** An open follow-up is not asked again; it counts as skipped. The running view's shape is unchanged.
8. **Clearing an answer** (an empty Next) deletes its row, and the follow-up asked after it goes too. The UI never goes back, so this is a corner of the API only.
9. **What the prompt gets.** It gets a follow-up only when the person replied: `followUpAsked` in that question's JSON, and the reply in `<follow_up position="N">` right after the answer. A skipped follow-up isn't sent. The number check's `given` text includes the follow-ups and replies (the eval's `givenText`).
10. **A reply sent for a position with no follow-up** is refused as `invalid`. Someone else's session is `not_found`, as for answers.
11. **In the download**, `followUp` is null when none was asked. Its `question` is null if the follow-up has since left the bank.
12. **The bank tab** lists them under "Follow-ups the interviewer may ask", below "A strong answer covers". A locked question sends none.
13. **Part 2** (branch `v44-followups2`): one or two follow-ups for the other 85 open questions, in part 1's shape and style, all `followUpsReviewed: false`. The schema's cap of two a question stays. A skip word may not appear in its own question, since nearly every answer would then say it and the follow-up would never be asked. The review draft is `dev/mock-followups-draft.md` in the project files. Prompt v2 and `npm run eval:mock` are unchanged.
