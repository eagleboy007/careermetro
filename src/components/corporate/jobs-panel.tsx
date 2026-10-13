"use client";

import { Archive, CirclePause, Pencil, Play, Plus } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { formatDay } from "@/lib/corporate/format";
import type { JobListActions, JobListItemView, JobsView } from "@/lib/corporate/types";
import { JOB_STATUS_LABELS, JOB_STATUSES, JOB_TEAM_ROLE_LABELS, JOB_WORK_TYPE_LABELS, JOBS_BLOCKED_TEXT } from "@/lib/schemas/constants";
import { JobStatusBadge, monoLabel } from "./job-parts";
import { ICON } from "./parts";

/** 44px tall, neutral. */
export const actionBtn =
  "inline-flex min-h-11 items-center justify-center gap-1.5 rounded-full border border-line bg-surface px-3.5 text-[0.84rem] font-medium text-ink hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-60";
export const inkBtn =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-ink px-4 text-[0.88rem] font-medium text-bg hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50";

type Move = "open" | "paused" | "closed";
const DONE: Record<Move, string> = {
  open: "Open again. Candidates see it on Departures.",
  paused: "Paused. Candidates don't see it until you open it again.",
  closed: "Closed. It stays here for your records.",
};

/**
 * Corporate's Jobs section (C7): the company's jobs with counts per status, Post a job, and Pause, Open again and Close.
 * A draft opens from its form, after the three checks. Applications and each job's board come in build step 4, so
 * there are no lanes yet. Without `actions` (the /design page) the controls are off.
 */
export function JobsPanel({ jobs, actions }: { jobs: JobsView; actions?: JobListActions }) {
  const [pending, start] = useTransition();
  const [confirming, setConfirming] = useState<string | null>(null);
  const [message, setMessage] = useState<{ kind: "error" | "notice"; text: string } | null>(null);
  const messageRef = useRef<HTMLParagraphElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const returnTo = useRef<string | null>(null);

  useEffect(() => {
    if (message) messageRef.current?.focus();
  }, [message]);
  // The confirm buttons replace Close: focus goes to "Keep it", and back to that job's Close button after it.
  useEffect(() => {
    if (confirming !== null) {
      rootRef.current?.querySelector<HTMLElement>("[data-keep]")?.focus();
      return;
    }
    const id = returnTo.current;
    returnTo.current = null;
    if (id) rootRef.current?.querySelector<HTMLElement>(`[data-close="${CSS.escape(id)}"]`)?.focus();
  }, [confirming]);

  const move = (job: JobListItemView, to: Move) =>
    start(async () => {
      if (!actions) return;
      setMessage(null);
      const error = await actions.setStatus(job.id, to);
      setConfirming(null);
      setMessage(error ? { kind: "error", text: error } : { kind: "notice", text: `${job.title}: ${DONE[to]}` });
    });

  const total = JOB_STATUSES.reduce((n, s) => n + jobs.counts[s], 0);
  return (
    <div ref={rootRef} className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <ul aria-label="Jobs by status" className="mr-auto flex flex-wrap gap-1.5">
          {JOB_STATUSES.map((s) => (
            <li key={s} className="inline-flex items-center gap-1.5 rounded-full border border-line px-3 py-1 text-[0.82rem]">
              {JOB_STATUS_LABELS[s]}
              <span className="font-mono text-[0.76rem] text-muted">{jobs.counts[s]}</span>
            </li>
          ))}
        </ul>
        {jobs.canPost && (
          <Link href="/corporate/jobs/new" className={inkBtn}>
            <Plus {...ICON} />
            Post a job
          </Link>
        )}
      </div>

      {jobs.blocked && (
        <p role="note" className="rounded-md bg-surface-2 px-3.5 py-2.5 text-[0.86rem]">
          {JOBS_BLOCKED_TEXT[jobs.blocked]}
        </p>
      )}

      {message && (
        <p ref={messageRef} tabIndex={-1} role={message.kind === "error" ? "alert" : "status"} className="rounded-md bg-surface-2 px-3.5 py-2.5 text-[0.86rem] text-ink">
          {message.text}
        </p>
      )}

      {total === 0 ? (
        <p className="rounded-lg border border-dashed border-line p-5 text-center text-[0.9rem] text-muted">
          {jobs.canPost ? "No jobs yet. Post one from a role profile, so candidates see how they match it in plain words." : "You aren't on any job's team yet."}
        </p>
      ) : (
        <ul aria-label="Jobs" className="flex flex-col divide-y divide-line overflow-hidden rounded-[14px] border border-line">
          {jobs.items.map((j) => (
            <li key={j.id} className="flex flex-col gap-2.5 px-3.5 py-3.5 min-[760px]:flex-row min-[760px]:items-center min-[760px]:gap-4">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-[1rem] font-semibold leading-[1.25] [overflow-wrap:anywhere]">{j.title}</h3>
                  <JobStatusBadge status={j.status} />
                </div>
                <p className="mt-1 text-[0.82rem] text-muted [overflow-wrap:anywhere]">
                  {j.roleTitle} · {j.city} · {JOB_WORK_TYPE_LABELS[j.workType]} · {j.requiredCount} required {j.requiredCount === 1 ? "skill" : "skills"}
                </p>
                <p className="mt-0.5 text-[0.8rem] text-muted">
                  {j.status === "closed" && j.closedOn ? `Closed ${formatDay(j.closedOn)}` : `Made ${formatDay(j.createdOn)}`}
                  {j.ownerName && ` by ${j.ownerName}`}
                  {j.myRole && j.myRole !== "owner" && ` · you: ${JOB_TEAM_ROLE_LABELS[j.myRole]}`}
                </p>
                {j.status === "open" && (
                  <p className={`mt-1 ${monoLabel}`}>{j.live ? "Live on Departures" : "Not live: candidates can't see it"}</p>
                )}
              </div>
              {j.canEdit && (
                <div className="flex flex-wrap items-center gap-2">
                  {confirming === j.id ? (
                    <>
                      <span className="text-[0.84rem]">Close this job? It can&apos;t open again.</span>
                      <button type="button" className={actionBtn} disabled={pending} onClick={() => move(j, "closed")}>
                        Close job
                      </button>
                      <button
                        type="button"
                        className={actionBtn}
                        data-keep
                        onClick={() => {
                          returnTo.current = j.id;
                          setConfirming(null);
                        }}
                      >
                        Keep it
                      </button>
                    </>
                  ) : (
                    <>
                      {/* Each name starts with the visible word, then says which job. */}
                      <Link href={`/corporate/jobs/edit?id=${j.id}`} aria-label={`${j.status === "draft" ? "Edit and open" : "Edit"} ${j.title}`} className={actionBtn}>
                        <Pencil {...ICON} />
                        {j.status === "draft" ? "Edit and open" : "Edit"}
                      </Link>
                      {j.status === "open" && (
                        <button type="button" aria-label={`Pause ${j.title}`} className={actionBtn} disabled={pending || !actions} onClick={() => move(j, "paused")}>
                          <CirclePause {...ICON} />
                          Pause
                        </button>
                      )}
                      {j.status === "paused" && (
                        <button
                          type="button"
                          aria-label={`Open again ${j.title}`}
                          className={actionBtn}
                          disabled={pending || !actions || jobs.blocked !== null}
                          onClick={() => move(j, "open")}
                        >
                          <Play {...ICON} />
                          Open again
                        </button>
                      )}
                      {j.status !== "draft" && (
                        <button type="button" data-close={j.id} aria-label={`Close ${j.title}`} className={actionBtn} disabled={pending || !actions} onClick={() => setConfirming(j.id)}>
                          <Archive {...ICON} />
                          Close
                        </button>
                      )}
                    </>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      <p className="text-[0.8rem] text-muted">Applications come next. Once they open, each job gets its own board with the same stages candidates see on Arrivals.</p>
    </div>
  );
}
