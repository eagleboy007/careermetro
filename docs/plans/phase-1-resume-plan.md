# Phase 1, part 1: Resume upload and parse (plan for approval)

Date: 2026-10-07. Covers FR-2, FR-4 to FR-7, AI-1/3/5/6/7 and SEC-1/4/5/6 in docs/REQUIREMENTS.md.

## What a user will see
1. A **Start** page: upload a PDF or DOCX (max 5 MB) or paste text. A required consent checkbox explains that the resume is used only for this analysis, is never used to train models, and that the text is sent to Anthropic (our AI provider) in the US.
2. A short "Reading your resume" wait (about 10 to 30 seconds).
3. A **Resume** review page that shows the parsed profile: roles, employers, dates, skills with the line they came from, education and certifications. The user can fix or remove anything and then click **Looks right**. Nothing is analysed until they confirm (FR-6).

No sign-in yet. FR-2 allows one anonymous analysis. A cookie holds a random session id, and anonymous data is deleted after 24 hours.

## How it works
- **No file is stored.** The text is extracted from the PDF or DOCX in memory on the server (`unpdf` for PDF, `mammoth` for DOCX) and the file is then discarded. This meets SEC-5 without a storage bucket or a new secret. We keep only the parsed profile.
- **PII masking before the AI call (SEC-6).** Phone numbers, email addresses, PIN codes and street addresses are replaced with placeholders in code. The name stays because the profile needs it.
- **Parsing (AI-1).** One Claude call with structured output, constrained to the existing `profile` Zod schema. The model is Claude Opus 5.5, at an estimated 5 to 8 US cents per resume. The prompt lives in `prompts/parse-resume/v1.md`. The resume is wrapped as untrusted data and the model gets no tools (AI-7). Each skill must carry a verbatim quote from the resume; a check in code drops any skill whose quote is not in the text (AI-5).
- **Logging (AI-3, AI-6).** Every call writes an `ai_calls` row: model, prompt version, tokens, cost, latency and ok. No resume text goes into logs, errors or analytics.
- **Limits (AI-6, SEC-7).** 3 parses per session and 20 per IP per day, a 5 MB cap, type checks on the file bytes, and a global daily spend cap that turns parsing off if it is crossed.
- **Database.** The existing `resumes`, `profiles` and `ai_calls` tables fit. The only migration makes `resumes.file_delete_after` nullable, since no file is kept. A daily Vercel cron deletes unclaimed anonymous rows older than 24 hours.

## Quality gate
- `npm run eval:parse` runs the parse prompt over the 13 synthetic resumes in `fixtures/evals`. It reports skill recall and hallucinations with the scorer from PR #5.
- In CI this needs `ANTHROPIC_API_KEY` as a GitHub secret too. It runs only when files under `prompts/` or the parser change, to keep cost down.

## PRs, in order
1. Text extraction and PII masking (no AI), with tests on synthetic PDF and DOCX fixtures.
2. Parse prompt v1, Claude call, `ai_calls` logging, limits and the eval runner.
3. Start page with consent, and the Resume review and edit page (on `/design` too).
4. Anonymous session cookie, the 24-hour cleanup cron and the small migration.

After this comes part 2: the deterministic gap matcher and the Gaps page.

## Decisions needed
- Approve this plan (required by CLAUDE.md for AI pipeline work).
- Model: Opus 5.5 is recommended for parse accuracy. Haiku 4.5 is cheaper (about 1 to 2 cents) and can be measured on the eval set later.
- Add `ANTHROPIC_API_KEY` as a GitHub Actions secret (Settings → Secrets and variables → Actions) for the eval runner.
