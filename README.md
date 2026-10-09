# CareerMetro

Upload a resume, pick a target role, see the exact skills you're missing and a short free path to close them.

## Run locally

1. Node 22 or newer.
2. `npm install`
3. `cp .env.example .env.local` and set `DATABASE_URL` (Supabase pooler URL or any local Postgres).
4. `npm run db:migrate`
5. `npm run dev` and open http://localhost:3000. The component gallery is at `/design`.

## Checks

`npm run lint`, `npm run typecheck`, `npm test`, `npm run build`. CI runs all of them on every pull request.

## Docs

- `docs/README.md`: index of every design, brand file, plan and review sheet
- `docs/REQUIREMENTS.md`: product requirements
- `CLAUDE.md`: decisions, design rules and working agreements
