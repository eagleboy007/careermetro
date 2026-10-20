import { Settings } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { PageLoading } from "@/components/app/page-loading";
import { MeView } from "@/components/me/me-view";
import { ProfileConnect } from "@/components/network/profile-connect";
import { resolveProfile } from "@/lib/account/settings-store";
import { currentAccount } from "@/lib/auth/server";
import { eliteBadgeFor } from "@/lib/elite/store";
import { publicProfile } from "@/lib/me/public";
import { meFor } from "@/lib/me/store";
import { seesGaps } from "@/lib/network/rules";
import { connectionWith, inCommonWith, mutualConnections, networkSettingsFor, pathTogetherWith } from "@/lib/network/store";
import { answerConnection, blockFromNetwork, connectTo, messageConnection, removeFromNetwork, reportFromNetwork, withdrawConnection } from "../../network/actions";

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
  // Who may see it is decided before any redirect (to the new username, or the canonical spelling), so a redirect
  // never shows that a hidden profile exists.
  const answer = await resolveProfile(handle, viewer.id, now);
  if (answer.kind === "not_found") notFound();
  if (answer.kind === "redirect") redirect(`/u/${answer.to}`);
  const { owner } = answer;
  const yours = owner.id === viewer.id;
  const [me, state, network, inCommon, eliteBadge, mutual] = await Promise.all([
    meFor(owner.id, now),
    connectionWith(viewer.id, owner.id, { now }),
    networkSettingsFor(owner.id),
    inCommonWith(viewer.id, owner),
    // The Elite badge (FR-50) shows only while Elite is on and its owner turned it on. It ranks nothing.
    eliteBadgeFor(owner.id),
    // Only people both are connected to, never anyone either can't see (FR-49).
    yours ? Promise.resolve([]) : mutualConnections(viewer.id, owner.id),
  ]);
  if (!me) notFound();
  // Gaps follow the owner's gaps choice (FR-49): a connection sees gaps shared with connections. The owner's own view
  // here is "as others see it", so it never counts as a connection.
  const connected = !yours && state === "connected";
  const showGaps = seesGaps(network.gapsVisibleTo, { self: false, connected });
  // "Gaps and path" only when the viewer may see the owner's gaps and both aim at the role the owner shows, so it never
  // reveals a gap or a target role the owner hides.
  const path = !yours && showGaps && inCommon.role ? await pathTogetherWith(viewer.id, owner.id, network.gapsVisibleTo === "profile" ? "profile" : "connections") : null;
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
      {!yours && (
        <ProfileConnect
          personId={owner.id}
          name={me.name}
          initial={state}
          inCommon={{ skills: owner.settings.showSkills ? inCommon.skills : null, role: inCommon.role, path, mutual }}
          actions={{
            connect: connectTo,
            answer: answerConnection,
            withdraw: withdrawConnection,
            remove: removeFromNetwork,
            block: blockFromNetwork,
            message: messageConnection,
            report: reportFromNetwork,
          }}
        />
      )}
      <MeView
        me={publicProfile(me, { ...owner.settings, showGaps })}
        mode="public"
        eliteBadge={eliteBadge}
        gapsNote={connected && network.gapsVisibleTo === "connections" ? "Gaps shown because you are connected. They share them with connections only." : undefined}
      />
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
