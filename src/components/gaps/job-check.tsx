"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, useTransition, type FormEvent } from "react";
import { readApiReply } from "@/lib/api-reply";
import type { JobCheckView } from "@/lib/jobs/groups";
import { JOB_COMPANY_MAX, JOB_TEXT_MAX, JOB_TEXT_MIN, JOB_TITLE_MAX } from "@/lib/schemas/constants";
import { JobCheckResult, jobCheckHeadingId } from "./job-check-result";

const input =
  "min-w-0 rounded-md border border-line bg-bg px-3 py-[9px] text-[0.9rem] text-ink focus:outline-2 focus:outline-offset-1 focus:outline-accent disabled:opacity-70";

const count = (n: number) => n.toLocaleString("en-IN");

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
  demo = false,
}: {
  resumeId: string;
  roleSlug: string;
  roleTitle: string;
  checks: JobCheckView[];
  demo?: boolean;
}) {
  const router = useRouter();
  const ids = useId();
  const [company, setCompany] = useState("");
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const focusId = useRef<string | null>(null);
  const [refreshing, startRefresh] = useTransition();
  const busy = sending || refreshing;

  // Once the refreshed page shows the new check, move focus to its heading so a screen reader reads it next.
  useEffect(() => {
    if (refreshing || !focusId.current) return;
    document.getElementById(jobCheckHeadingId(focusId.current))?.focus();
    focusId.current = null;
  }, [refreshing]);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setStatus("");
    const length = text.trim().length;
    if (!company.trim() || !title.trim()) return setError("Add the company and the job title.");
    if (length < JOB_TEXT_MIN) return setError(`Paste the full job posting: at least ${JOB_TEXT_MIN} characters.`);
    if (length > JOB_TEXT_MAX) return setError(`Paste up to ${count(JOB_TEXT_MAX)} characters of the posting.`);
    setError("");
    if (demo) return setStatus("Checked. The result is below.");
    setSending(true);
    try {
      const res = await fetch("/api/job-checks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ resumeId, roleSlug, company, title, text }),
      });
      const reply = await readApiReply(res);
      if (!reply.ok || typeof reply.id !== "string") {
        setError(reply.error ?? "Something went wrong. Please try again.");
        return;
      }
      setStatus(reply.reused ? "You checked this posting before. Its result is below." : "Checked. The result is below.");
      setCompany("");
      setTitle("");
      setText("");
      focusId.current = reply.id;
      startRefresh(() => router.refresh());
    } catch {
      setError("We couldn't reach CareerMetro. Check your connection and try again.");
    } finally {
      setSending(false);
    }
  }

  const hint = `${ids}-hint`;
  const err = `${ids}-error`;
  const invalid = error ? true : undefined;
  return (
    <section className="flex flex-col gap-4" aria-labelledby={`${ids}-heading`}>
      <div className="flex flex-col gap-1">
        <h2 id={`${ids}-heading`} className="font-sans text-lg font-semibold tracking-normal">
          Check against a job
        </h2>
        <p className="text-sm text-muted">
          Paste a job posting to see what that one job asks for. Your goals for {roleTitle} and your match stay as they are. We keep the skills it
          lists, never the posting itself.
        </p>
      </div>
      <form onSubmit={submit} noValidate className="flex flex-col gap-3.5 rounded-lg border border-line bg-surface p-4">
        <div className="grid gap-x-4 gap-y-3.5 min-[760px]:grid-cols-2">
          <label className="flex min-w-0 flex-col gap-1.5">
            <span className="text-[0.82rem] font-semibold">Company</span>
            <input
              name="company"
              value={company}
              onChange={(e) => setCompany(e.target.value)}
              maxLength={JOB_COMPANY_MAX}
              autoComplete="organization"
              required
              disabled={busy}
              aria-invalid={invalid}
              aria-describedby={error ? err : undefined}
              className={input}
            />
          </label>
          <label className="flex min-w-0 flex-col gap-1.5">
            <span className="text-[0.82rem] font-semibold">Job title</span>
            <input
              name="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={JOB_TITLE_MAX}
              autoComplete="off"
              required
              disabled={busy}
              aria-invalid={invalid}
              aria-describedby={error ? err : undefined}
              className={input}
            />
          </label>
        </div>
        <div className="flex min-w-0 flex-col gap-1.5">
          <label htmlFor={`${ids}-text`} className="text-[0.82rem] font-semibold">
            Job posting
          </label>
          <textarea
            id={`${ids}-text`}
            name="text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={8}
            maxLength={JOB_TEXT_MAX}
            required
            disabled={busy}
            aria-invalid={invalid}
            aria-describedby={error ? `${hint} ${err}` : hint}
            className={`${input} resize-y`}
          />
          <small id={hint} className="text-[0.78rem] text-muted">
            Paste the whole posting, at least {JOB_TEXT_MIN} characters. {count(text.length)} of {count(JOB_TEXT_MAX)} used.
          </small>
        </div>
        <p id={err} role="alert" className="text-sm text-bad">
          {error}
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={busy}
            className="inline-flex min-h-11 items-center justify-center rounded-full bg-ink px-5 text-sm font-medium text-bg transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {sending ? "Reading the posting…" : "Check this job"}
          </button>
          <p role="status" className="text-sm">
            {sending ? "Reading the posting. This takes up to a minute." : status}
          </p>
        </div>
      </form>
      {checks.length > 0 && (
        <div className="flex flex-col gap-3">
          <p className="font-mono text-xs uppercase tracking-wider text-muted">Your job checks, newest first</p>
          {checks.map((c) => (
            <JobCheckResult key={c.id} check={c} roleTitle={roleTitle} />
          ))}
        </div>
      )}
    </section>
  );
}
