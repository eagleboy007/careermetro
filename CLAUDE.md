@AGENTS.md

# CareerMetro

Web app for job seekers in India: resume plus target role in, specific skill gaps with evidence and a short upskilling path out.

Read `docs/REQUIREMENTS.md` before any design or implementation work. It is the contract; update it when a requirement changes.

For the signed-in app (sign-up, Today, goals, map, jobs, profile), build from `docs/design/post-login-handoff.md`. It collects the prototype's screens, rules, fonts and tokens.

## Decisions already made (2026-10-06)

- B2C first. `organizations` exists in the schema only; team features are Phase 3.
- Free during the beta. No billing code.
- Job data: pasted job descriptions, hand-written role profiles, and public ATS job-board feeds. Never scrape LinkedIn, Naukri or other sites whose terms forbid it.
- Resources: curated free sources (YouTube, NPTEL, SWAYAM, freeCodeCamp, Kaggle Learn, Microsoft Learn, official docs). No affiliate links.
- Gap matching is deterministic code over a skill taxonomy. The model only parses resumes and writes explanations.
- Hosting: Vercel (functions in Mumbai, `bom1`) and Supabase Postgres in `ap-south-1`.

## Design system

Tokens live in `src/app/globals.css` and are exposed to Tailwind as `bg`, `surface`, `surface-2`, `ink`, `muted`, `line`, `accent`, `accent-soft`, `on-accent`, `good`, `warn`, `bad` (plus `-soft`).

- Cobalt (`accent`) means progress only. Red, amber and green are for gap status only.
- Fonts: Bricolage Grotesque for headings, Geist for text, Geist Mono for labels.
- Icons: `lucide-react`, `strokeWidth={1.75}`.
- Step names are plain: Resume, Gaps, Path, Practice, Match.
- `/design` shows every component with example data. Add new components there.
- Every color must work in light and dark mode. Never use a literal color in a component.

## Working agreements

- Plan first for anything touching the data model, auth or the AI pipeline, and get approval.
- Write the Zod schema and tests before the code that fills them.
- Small PRs, one feature each. Run `npm run lint && npm run typecheck && npm test && npm run build` before calling anything done.
- Never commit secrets or real resumes. Use synthetic fixtures in `/fixtures`.
- Prompts live in `/prompts/<name>/v<N>.md`. Log the prompt version on every AI call (`ai_calls` table).
- Resume text never goes into logs or analytics.

## Commands

- `npm run dev` — local app at http://localhost:3000
- `npm run db:generate` — create a migration after changing `src/db/schema.ts`
- `npm run db:migrate` — apply migrations to `DATABASE_URL`
- `npm run eval:parse` — run the parse prompt over `fixtures/evals` with the real API (needs `ANTHROPIC_API_KEY`, about $1)
