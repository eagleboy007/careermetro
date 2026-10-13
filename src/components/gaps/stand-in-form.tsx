"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { clearStandInTitle, peekStandInTitle } from "@/lib/stand-in-title";
import { JobPostingForm } from "./job-posting-form";

/**
 * "My role isn't listed" (role-suggest-plan.md part B, point 4): a pasted posting stands in as the target until we add
 * the role. Once saved, its Gaps page opens. The title typed in the role search arrives through sessionStorage (never
 * the address), read once after the page mounts; without storage the form starts empty. `initialTitle` sets it
 * directly (for /design); `demo` skips the network call.
 */
export function StandInForm({ resumeId, initialTitle = "", demo = false }: { resumeId: string; initialTitle?: string; demo?: boolean }) {
  const router = useRouter();
  const [opening, startOpening] = useTransition();
  const [carried, setCarried] = useState("");
  // Storage exists only in the browser, so it is read after mount, on the next frame, and kept in state from then on.
  // The title is forgotten only once taken, so React's development double run (mount, clean up, mount) can't lose it.
  useEffect(() => {
    if (demo) return;
    const title = peekStandInTitle();
    if (!title) return;
    const frame = requestAnimationFrame(() => {
      setCarried(title);
      clearStandInTitle();
    });
    return () => cancelAnimationFrame(frame);
  }, [demo]);
  const title = carried || initialTitle;
  return (
    <JobPostingForm
      // Starts again once, with the carried title, when it arrives.
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
