import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { PageLoading } from "@/components/app/page-loading";
import { Button, ButtonLink } from "@/components/ui/button";
import { PageNotice } from "@/components/ui/page-notice";

export const metadata: Metadata = { title: "Email settings · CareerMetro", robots: { index: false } };

const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : "");

/** What the page says for each email: the weekly My jobs email (C22), or the Monday events digest (`k=events`, Timetable PR 5). */
const WORDS = {
  weekly: {
    name: "weekly My jobs email",
    about: "It comes on Monday mornings when something on My jobs is moving. Your jobs and settings stay as they are.",
    back: "You can turn it back on in Settings > Notifications whenever you like.",
  },
  events: {
    name: "Monday events email",
    about: "It comes on Monday mornings when an event matches your goals or interests. Your Timetable and saved events stay as they are.",
    back: "You can turn it back on from Timetable or Settings > Notifications whenever you like.",
  },
} as const;

/**
 * "Turn it off" for the app's own emails, with no sign-in. Opening it changes nothing, because mail scanners open
 * links; the button posts to /api/email/off. The same page shows for any token, so it never says whether one existed.
 */
export default function EmailOffPage(props: PageProps<"/email/off">) {
  return (
    <Suspense fallback={<PageLoading />}>
      <EmailOff {...props} />
    </Suspense>
  );
}

async function EmailOff({ searchParams }: PageProps<"/email/off">) {
  await connection();
  const params = await searchParams;
  const kind = one(params.k) === "events" ? "events" : "weekly";
  const words = WORDS[kind];
  const k = kind === "events" ? "&k=events" : "";
  if (one(params.done)) {
    return (
      <PageNotice title={`The ${words.name} is off`} text={`We won't send it again. ${words.back}`}>
        <ButtonLink href="/settings#acc-notif" variant="ghost">
          Open Settings
        </ButtonLink>
      </PageNotice>
    );
  }
  const t = one(params.t).slice(0, 64);
  return (
    <PageNotice title={`Turn off the ${words.name}?`} text={one(params.failed) ? "That didn't work. Please try again." : words.about}>
      <form method="post" action={`/api/email/off?t=${encodeURIComponent(t)}${k}`}>
        <Button type="submit" variant="ghost">
          Turn it off
        </Button>
      </form>
    </PageNotice>
  );
}
