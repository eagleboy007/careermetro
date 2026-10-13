"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { readApiReply } from "@/lib/api-reply";
import { JOB_COMPANY_MAX, JOB_TEXT_MAX, JOB_TEXT_MIN, JOB_TITLE_MAX } from "@/lib/schemas/constants";

const input =
  "min-w-0 rounded-md border border-line bg-bg px-3 py-[9px] text-[0.9rem] text-ink focus:outline-2 focus:outline-offset-1 focus:outline-accent disabled:opacity-70";

const count = (n: number) => n.toLocaleString("en-IN");

type Field = "company" | "title" | "text";

/**
 * The posting form of "Check against a job" (role-suggest-plan.md part B): company, job title and the pasted posting,
 * sent to /api/job-checks. `roleSlug` null checks the posting standing in for a role our library doesn't have. The
 * text is sent once and never kept here after a save. `busy` holds the form while the caller shows the result;
 * `demo` skips the network call (for /design).
 */
export function JobPostingForm({
  resumeId,
  roleSlug,
  initialTitle = "",
  submitLabel = "Check this job",
  busy: held = false,
  doneMessage,
  onStart,
  onSaved,
  demo = false,
}: {
  resumeId: string;
  roleSlug: string | null;
  initialTitle?: string;
  submitLabel?: string;
  busy?: boolean;
  doneMessage: (reused: boolean) => string;
  /** Called as a check starts, before any answer. */
  onStart?: () => void;
  onSaved: (check: { id: string; reused: boolean }) => void;
  demo?: boolean;
}) {
  const ids = useId();
  const [company, setCompany] = useState("");
  const [title, setTitle] = useState(initialTitle);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  /** The field a form error is about; null for errors from the server (limit, budget), which mark no field. */
  const [errorField, setErrorField] = useState<Field | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const fail = (message: string, field: Field | null) => {
    setError(message);
    setErrorField(field);
  };
  const busy = sending || held;
  // After an error, focus the field it is about, or the posting box, so focus never drops to the page.
  useEffect(() => {
    if (!error || busy) return;
    formRef.current?.querySelector<HTMLElement>(`[name="${errorField ?? "text"}"]`)?.focus();
  }, [error, errorField, busy]);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setStatus("");
    onStart?.();
    const length = text.trim().length;
    if (!company.trim()) return fail("Add the company and the job title.", "company");
    if (!title.trim()) return fail("Add the company and the job title.", "title");
    if (length < JOB_TEXT_MIN) return fail(`Paste the full job posting: at least ${JOB_TEXT_MIN} characters.`, "text");
    if (length > JOB_TEXT_MAX) return fail(`Paste up to ${count(JOB_TEXT_MAX)} characters of the posting.`, "text");
    fail("", null);
    if (demo) return setStatus(doneMessage(false));
    setSending(true);
    try {
      const res = await fetch("/api/job-checks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ resumeId, roleSlug, company, title, text }),
      });
      const reply = await readApiReply(res);
      if (!reply.ok || typeof reply.id !== "string") {
        fail(reply.error ?? "Something went wrong. Please try again.", null);
        return;
      }
      const reused = reply.reused === true;
      setStatus(doneMessage(reused));
      setCompany("");
      setTitle("");
      setText("");
      onSaved({ id: reply.id, reused });
    } catch {
      fail("We couldn't reach CareerMetro. Check your connection and try again.", null);
    } finally {
      setSending(false);
    }
  }

  const hint = `${ids}-hint`;
  const err = `${ids}-error`;
  const invalid = (field: Field) => (error && errorField === field ? true : undefined);
  return (
    <form ref={formRef} onSubmit={submit} noValidate className="flex flex-col gap-3.5 rounded-lg border border-line bg-surface p-4">
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
            aria-invalid={invalid("company")}
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
            aria-invalid={invalid("title")}
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
          aria-invalid={invalid("text")}
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
          {sending ? "Reading the posting…" : submitLabel}
        </button>
        <p role="status" className="text-sm">
          {sending ? "Reading the posting. This takes up to a minute." : status}
        </p>
      </div>
    </form>
  );
}
