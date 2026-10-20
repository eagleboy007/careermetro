"use client";

import { Button, ButtonLink } from "@/components/ui/button";
import { OFFLINE_NOTICE, PageNotice } from "@/components/ui/page-notice";
import { useOnline } from "@/components/ui/use-online";

/**
 * Shown when a signed-in page fails, or an action on it throws (such as a server action with no connection). It sits
 * inside the app's layout, so the top bar and tabs stay usable. Offline, it says so.
 */
export default function SignedInError({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  const online = useOnline();
  return (
    <PageNotice
      title={online ? "Something went wrong" : OFFLINE_NOTICE.title}
      text={online ? "Your goals and progress are safe. Please try again in a minute." : `${OFFLINE_NOTICE.text} Your goals and progress are safe.`}
    >
      <Button type="button" onClick={() => retry()}>
        Try again
      </Button>
      <ButtonLink href="/today" variant="ghost">
        Go to Today
      </ButtonLink>
    </PageNotice>
  );
}
