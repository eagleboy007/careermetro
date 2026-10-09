# Sign-in plan (build order step 3)

Date: 2026-10-09. For Milin's approval: this changes auth and the database (CLAUDE.md rule).

## What users see
- **Ways to sign in:** "Continue with Google" or "Email me a code". The email holds a 6-digit code and also a link, so either works.
- **Age:** one tick on first sign-up: "I am 18 or older and agree to the terms".
- **Earlier analysis:** an analysis run before sign-up is kept. Its resume, gaps and path move to the new account, as FR-2 asks.
- **Where people land:** signed-in visits to `/` go to `/today`. Signed-out visits to `/today` go to `/sign-in`.
- **Signing out:** the avatar menu has "Sign out".

## How it is built
- **Provider:** Supabase Auth, in the Mumbai project we already run, so data stays in India. The free plan covers 50,000 monthly active users.
- **One auth module** (`src/lib/auth/`):
  - It is the only code that imports the Supabase auth library.
  - The rest of the app asks it only for "who is signed in", which returns our own `users.id`.
  - It handles the Google redirect, the email code and sign-out.
  - Moving to another provider later means rewriting this module. Existing users then sign in again once and are matched by email.
- **Session:** Supabase's secure HTTP-only cookies, refreshed in `proxy.ts`, which is what Next 16 calls middleware.
- **Who can see what:**
  - A resume, its gaps and its path belong to a signed-in user when `user_id` matches.
  - Anonymous visitors keep today's rule: their own session, for 24 hours.
  - Signed-in data does not expire.
- **Not used:** Supabase row-level security and its client-side database access. The app keeps talking to Postgres only from the server, as it does today.

## Database changes (one migration)
| Table | Change | Why |
|---|---|---|
| `users` | add `auth_subject` (text, unique): the provider's user id | Links a sign-in to our user |
| `users` | add `age_confirmed_at`, `last_seen_at` | 18+ and the deletion policy |
| `users` | `email` stays unique; add a lower-case index | Matching by email if we move provider |
| `resumes` | none: `user_id` already exists | Claiming sets it |
| `consents` | one row per sign-up: purpose `account`, with the policy version | DPDP record |

There is no foreign key to Supabase's own `auth.users` table, so our tables never depend on the provider.

Goals, pitstops and proof tables (`user_goals`, `gap_proofs`, `ride_days`) are **not** in this change. They come in a later plan of their own (build steps 5 and 6).

## Not in this step
- "Download my data" and "Delete my account" with the 24-hour deletion job. These are the next PR after sign-in.
- Phone OTP: SMS in India needs TRAI DLT registration first.
- Organization sign-up and employer accounts.

## What only Milin can do (steps go in the thread when we get there)
1. In Google Cloud, create an OAuth client (web). The redirect URL comes from Supabase.
2. In Supabase:
   - turn on the Google provider with that client;
   - set Site URL to https://careermetro.vercel.app and add the preview URLs;
   - turn on email OTP.
3. In Vercel, add `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` (the publishable key). They are safe in the browser. The secret service key is not needed.

## Tests
- **Auth module:** unit tests with the provider mocked.
- **Database tests:**
  - claiming an anonymous resume on sign-up;
  - one user can't read another user's resume, gaps or path;
  - an anonymous resume still expires after 24 hours, and a claimed one doesn't.
- **Browser check:** the email code flow against a local Supabase stub before merge. Google sign-in is checked on the Vercel preview once Milin has set it up.
