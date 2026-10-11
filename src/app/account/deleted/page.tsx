import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader } from "@/components/site/site-header";

export const metadata: Metadata = { title: "Account deleted · CareerMetro", robots: { index: false } };

/** Where a person lands after deleting their account, or choosing to keep it deleted. They are signed out. */
export default function DeletedPage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 pb-20">
      <SiteHeader />
      <div className="mx-auto flex w-full max-w-md flex-col gap-4">
        <h1 className="text-4xl font-semibold leading-[1.05]">Your account is deleted</h1>
        <p className="text-muted">
          You are signed out, and no one can see your profile. We keep your data, hidden, for 30 days in case you change your mind: sign in again
          before then to restore it. After 30 days it is removed for good.
        </p>
        <p className="text-sm text-muted">
          <Link href="/" className="underline underline-offset-2 hover:text-ink">
            Back to the home page
          </Link>
        </p>
      </div>
    </main>
  );
}
