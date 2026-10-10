import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { MeView } from "@/components/me/me-view";
import { currentAccount } from "@/lib/auth/server";
import { exampleMe } from "@/lib/me/fixtures";
import { meFor } from "@/lib/me/store";

export const metadata: Metadata = { title: "Your profile · CareerMetro", robots: { index: false } };

async function MeScreen() {
  await connection();
  const account = await currentAccount();
  const me = account ? await meFor(account.id, new Date()) : exampleMe;
  return (
    <div className="flex flex-col gap-4">
      <p className="rounded-md bg-surface-2 px-3.5 py-2 text-[0.8rem] text-muted">
        {account
          ? "Only you can see this page for now. Your stories, interests, status and who-sees-what switches come next."
          : "Preview with example data. Your own profile appears here once you sign in and add your resume."}
      </p>
      {me && <MeView me={me} />}
    </div>
  );
}

export default function MePage() {
  return (
    <Suspense>
      <MeScreen />
    </Suspense>
  );
}
