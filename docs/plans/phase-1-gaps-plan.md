# Phase 1, part 2: Role picker and Gaps (plan for approval)

Date: 2026-10-07. Covers FR-8, FR-11 to FR-14, AI-2 and AI-4 in docs/REQUIREMENTS.md. Part 1 (resume upload, parse and check) is live.

## What a user will see
1. After **Looks right** on the Resume page, a **role picker**: the 13 roles as cards, with a search box. Pasting a job description comes later.
2. A **Gaps** page for that role:
   - A readiness line in plain words, for example "You cover 9 of the 14 skills this role requires. About 30 hours of focused work closes the rest."
   - The top 5 gaps, ordered by how often employers ask for them. Each gap shows its status (missing, weak evidence or outdated), the line from the resume it is based on (or "Nothing in your resume shows this"), what the role expects, and a one- or two-sentence explanation.
   - The skills already covered, collapsed, and nice-to-have skills listed separately.
   - A "Are these gaps right?" rating (1 to 5), which is the beta's accuracy metric.

## How it works
**The matcher is plain code, with no AI (decided 2026-10-06).** It compares the confirmed profile with the role profile:
- **Finding the user's skills.** A parsed skill name maps to the taxonomy by exact name or alias. Evidence lines and job highlights are also scanned for taxonomy names and aliases, using whole-word matching, so "built dashboards in Power BI" counts even when Power BI isn't in the skills list.
- **Status of each required skill:**
  - **Met:** there is an evidence line from a job or project, used within the last 4 years.
  - **Weak evidence:** the skill is only listed (a skills section, no example).
  - **Outdated:** the last use was more than 4 years ago, judged by the role's end date or `lastUsed`.
  - **Missing:** nothing in the resume shows it.
- **Ranking:** gaps are ranked by the share of postings that ask for the skill, then by status (missing first). Only required skills become gaps.
- **Hours:** a rough estimate per status, about 12 h for missing, 4 h for weak and 6 h for outdated. It is labelled as an estimate.

**Claude only writes the explanations (AI-2).** One call, with prompt `prompts/explain-gaps/v1.md`, receives the gaps the matcher already decided. The model cannot add, remove or re-rank gaps; a schema check rejects any change. If the call fails, the page uses a plain template sentence instead, so the Gaps page never depends on the model. Every call is logged in `ai_calls` with its prompt version.

**Storage.** One `gap_analyses` row per profile and role, with the matcher version, using the existing table, so no migration is needed. Reads are limited to the same session and the 24-hour window, like resumes.

## Quality gate (AI-4)
- A free, deterministic matcher eval in `npm test`. Each of the 13 eval resumes gets its expected skills, and the gaps are scored against the expected gaps with the existing scorer (gap precision, recall and status accuracy). It runs in CI on every PR.
- The paid parse eval from #11 stays as it is. Together they cover the full pipeline.

## PRs, in order
1. The matcher, with tests and the matcher eval. No UI and no AI.
2. The explanation prompt and call, with the template fallback and logging.
3. The role picker and Gaps pages, the rating, and `/design` entries.

## Decisions needed
- Approve this plan (required by CLAUDE.md for AI pipeline work).
- Model for explanations. I recommend **Opus 5.5**, the same model as parsing, so there is one model to evaluate, at about 3 US cents per analysis. Haiku 4.5 costs about 1 cent, and its quality could be measured later.
