"use client";

import { Button, ButtonLink } from "@/components/ui/button";
import { PageNotice } from "@/components/ui/page-notice";

/**
 * Shown when any page, or the signed-in app's layout, fails. Pages with their own boundary (a resume's pages) show
 * that one instead. The error is logged on the server, with no resume text in it.
 */
export default function AppError({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <PageNotice title="Something went wrong" text="Your data is safe. Please try again, or come back in a minute.">
      <Button type="button" onClick={() => retry()}>
        Try again
      </Button>
      <ButtonLink href="/" variant="ghost">
        Go to the home page
      </ButtonLink>
    </PageNotice>
  );
}
