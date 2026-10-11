import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { SiteHeader } from "@/components/site/site-header";
import { Button } from "@/components/ui/button";
import { restoreUntil } from "@/lib/account/delete";
import { signedInAccount } from "@/lib/auth/server";
import { keepDeleted, restore } from "./actions";

export const metadata: Metadata = { title: "Restore your account · CareerMetro", robots: { index: false } };

const longDate = (d: Date) => d.toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Kolkata" });

/** Shown after signing in to an account deleted in the last 30 days: bring it back, or keep it deleted. */
async function Restore() {
  await connection();
  const account = await signedInAccount();
  if (!account) redirect("/sign-in?next=/account/restore");
  if (!account.deletionRequestedAt) redirect("/today");
  const until = restoreUntil(account.deletionRequestedAt)!;
  return (
    <>
      <p className="text-muted">
        You deleted your account on {longDate(account.deletionRequestedAt)}. Your profile, resumes, goals and progress are kept, hidden, until{" "}
        <strong className="font-medium text-ink">{longDate(until)}</strong>. After that they are removed for good.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <form action={restore}>
          <Button type="submit">Restore my account</Button>
        </form>
        <form action={keepDeleted}>
          <Button type="submit" variant="ghost">
            Keep it deleted
          </Button>
        </form>
      </div>
    </>
  );
}

export default function RestorePage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 pb-20">
      <SiteHeader />
      <div className="mx-auto flex w-full max-w-md flex-col gap-6">
        <h1 className="text-4xl font-semibold leading-[1.05]">Restore your account?</h1>
        <Suspense>
          <Restore />
        </Suspense>
      </div>
    </main>
  );
}
