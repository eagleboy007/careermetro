"use client";

import { Button, ButtonLink } from "@/components/ui/button";
import { OFFLINE_NOTICE, PageNotice } from "@/components/ui/page-notice";
import { useOnline } from "@/components/ui/use-online";

/**
 * Shown when any page, or the signed-in app's layout, fails. Pages with their own boundary (a resume's pages) show
 * that one instead. The error is logged on the server, with no resume text in it. Offline, it says so: a server
 * action or page load that failed for want of a connection lands here too.
 */
export default function AppError({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  const online = useOnline();
  return (
    <PageNotice
      title={online ? "Something went wrong" : OFFLINE_NOTICE.title}
      text={online ? "Your data is safe. Please try again, or come back in a minute." : `${OFFLINE_NOTICE.text} Your data is safe.`}
    >
      <Button type="button" onClick={() => retry()}>
        Try again
      </Button>
      <ButtonLink href="/" variant="ghost">
        Go to the home page
      </ButtonLink>
    </PageNotice>
  );
}
