"use client";

import { Button, ButtonLink } from "@/components/ui/button";
import { PageNotice } from "@/components/ui/page-notice";

/** Shown when a signed-in page fails. It sits inside the app's layout, so the top bar and tabs stay usable. */
export default function SignedInError({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <PageNotice title="Something went wrong" text="Your goals and progress are safe. Please try again in a minute.">
      <Button type="button" onClick={() => retry()}>
        Try again
      </Button>
      <ButtonLink href="/today" variant="ghost">
        Go to Today
      </ButtonLink>
    </PageNotice>
  );
}
