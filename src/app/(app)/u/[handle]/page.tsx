import { Settings } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { PageLoading } from "@/components/app/page-loading";
import { MeView } from "@/components/me/me-view";
import { canViewProfile, findProfile } from "@/lib/account/settings-store";
import { currentAccount } from "@/lib/auth/server";
import { publicProfile } from "@/lib/me/public";
import { meFor } from "@/lib/me/store";

// A generic title: the person's name stays out of tab titles, history sync and any analytics that read titles.
export const metadata: Metadata = { title: "Profile · CareerMetro", robots: { index: false, follow: false } };

/**
 * Someone's profile at their username (handoff section 3, `/u/[handle]`; account settings part 2). Signed in only. A
 * missing username, a hidden profile and one whose owner blocked the viewer all give the same not-found page, so the
 * page never says which. A username given up in the last 14 days redirects to the new one. What shows is worked out
 * on the server (src/lib/me/public.ts): resume lines, pay, phone, email and notice period never reach this page.
 */
async function Profile({ params }: { params: PageProps<"/u/[handle]">["params"] }) {
  await connection();
  const { handle } = await params;
  const viewer = await currentAccount();
  if (!viewer) notFound();
  const now = new Date();
  const found = await findProfile(handle, now);
  if (!found) notFound();
  if ("redirectTo" in found) redirect(`/u/${found.redirectTo}`);
  const { owner } = found;
  // The canonical spelling, so one profile has one link.
  if (handle !== owner.username) redirect(`/u/${owner.username}`);
  if (!(await canViewProfile(owner, viewer.id))) notFound();
  const me = await meFor(owner.id, now);
  if (!me) notFound();
  const yours = owner.id === viewer.id;
  return (
    <div className="flex flex-col gap-4">
      {yours && (
        <p className="flex flex-wrap items-center gap-2.5 rounded-md bg-surface-2 px-3.5 py-2 text-[0.8rem] text-muted">
          <span className="flex-1">
            This is your profile as others see it.{" "}
            {owner.settings.visibility === "only_me" ? "Right now it is hidden from everyone but you." : ""}
          </span>
          <Link href="/settings#acc-privacy" className="inline-flex min-h-11 items-center gap-1.5 font-[550] text-ink">
            <Settings size={16} strokeWidth={1.75} aria-hidden="true" />
            Privacy settings
          </Link>
        </p>
      )}
      <MeView me={publicProfile(me, owner.settings)} mode="public" />
    </div>
  );
}

// Cache Components needs one param to check the route at build time; every real username is read at request time.
export function generateStaticParams() {
  return [{ handle: "example" }];
}

export default function PublicProfilePage({ params }: PageProps<"/u/[handle]">) {
  return (
    <Suspense fallback={<PageLoading />}>
      <Profile params={params} />
    </Suspense>
  );
}
