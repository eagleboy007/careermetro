"use client";

import { Button } from "@/components/ui/button";
import { PageNotice } from "@/components/ui/page-notice";

/** Shown when a resume, role or gaps page fails to load. The error itself is logged on the server. */
export default function ResumeError({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <PageNotice title="Something went wrong loading this page" text="Your resume is safe. Please try again in a minute.">
      <Button type="button" onClick={() => retry()}>
        Try again
      </Button>
    </PageNotice>
  );
}
