---
name: careermetro-dev
description: How to build, check, review and ship a CareerMetro change without wasted work. Read before starting any code task in this repo.
---

# CareerMetro development routine

CLAUDE.md and docs/REQUIREMENTS.md stay the contract. This skill covers how to work so that no work is done twice.

## 1. Daily plan
- At the start of each UTC day, write that day's target at the top of `dev/daily-plan.md` in the project files.
  - List 2–4 tasks from the queue, each with a one-line "done when" check.
  - The plan is a target and a record, not a cap. When it is done, start the next queue item.
- At the end of the day, mark each task done or carried over.

## 2. Plan, then size the PR
- Before you build, write a few lines per task: what changes, which files, which tests. That way the first review passes.
- One PR per feature, not 5–10 small ones. Fold related fixes in. Every PR costs a review, CI, merging main back in and a Vercel deploy.
- Shared files change once per feature, in the feature's PR:
  - the `/design` gallery
  - `e2e/walk.mjs`
  - `docs/REQUIREMENTS.md`
  - the schema and migration list

## 2b. Before writing code
- Search for an existing helper, component or store function first (`rg`), and reuse it. Do not write near-duplicate code for each screen.
- Read only the section of a large file you need, such as the handoff, the plan or REQUIREMENTS. Do not read it from the top every time.
- Pick the next free migration number and the current `EXPORT_VERSION` from `origin/main` once, when the branch starts.
- At most two builders run at a time, and each works in a different area. Two branches must never both touch `src/lib/goals/store.ts`, migrations or the export version.

## 3. While building
- Run only the tests for what changed: `npx vitest run path/to/file.test.ts` and `npx tsc --noEmit`.
- Write the Zod schema and tests before the code that fills them.
- Fix a review finding at its root cause once. Don't go back and forth.

## 4. Full check, once, right before the single push
```
npm run lint && npm run typecheck && npm test && npm run build
```
- Run `npm test` on both DBs: the seeded local DB and a fresh migrated one. CI's DB is unseeded.
- Run the e2e walk (`node e2e/walk.mjs`, see e2e/README.md) against a production build. Check its FAIL lines and the exit code.
- Take fidelity screenshots only for screens the change touches.

## 5. Review
- The reviewer gets the diff (`git diff origin/main...HEAD`) plus the builder's check results. The reviewer reads code; it does **not** copy the repo, create a DB, or re-run the suite.
- The report is 10 lines or fewer: a verdict, then blocking findings with `file:line`, then a short non-blocking list.
- One review pass per PR. Fix real problems only. Leave nits unless they ride along on a push you are making anyway.
- Review fixes are new commits on the same PR. Never amend.

## 6. Push and merge
- Push once per PR. Related small fixes go in one PR, and review fixes go in the same PR.
- No exploratory pushes, no repeated fetches, and no CI polling loops. Wait on the merge script only.
- Re-run CI at most once, and only for a failure that is not caused by this PR.
- After merge, delete the merged branch: `git push origin --delete <branch>`. Never delete an unmerged branch; list those for the Project manager instead.
- After merge, send one line to the Project manager.

## 7. Security checks the reviews keep finding
- **Route guards.** Every page and server action checks the session and the role. Corporate screens also check the person's company role.
- **Suspended or unverified companies.** Every company-side read checks the org status first, including jobs, applications, messages, interviews and find-people. A suspended company gets an empty view with a notice, never candidate data.
- **Ownership.** Every update or delete is scoped to the owner (`userId` or `orgId`) in the `WHERE` clause, not only checked in the UI.
- **Blocks.** A block stops chats, scheduling and contact both ways.
- **Locks and races.** Take the person lock first, then the badge lock. Run `takeShared` inside the transaction (`{ db: tx }`).
- **Proof.** Only proof fills a goal. A Credly link fills a goal only after the check confirms it. A pending row never counts as Met anywhere: goals, criteria or apply packet.
- **Privacy.**
  - Never put resume text, posting text, names, emails, phones, codes or message text in logs, analytics, responses or URLs.
  - Phone, email, salary and notice period never appear on profiles.
- **Tables.** Every new public table gets `ENABLE ROW LEVEL SECURITY`.
- **Secrets.**
  - Never use `CRON_SECRET` as a fallback for a crypto key.
  - Never commit secrets or real resumes. Use `/fixtures`.

## 8. UI rules
- Never let focus drop to `body`.
  - On a focused button, use `aria-disabled` with an early return instead of `disabled`.
  - Move focus in a `useEffect` keyed on a counter.
- Use tokens only, never literal colours. Cobalt means progress. Red, amber and green are for gap status only.
- Icons are `lucide-react` with `strokeWidth={1.75}`. Add new components to `/design`.

## Definition of done
- [ ] The plan lines were written before building, and the PR covers one whole feature.
- [ ] Zod schema and tests exist, including a DB test for any store or security change.
- [ ] REQUIREMENTS.md, `/design`, the walk test and the migration list were updated once, if the feature touches them.
- [ ] Lint, typecheck, test (both DBs), build and the e2e walk all passed locally, once, before the push.
- [ ] One review pass, with blocking findings fixed.
- [ ] Pushed once, CI green, merged, and the branch deleted.
- [ ] The Project manager has had a one-line note, and the daily plan is updated.
