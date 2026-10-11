# Staging: where to see the newest build

**Address:** https://careermetro-git-staging-career-metro.vercel.app (Vercel's fixed address for the `staging` branch; it needs no setup)

Staging always runs the newest code on main as a *preview*. That means the signed-in screens show there: Today, Map, Departures, Inbox, Profile and Account settings. Sign in with "Continue as test user". Production (careermetro.vercel.app) shows only the public pages until real sign-in goes live; see `src/lib/preview.ts`.

## How it works
- `.github/workflows/staging.yml` moves the `staging` branch to main after every merge.
- Vercel builds the `staging` branch as a preview, and the staging domain is assigned to that branch.
- Changes that touch only docs don't build (`scripts/vercel-ignore.sh`, run by `ignoreCommand` in `vercel.json`). The staging branch always builds the first time, since there is nothing to compare with.

## Optional: a shorter address (owner only, in Vercel)
1. vercel.com → the **careermetro** project → **Settings** → **Domains** → **Add Domain**.
2. Type `careermetro-staging.vercel.app` and press **Add**.
3. In the domain's settings, choose **Connect to an environment: Preview**, then set **Git Branch** to `staging`. Press **Save**.

## Opening it
Previews are covered by Vercel Authentication. Either:
- open the address in a browser where you are signed in to vercel.com with the account that owns the project; or
- use a bypass link that works without a Vercel login:
  1. Go to **Settings** → **Deployment Protection** → **Protection Bypass for Automation** and press **Add Secret**. Copy the value.
  2. Bookmark `https://careermetro-git-staging-career-metro.vercel.app/sign-in?x-vercel-protection-bypass=SECRET&x-vercel-set-bypass-cookie=true`, with SECRET replaced by the value you copied.
  3. Keep that link private, like a password. Never paste it in chat.

The same secret lets automated checks open previews. Save it in GitHub as the `VERCEL_AUTOMATION_BYPASS_SECRET` repository secret, under Settings → Secrets and variables → Actions.
