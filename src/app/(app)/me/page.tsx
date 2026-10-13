import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { PageLoading } from "@/components/app/page-loading";
import { MeView } from "@/components/me/me-view";
import { readAccountSettings } from "@/lib/account/settings-store";
import { currentAccount } from "@/lib/auth/server";
import { exampleMe } from "@/lib/me/fixtures";
import { publicProfile, whoSeesFor } from "@/lib/me/public";
import { meFor } from "@/lib/me/store";
import { DEFAULT_SETTINGS } from "@/lib/schemas";

export const metadata: Metadata = { title: "Your profile · CareerMetro", robots: { index: false } };

async function MeScreen() {
  await connection();
  const account = await currentAccount();
  if (!account) {
    return (
      <div className="flex flex-col gap-4">
        <p className="rounded-md bg-surface-2 px-3.5 py-2 text-[0.8rem] text-muted">
          Preview with example data. Your own profile appears here once you sign in and add your resume.
        </p>
        <MeView me={exampleMe} others={publicProfile(exampleMe, DEFAULT_SETTINGS)} />
      </div>
    );
  }
  const now = new Date();
  const [me, saved] = await Promise.all([meFor(account.id, now), readAccountSettings(account.id, now)]);
  const settings = saved?.settings ?? DEFAULT_SETTINGS;
  const hidden = settings.visibility === "only_me" || !saved?.username;
  return (
    <div className="flex flex-col gap-4">
      <p className="rounded-md bg-surface-2 px-3.5 py-2 text-[0.8rem] text-muted">
        {hidden
          ? "Only you can see this page. Pick a username and who can see your profile in Account settings."
          : "Your stories, interests and status come next."}
      </p>
      {me && <MeView me={me} others={publicProfile(me, settings)} whoSees={whoSeesFor(settings, saved?.username ?? null)} />}
    </div>
  );
}

export default function MePage() {
  return (
    <Suspense fallback={<PageLoading />}>
      <MeScreen />
    </Suspense>
  );
}
