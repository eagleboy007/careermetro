"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, useTransition } from "react";
import type { JobCheckView } from "@/lib/jobs/groups";
import { JobCheckResult, jobCheckHeadingId, type GoalsContext } from "./job-check-result";
import { JobPostingForm } from "./job-posting-form";

/**
 * "Check against a job" on the Gaps page (role-suggest-plan.md part B): paste a posting, see what that one job asks
 * for against the resume and the target role. Saved checks are listed newest first. A check never changes goals or the
 * match. `demo` skips the network call (for /design).
 */
export function JobCheck({
  resumeId,
  roleSlug,
  roleTitle,
  checks,
  goals,
  profileVersion = null,
  demo = false,
}: {
  resumeId: string;
  /** The confirmed profile version the page shows, for "I have this" (FR-34); null hides it. */
  profileVersion?: number | null;
  roleSlug: string;
  roleTitle: string;
  checks: JobCheckView[];
  /** The visitor's goals, for "Add as my goal" on each check. */
  goals: GoalsContext;
  demo?: boolean;
}) {
  const router = useRouter();
  const ids = useId();
  const focusId = useRef<string | null>(null);
  const [refreshing, startRefresh] = useTransition();

  /** Said once a check is removed, in this component's own polite live region. */
  const [removedNote, setRemovedNote] = useState("");
  // Once the refreshed page shows the new check, move focus to its heading so a screen reader reads it next. After a
  // check is removed, focus goes to the next check's heading, or to this section's heading when none is left.
  useEffect(() => {
    if (refreshing || !focusId.current) return;
    (document.getElementById(jobCheckHeadingId(focusId.current)) ?? document.getElementById(`${ids}-heading`))?.focus();
    focusId.current = null;
  }, [refreshing, ids]);

  /** After "Remove this check": refresh, then focus the next check (or the one before it, or the heading). */
  function removed(id: string) {
    const at = checks.findIndex((c) => c.id === id);
    const next = checks[at + 1] ?? checks[at - 1];
    focusId.current = next?.id ?? "none";
    setRemovedNote("Check removed. Goals you added from it stay.");
    startRefresh(() => router.refresh());
  }

  return (
    <section className="flex flex-col gap-4" aria-labelledby={`${ids}-heading`}>
      <div className="flex flex-col gap-1">
        <h2 id={`${ids}-heading`} tabIndex={-1} className="font-sans text-lg font-semibold tracking-normal focus:outline-2 focus:outline-offset-2 focus:outline-ink">
          Check against a job
        </h2>
        <p className="text-sm text-muted">
          Paste a job posting to see what that one job asks for. Your goals for {roleTitle} and your match stay as they are. We keep the skills it
          lists, never the posting itself.
        </p>
      </div>
      <JobPostingForm
        resumeId={resumeId}
        roleSlug={roleSlug}
        busy={refreshing}
        demo={demo}
        onStart={() => setRemovedNote("")}
        doneMessage={(reused) => (reused ? "You checked this posting before. Its result is below." : "Checked. The result is below.")}
        onSaved={({ id }) => {
          focusId.current = id;
          startRefresh(() => router.refresh());
        }}
      />
      <p role="status" aria-live="polite" className="sr-only">
        {removedNote}
      </p>
      {checks.length > 0 && (
        <div className="flex flex-col gap-3">
          <p className="font-mono text-xs uppercase tracking-wider text-muted">Your job checks, newest first</p>
          {checks.map((c) => (
            <JobCheckResult
              key={c.id}
              check={c}
              resumeId={resumeId}
              profileVersion={profileVersion}
              roleTitle={roleTitle}
              planHref={`/resume/${resumeId}/path/${roleSlug}?job=${c.id}`}
              goals={goals}
              onRemoved={() => removed(c.id)}
              demo={demo}
            />
          ))}
        </div>
      )}
    </section>
  );
}
