"use client";

import { Button } from "@/components/ui/button";
import { OFFLINE_NOTICE, PageNotice } from "@/components/ui/page-notice";
import { useOnline } from "@/components/ui/use-online";

/** Shown when a resume, role or gaps page fails to load. The error itself is logged on the server. Offline, it says so. */
export default function ResumeError({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  const online = useOnline();
  return (
    <PageNotice
      title={online ? "Something went wrong loading this page" : OFFLINE_NOTICE.title}
      text={online ? "Your resume is safe. Please try again in a minute." : `${OFFLINE_NOTICE.text} Your resume is safe.`}
    >
      <Button type="button" onClick={() => retry()}>
        Try again
      </Button>
    </PageNotice>
  );
}
