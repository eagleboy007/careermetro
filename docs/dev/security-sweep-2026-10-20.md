# Dependency and security sweep, 2026-10-20

Main at `9c9e344` (#207). The npm registry, its mirrors and every GitHub repo except this one were blocked from the sweep's
sandbox. Facts below come from this repo's GitHub API (CI runs, dependabot PR #161), `curl` against production, and the
code. Nothing was built or installed here.

## Summary

| # | Finding | Severity | Changed here? |
|---|---|---|---|
| 1 | Production ran `next@16.4.0`, which has 2 critical RCE advisories and 1 high DoS advisory, all fixed in 16.4.1. Dependabot PR #161 (to 16.4.2) had been open since 2026-10-18 | **Critical** | No. #161 is now merged and production serves 16.4.2 |
| 2 | CI's `npm audit --omit=dev --audit-level=high` still passes on 16.4.0 | Medium (blind spot) | **Yes**: this PR adds a CI step, `scripts/check-advisories.mjs`, that checks GitHub's advisory database |
| 3 | HSTS had no `includeSubDomains` | Low | **Yes** |
| 4 | No `Cross-Origin-Opener-Policy` header | Low | **Yes** (`same-origin-allow-popups`) |
| 5 | `access-control-allow-origin: *` on `/` comes from Vercel's prerender/static serving, not our config | Info | No |
| 6 | The CSP has no `script-src` | Medium | No. Recommendation below |
| 7 | Majors behind: none confirmed, and latest versions couldn't be checked | Info | No |
| 8 | Next 16 deprecations: none found in code. `unstable_rethrow` is called 16 times in 10 files | Info | No |

## 1. npm audit and the Next 16.4.1 security release

- **CI:** the latest completed CI run on main is [39496211057](https://github.com/eagleboy007/careermetro/actions/runs/39496211057) (`5929aa4`), job `check`, conclusion success. Step 11, `npm audit --omit=dev --audit-level=high`, passed in under a second (20:58:39Z). The run for `9c9e344` was still building when checked. The job logs need auth (the 302 to the Azure blob was blocked), so we have the step result but not the advisory count.
- **PR #161** (dependabot, `minor-and-patch`, opened 2026-10-18; check, e2e and eval all pass on `91daf7d`) bumps `next` 16.4.0 → 16.4.2. Its quoted release notes say v16.4.1 "contains security fixes":
  - Critical [GHSA-673q-mjm6-r5xr](https://github.com/vercel/next.js/security/advisories/GHSA-673q-mjm6-r5xr): unauthenticated RCE in `use cache` functions that return typed arrays.
  - Critical [GHSA-2464-fhr4-w9xw](https://github.com/vercel/next.js/security/advisories/GHSA-2464-fhr4-w9xw): unauthenticated RCE in the Image Optimization API when SVG files are used.
  - High [GHSA-p3m5-59mp-jv5r](https://github.com/vercel/next.js/security/advisories/GHSA-p3m5-59mp-jv5r): DoS in the App Router through Server Actions.
- **Our exposure:**
  - The code has no `"use cache"` and no `next/image`. Prod `/_next/image?url=/icon.svg` answers 400 (SVG not allowed by default).
  - The app has 25 `actions.ts` files with Server Actions, so the high DoS advisory applies.
  - Don't count on the criticals being out of reach. Upgrade.
- **Why audit didn't catch it:** most likely the GHSAs are repository advisories that hadn't yet reached the reviewed GitHub Advisory Database, which `npm audit` reads. The logs would confirm this, but they need auth. A green audit step is not proof of "no known vulns".
- **Recommendation:**
  - Merge #161 now. It also brings react/react-dom 19.3.1 ("Improve transport protocol" for RSC).
  - **Done:** #161 is merged, and production serves Next 16.4.2: a client chunk carried "16.4.2" when checked at about 22:01 UTC on 2026-10-20.
  - This PR adds a CI step after `npm audit`, `node scripts/check-advisories.mjs`, which checks every installed runtime package against GitHub's advisory database, unreviewed advisories included, and fails on a high or critical one.
  - Watch the release notes of `next`, `react` and `react-dom` (GitHub "Watch → Releases → Security"), or turn on Dependabot security alerts. Security updates aren't held to the Monday schedule.

### Direct dependencies (package.json → package-lock.json)

| Package | Range | Locked | #161 bumps to |
|---|---|---|---|
| @anthropic-ai/sdk | ^0.132.1 | 0.132.1 | 0.135.0 |
| @pdf-lib/fontkit | ^1.1.1 | 1.1.1 | |
| @supabase/ssr | ^0.12.7 | 0.12.7 | |
| @supabase/supabase-js | ^2.117.3 | 2.117.3 | 2.118.0 |
| docx | ^9.10.0 | 9.10.0 | 9.12.0 |
| drizzle-orm | ^0.45.4 | 0.45.4 | |
| lucide-react | ^1.53.0 | 1.53.0 | 1.59.0 |
| mammoth | ^1.13.0 | 1.13.0 | |
| next | 16.4.0 | 16.4.0 | **16.4.2 (security)** |
| pdf-lib | ^1.17.1 | 1.17.1 | |
| postgres | ^3.4.9 | 3.4.9 | |
| react / react-dom | 19.3.0 | 19.3.0 | 19.3.1 |
| server-only | ^0.0.1 | 0.0.1 | |
| unpdf | ^1.8.1 | 1.8.1 | 1.9.0 |
| zod | ^4.6.5 | 4.6.5 | 4.6.7 |
| dev: @tailwindcss/turbopack, tailwindcss | ^4 | 4.3.3 | |
| dev: @types/node | ^22.20.5 | 22.20.5 | |
| dev: @types/react, @types/react-dom | ^19 | 19.3.0 | |
| dev: axe-core | 4.14.0 | 4.14.0 | |
| dev: drizzle-kit | ^0.31.11 | 0.31.11 | |
| dev: eslint | ^9 | 9.39.5 | |
| dev: eslint-config-next | 16.4.0 | 16.4.0 | 16.4.2 |
| dev: typescript | ^5 | 5.9.3 | |
| dev: vitest | ^5.0.3 | 5.0.3 | 5.0.5 |

## 2. Majors behind

- `api.github.com/repos/<other>/releases/latest` was refused by the sandbox proxy for every package repo, and npm, unpkg and jsdelivr didn't connect, so this sweep couldn't confirm the latest majors.
- `.github/dependabot.yml` ignores semver-major updates on purpose, so the open PR list (only #161) says nothing about majors.

| Package | Locked major | Evidence | Flag |
|---|---|---|---|
| next | 16 | #161's backports are labelled `[lts-active]`, which suggests a newer line exists on canary/main | Check whether Next 17 is out |
| react | 19 | none | none |
| drizzle-orm | 0.45 | none; 1.0 was in beta at last knowledge | Check |
| zod | 4 | none | none |
| @supabase/supabase-js | 2 | none | none |
| @anthropic-ai/sdk | 0.x | no majors in 0.x | none |
| tailwindcss | 4 | none | none |
| vitest | 5 | none | none |
| typescript | 5.9 | not verified; TypeScript 6.0 may be out | Check |
| eslint | 9 | not verified; ESLint 10 may be out | Check (also needs eslint-config-next support) |
| postgres | 3 | none | none |
| @types/node | 22 | matches `engines` and CI `node-version: 22` | none |

**Recommendation:** from a machine with registry access, run `npm outdated` and confirm the Check rows. Plan any major as its own PR. Nothing was bumped.

## 3. Security headers

All headers are set in `next.config.ts` `headers()` for `/:path*`. `vercel.json` sets none, and `src/proxy.ts` sets none.

What production answered on 2026-10-20 (`curl -sSI`, one GET each):

| Header | `/` (200, PRERENDER) | `/today` (404) | `/sign-in` (404) | `/api/health` (200) |
|---|---|---|---|---|
| content-security-policy | `frame-ancestors 'none'; base-uri 'self'; object-src 'none'` | same | same | same |
| strict-transport-security | `max-age=63072000` | same | same | same |
| x-frame-options | DENY | DENY | DENY | DENY |
| x-content-type-options | nosniff | nosniff | nosniff | nosniff |
| referrer-policy | strict-origin-when-cross-origin | same | same | same |
| permissions-policy | `camera=(), microphone=(self), geolocation=(), payment=()` | same | same | same |
| cross-origin-opener-policy | absent | absent | absent | absent |
| access-control-allow-origin | `*` | absent | absent | absent |

`/today` and `/sign-in` answer 404 on purpose (proxy, while signed-in preview is off).

### Changed

- **HSTS `includeSubDomains` (changed).**
  - The app is served only on `careermetro.vercel.app` and Vercel preview/staging hosts. Subdomains of those are Vercel-only and HTTPS-only.
  - `careermetro.com` is the public site, hosted elsewhere. It never gets this header, and HSTS never covers a parent domain.
  - The earlier comment ("a subdomain served over plain HTTP is never locked out") was a precaution with no live case behind it.
  - Not adding `preload`: a vercel.app subdomain can't be preloaded. Revisit both settings if the app ever moves to the apex `careermetro.com`, where tracking or mail subdomains might be plain HTTP.
- **COOP `same-origin-allow-popups` (changed).**
  - Google sign-in is a full-page server redirect (`src/app/sign-in/actions.ts:20-24`, `src/lib/auth/server.ts:83`), not a popup.
  - No `window.open` or `postMessage` in `src/`.
  - Outbound links use `rel="noopener noreferrer"`.
  - Not plain `same-origin`: the Vercel Toolbar on preview deployments signs in through a popup that needs `window.opener`, which `same-origin` would cut. `same-origin-allow-popups` still keeps a cross-origin page that opens ours from reaching it.

### Not changed

- **ACAO `*` (not changed, not ours).**
  - It appears only on `/`, alongside `x-vercel-cache: PRERENDER`, `accept-ranges` and `content-disposition: inline`. Those are the marks of Vercel serving a prerendered file from its static layer.
  - Dynamic responses (`/api/health`, the proxy's 404s) don't carry it.
  - Our only ACAO is the allow-listed one in `src/app/api/waitlist/route.ts:15-24` (careermetro.com and www).
  - Risk is low: the page is public and identical for everyone, and `*` never allows credentialed reads.
  - If we want it gone: setting it from `headers()` can't remove a header, so the options are a Vercel support request or making `/` dynamic. Neither is worth doing.
- **Other headers.** Referrer-Policy, Permissions-Policy, X-Content-Type-Options, frame-ancestors and X-Frame-Options are fine as they are.

### script-src CSP: recommendation only, not implemented

- **How nonces work in Next.** The proxy generates a nonce per request and sends it in the CSP header. Next adds it to its own `<script>` tags at render time.
- **Why that conflicts with how we render.** With `cacheComponents: true`, pages are a static shell prerendered at build and streamed from Vercel's cache (`/` is `x-nextjs-prerender: 1`). A prerendered shell can't hold a nonce that doesn't exist yet. So nonces force every page to render dynamically, which loses:
  - the static shell;
  - PPR's instant first byte;
  - edge caching of `/` and other public pages.
- **Option A: nonce CSP.** Strongest XSS protection, but it costs that rendering performance on every page and needs proxy changes. Not recommended now.
- **Option B: hash CSP (`'sha256-…'`).** Works with static pages, but Next's inline bootstrap and RSC payload scripts change per build and per page. Next's SRI support (`experimental.sri`) has historically been webpack-only. Check `node_modules/next/dist/docs` for Turbopack support before choosing it.
- **Option C (recommended next step): a host allow-list CSP, Report-Only first.**
  - Keeps static rendering and stops scripts loading from other hosts or `data:`.
  - Does not stop inline injection.
  - The code has no `next/script`, no `dangerouslySetInnerHTML`, no browser Supabase client and no third-party scripts, so the list can be tight. Start with:

  ```
  Content-Security-Policy-Report-Only: default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline';
    img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; frame-src 'none'; worker-src 'self' blob:;
    frame-ancestors 'none'; base-uri 'self'; object-src 'none'
  ```

  - Leave `form-action` out: the comment in `next.config.ts` explains it would block the Google redirect.
  - Run it on staging for a week with the e2e walk, then make it enforcing.
  - Do the nonce CSP only if the app ever renders user-supplied HTML.

## 4. Next 16 deprecations (code search; the build log needs auth)

- **`middleware.ts` → `proxy.ts`:** done. `src/proxy.ts` exports `proxy` and `config.matcher`, with no edge runtime. No `middleware.*` file.
- **`next/legacy/image`, `images.domains`:** not used. There's no `images` config and no `next/image` import.
- **Sync request APIs:** none.
  - Every `cookies()` and `headers()` call is awaited (`src/lib/auth/server.ts`, `src/lib/session.ts`, `src/app/sign-in/actions.ts`, `src/app/auth/sign-out/route.ts`, `src/app/account/restore/actions.ts`, `src/app/(app)/settings/actions.ts`).
  - Pages take `PageProps<…>` and `await searchParams`, for example `src/app/sign-in/page.tsx:17-18` and `src/app/(app)/today/page.tsx:62-63`.
- **`unstable_` APIs:** only `unstable_rethrow` from `next/navigation`, 16 calls in 10 files, for example:
  - `src/app/(app)/mock/page.tsx:2,51`
  - `src/app/(app)/departures/page.tsx:3,51-130`
  - `src/app/(app)/library/page.tsx:2,46`
  - `src/app/(app)/arrivals/page.tsx:2,118`
  - `src/app/(app)/elite/page.tsx:2,45`
  - `src/app/(app)/match/page.tsx:2,37`
  - `src/app/(app)/inbox/page.tsx:3,94`

  It isn't deprecated as far as the code shows. If 16.x renames it to `rethrow`, the build warning will say so. No change.
- **`experimental.*`:** none. `cacheComponents`, `partialPrefetching` and `turbopack.rules` sit at the top level of `next.config.ts`. The CI build passes, so 16.4 accepts them. A deprecation warning, if any, would show in the CI build log; check it once the logs can be read.
- **Other removed APIs:** none found. The code has no `revalidateTag`, `unstable_cache`, `unstable_noStore`, `next/amp`, `useFormState` or runtime configs. `lint` runs `eslint` directly, not the removed `next lint`.

**Recommendation:** have someone with repo access grep the `check` job's "Run npm run build" log for `⚠` or `deprecated`.

## Not touched

- Dependency versions and `package-lock.json`.
- `vercel.json`, `src/proxy.ts`.
