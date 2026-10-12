import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { Logo } from "@/components/ui/logo";
import { authConfig } from "@/lib/auth/config";
import { currentIdentity } from "@/lib/auth/server";
import { testSignInEnabled } from "@/lib/auth/test-user";

/** Top bar shared by public pages. "Sign in" shows only where sign-in is on (Supabase keys, or test sign-in on previews). */
export function SiteHeader() {
  return (
    <header className="flex items-center justify-between gap-4 border-b border-line py-5">
      <Link href="/" aria-label="CareerMetro home">
        <Logo />
      </Link>
      <nav className="flex items-center gap-4 text-sm font-medium sm:gap-5">
        <Link href="/roles" className="text-muted hover:text-ink">
          Roles
        </Link>
        {/* Shorter on a phone so three links fit beside the logo. */}
        <Link href="/#waitlist" className="whitespace-nowrap text-muted hover:text-ink">
          <span className="sm:hidden">Waitlist</span>
          <span className="hidden sm:inline">Join the waitlist</span>
        </Link>
        <Suspense fallback={null}>
          <SignInLink />
        </Suspense>
      </nav>
    </header>
  );
}

/** Rendered per request: the static shell is built before the deployment's keys are known. Signed in, it leads to Today. */
async function SignInLink() {
  await connection();
  if (!authConfig() && !testSignInEnabled()) return null;
  const signedIn = Boolean(await currentIdentity());
  return (
    <Link
      href={signedIn ? "/today" : "/sign-in?next=%2Ftoday"}
      className="whitespace-nowrap text-ink hover:underline hover:underline-offset-2"
    >
      {signedIn ? "Today" : "Sign in"}
    </Link>
  );
}
