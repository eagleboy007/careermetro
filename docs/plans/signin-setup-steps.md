# Sign-in setup: three steps only Milin can do

Takes about 15 minutes. Never paste keys or secrets in the chat; they only go into Google, Supabase and Vercel.

## 1. Supabase: copy the Google callback URL
1. Open the CareerMetro project in Supabase (Mumbai).
2. Go to **Authentication > Sign In / Providers > Google**.
3. Copy the **Callback URL** it shows (it looks like `https://<project>.supabase.co/auth/v1/callback`). Leave this tab open.

## 2. Google Cloud: create the OAuth client
1. Go to https://console.cloud.google.com and pick (or create) a project called CareerMetro.
2. **APIs & Services > OAuth consent screen**:
   - User type: **External**.
   - App name: CareerMetro. Support email: yours.
   - Authorised domains: `supabase.co` and `vercel.app` (add your own domain later).
   - Scopes: only `email`, `profile`, `openid`.
   - Publish the app (Testing mode only lets listed test users sign in).
3. **APIs & Services > Credentials > Create credentials > OAuth client ID**:
   - Type: **Web application**.
   - Authorised redirect URI: paste the Supabase callback URL from step 1.
4. Copy the **Client ID** and **Client secret**.

## 3. Supabase: finish settings
1. Back in **Google** provider: turn it on, paste the Client ID and Client secret, save.
2. **Authentication > Sign In / Providers > Email**: keep Email on, turn **Confirm email** on.
3. **Authentication > Emails > Magic Link** template: make sure the body contains `{{ .Token }}` so the email shows the 6-digit code (the link can stay too).
4. **Authentication > URL Configuration**:
   - Site URL: `https://careermetro.vercel.app`
   - Redirect URLs: add `https://careermetro.vercel.app/**` and `https://careermetro-*-career-metro.vercel.app/**` (PR previews).
5. **Project Settings > API**: copy the **Project URL** and the **anon / publishable** key (NOT the service_role / secret key).

## 4. Vercel: add two variables
In the careermetro project, **Settings > Environment Variables**, for Production, Preview and Development:
- `NEXT_PUBLIC_SUPABASE_URL` = the Project URL
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` = the anon / publishable key

Both are safe in the browser by design. Then tell Claude "sign-in keys added" in the Development thread; Claude checks them on the preview before calling sign-in live.

Note: Supabase's built-in email sender is limited to a few emails an hour. That is fine for the beta preview; before launch we add a proper sender (e.g. Resend or Amazon SES), which is a separate small step.
