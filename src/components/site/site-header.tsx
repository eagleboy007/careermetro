import Link from "next/link";
import { Logo } from "@/components/ui/logo";

/** Top bar shared by public pages. */
export function SiteHeader() {
  return (
    <header className="flex items-center justify-between gap-4 border-b border-line py-5">
      <Link href="/" aria-label="CareerMetro home">
        <Logo />
      </Link>
      <nav className="flex items-center gap-5 text-sm font-medium">
        <Link href="/roles" className="text-muted hover:text-ink">
          Roles
        </Link>
        <Link href="/#waitlist" className="whitespace-nowrap text-muted hover:text-ink">
          Join the waitlist
        </Link>
      </nav>
    </header>
  );
}
