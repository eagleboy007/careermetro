import type { Metadata } from "next";
import { Button, ButtonLink } from "@/components/ui/button";
import { PageNotice } from "@/components/ui/page-notice";

export const metadata: Metadata = { title: "Weekly My jobs email · CareerMetro", robots: { index: false } };

const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : "");

/**
 * The weekly My jobs email's "Turn it off" (C22), with no sign-in. Opening it changes nothing, because mail scanners
 * open links; the button posts to /api/email/off. The same page shows for any token, so it never says whether one existed.
 */
export default async function EmailOffPage({ searchParams }: PageProps<"/email/off">) {
  const params = await searchParams;
  if (one(params.done)) {
    return (
      <PageNotice title="The weekly My jobs email is off" text="We won't send it again. You can turn it back on in Settings > Notifications whenever you like.">
        <ButtonLink href="/settings#acc-notif" variant="ghost">
          Open Settings
        </ButtonLink>
      </PageNotice>
    );
  }
  const t = one(params.t).slice(0, 64);
  return (
    <PageNotice
      title="Turn off the weekly My jobs email?"
      text={
        one(params.failed)
          ? "That didn't work. Please try again."
          : "It comes on Monday mornings when something on My jobs is moving. Your jobs and settings stay as they are."
      }
    >
      <form method="post" action={`/api/email/off?t=${encodeURIComponent(t)}`}>
        <Button type="submit" variant="ghost">
          Turn it off
        </Button>
      </form>
    </PageNotice>
  );
}
