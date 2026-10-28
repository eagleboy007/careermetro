"use client";

import Link from "next/link";
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
  signedIn = true,
  demo = false,
}: {
  /** False before sign-up: the first check asks the visitor to keep it in My jobs (handoff 12m, C19). */
  signedIn?: boolean;
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
        {!signedIn && <p className="text-[0.95rem] font-[550]">Paste the job you&apos;re applying for and see what it asks that you don&apos;t have.</p>}
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
      {!signedIn && checks.length > 0 && <KeepInMyJobs demo={demo} />}
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

/** Where "Sign up with email" goes: sign-in makes the account, and the claim puts the newest check in My jobs. */
export const KEEP_IN_MY_JOBS_HREF = `/sign-in?next=${encodeURIComponent("/departures?tab=mine")}`;

/**
 * "Sign up to keep it in My jobs and prepare for the interview." (handoff 12m, C19): after the first job check before
 * sign-up. Signing up claims the resume and its checks, and the newest check waits in My jobs marked Saved. Cobalt
 * outline: it is the next step forward.
 */
export function KeepInMyJobs({ demo = false }: { demo?: boolean }) {
  const [notNow, setNotNow] = useState(false);
  if (notNow) return null;
  return (
    <section aria-label="Keep it in My jobs" className="flex flex-col gap-3 rounded-lg border-2 border-accent bg-surface p-4">
      <h3 className="font-sans text-base font-semibold tracking-normal">Sign up to keep it in My jobs and prepare for the interview.</h3>
      <ul className="flex list-disc flex-col gap-1 pl-5 text-sm">
        <li>The job waits in My jobs, marked Saved, with room for its link and your notes.</li>
        <li>Practise on these skills, and a mock interview for this job with Elite, free in the beta.</li>
        <li>Your resume and this check come with you.</li>
      </ul>
      <div className="flex flex-wrap items-center gap-2">
        <Link
          href={demo ? "#" : KEEP_IN_MY_JOBS_HREF}
          className="inline-flex items-center justify-center rounded-full bg-accent px-4 py-2 text-sm font-semibold text-on-accent hover:opacity-90"
        >
          Sign up with email
        </Link>
        <button type="button" onClick={() => setNotNow(true)} className="inline-flex items-center rounded-full px-3 py-2 text-sm font-semibold text-ink hover:bg-surface-2">
          Not now
        </button>
      </div>
      <p className="text-xs text-muted">If you don&apos;t sign up, the resume and this check are deleted after 24 hours. We never show a job you add to anyone.</p>
    </section>
  );
}
