"use client";

import { useRouter } from "next/navigation";
import { useEffect, useSyncExternalStore, useTransition } from "react";
import { clearStandInTitle, peekStandInTitle } from "@/lib/stand-in-title";
import { JobPostingForm } from "./job-posting-form";

const noSubscribe = () => () => {};

/**
 * "My role isn't listed" (role-suggest-plan.md part B, point 4): a pasted posting stands in as the target until we add
 * the role. Once saved, its Gaps page opens. The title typed in the role search arrives through sessionStorage (never
 * the address), read only in the browser; without storage the form starts empty. `initialTitle` sets it directly (for
 * /design); `demo` skips the network call.
 */
export function StandInForm({ resumeId, initialTitle = "", demo = false }: { resumeId: string; initialTitle?: string; demo?: boolean }) {
  const router = useRouter();
  const [opening, startOpening] = useTransition();
  const carried = useSyncExternalStore(noSubscribe, () => (demo ? "" : peekStandInTitle()), () => "");
  const title = carried || initialTitle;
  // Forgotten when the person leaves the form, saved or not, so the next check starts empty.
  useEffect(() => clearStandInTitle, []);
  return (
    <JobPostingForm
      // Starts again with the carried title once the browser has read it.
      key={title}
      resumeId={resumeId}
      roleSlug={null}
      initialTitle={title}
      submitLabel="Check my gaps for this job"
      busy={opening}
      demo={demo}
      doneMessage={() => "Checked. Opening your gaps for this job…"}
      onSaved={({ id }) => startOpening(() => router.push(`/resume/${resumeId}/job/${id}`))}
    />
  );
}
