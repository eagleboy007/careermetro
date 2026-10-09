# Phase 1, part 3: Path (plan for approval)

Date: 2026-10-08. Covers FR-15 to FR-18 in docs/REQUIREMENTS.md. Resume and Gaps are live.

## What a user will see
1. On the Gaps page, a **Build my path** button with one question: "How many hours a week can you spend?" (3, 5, 8 or 10; 5 is the default).
2. A **Path** page with at most 6 steps, in order. Each step shows:
   - the skill, and one line on why it matters, tied to the gap;
   - 1 to 3 free resources (title, provider, length), from our own catalog;
   - a time estimate, plus which week it falls in, given the weekly hours;
   - one small proof-of-skill task, for example "Build a one-page Power BI report from a public sales dataset and share a screenshot".
3. A **Mark done** button on each step. Finished steps tick off, and the readiness line on the Gaps page moves with them.

## How it works
**The order and the resources are plain code (no AI), like the Gaps matcher.**
- Steps come from the top gaps, at most 6. Prerequisites go first using the taxonomy's `implies` links (for example SQL before Power BI data modelling); otherwise the Gaps ranking is kept.
- Resources are picked only from the catalog: healthy links, free first, preferring the shortest set that covers the skill. The model never sees or writes a URL (FR-17).
- Hours per step come from the resources' lengths, capped by the gap estimate. If the total is more than about 6 weeks at the chosen hours, the path keeps the first steps and says how many gaps are left for later.

**Claude only writes the "why" line and the proof-of-skill task for each step.** One call with a new prompt, `prompts/write-path/v1.md`, given the fixed steps. A schema check rejects any change to the steps or their order. If the call fails, each step uses a template line and a task stored with the skill in the catalog, so the Path page never depends on the model. Every call is logged with its prompt version. Model: Opus 5.5, as for Gaps (about 3 US cents per path).

**The resource catalog** is a reviewed JSON file in the repo (`src/content/resources.json`), seeded into the existing `resources` table, like skills and roles.
- I draft it for the skills our 13 roles require: about 60 skills with 1 to 3 resources each. Sources: official docs, Microsoft Learn, freeCodeCamp, Kaggle Learn, NPTEL/SWAYAM and a few well-known YouTube courses. No affiliate links.
- A daily GitHub workflow checks every link and marks broken ones unhealthy, so they drop out of new paths.
- A review sheet (CSV) goes to your domain experts, like the role profiles.

**Storage** uses the existing `paths` and `path_steps` tables, limited to the same session and the 24-hour window. I expect no migration; if one is needed it is small and runs through the Migrate workflow.

## Quality gate
- Unit tests for the path builder: order, the 6-step limit, the weekly-hours sizing, only healthy catalog links.
- A content test: every required skill of every role has at least one resource, and every resource URL is https and unique.
- Same fallback and logging rules as Gaps.

## PRs, in order
1. The resource catalog, the seed and the daily link check, plus the review CSV.
2. The path builder (code only), with tests.
3. The write-path prompt and call, with the template fallback.
4. The Path page, weekly hours, Mark done, and `/design` entries.

## Decision needed
Approve this plan (required by CLAUDE.md for AI pipeline and data model work).
