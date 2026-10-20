"use client";

import { Check, Lock, Send, X, Zap } from "lucide-react";
import Link from "next/link";
import { useEffect, useId, useRef, useState, useTransition } from "react";
import { CriteriaList } from "@/components/corporate/criteria-parts";
import { actionBtn, inkBtn } from "@/components/corporate/jobs-panel";
import { MatchList } from "@/components/corporate/match-parts";
import { ICON } from "@/components/corporate/parts";
import { hasContactDetails } from "@/lib/account/username";
import type { ApplyAction, ApplyPacketView, ApplyPreviewAction, ApplyState, CanJoin } from "@/lib/corporate/types";
import {
  APPLICATION_NOTE_CONTACT_TEXT,
  APPLICATION_NOTE_LONG_TEXT,
  APPLICATION_NOTE_MAX,
  APPLICATION_STAGE_LABELS,
  APPLY_NEVER,
  CAN_JOIN,
  CAN_JOIN_LABELS,
  PREVIEW_LIVE_NOTE,
} from "@/lib/schemas/constants";

/**
 * Express apply (pending item 16; dev/express-apply-plan.md), on a job a verified company posted on CareerMetro. The
 * button opens a preview of exactly what the company would receive (the packet the company's drawer shows), with when
 * the person can join, an optional note and the consent tick naming that one company (DPDP Act). Send there is the
 * one tap that sends. Unmet criteria warn and never block. Once applied, the card says where it stands and links to
 * Arrivals. The preview is a native modal <dialog>: focus starts on its heading, stays inside it, and on closing goes
 * back to Express apply, or to the confirmation once sent; never to the page body.
 */
export function ApplyPanel({
  jobId,
  company,
  title,
  state,
  action,
  preview,
  example,
  initialCanJoin,
}: {
  jobId: string;
  company: string;
  title: string;
  state: ApplyState;
  action?: ApplyAction;
  preview?: ApplyPreviewAction;
  /** /design: the packet to show instead of reading one. Nothing is sent. */
  example?: ApplyPacketView;
  /** Prefilled from the person's notice countdown (the nearest choice not before "Free to join from"). */
  initialCanJoin?: CanJoin;
}) {
  const [open, setOpen] = useState(false);
  // Kept here, so closing the preview and opening it again keeps what the person wrote.
  const [canJoin, setCanJoin] = useState<CanJoin | "">(initialCanJoin ?? "");
  const [note, setNote] = useState("");
  const [consent, setConsent] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const doneRef = useRef<HTMLDivElement>(null);
  const wasApplied = useRef(state.kind === "applied");

  useEffect(() => {
    if (state.kind === "applied" && !wasApplied.current) doneRef.current?.focus();
    wasApplied.current = state.kind === "applied";
  }, [state.kind]);

  /** Focus goes back to Express apply, or on to the confirmation once sent, in the same tick the dialog closes. */
  const closed = (sent: boolean) => {
    setOpen(false);
    (sent ? doneRef.current : buttonRef.current)?.focus();
  };

  let main;
  if (state.kind === "signed_out") {
    main = (
      <Link href="/sign-in?next=/departures" className={`${actionBtn} self-start`}>
        <Send {...ICON} />
        Sign in to apply
      </Link>
    );
  } else if (state.kind === "no_resume") {
    main = (
      <p className="text-[0.84rem] text-muted">
        Add your resume first, so {company} can see how you match this job.{" "}
        <Link href="/today" className="inline-flex min-h-11 items-center text-ink underline underline-offset-2">
          Add your resume
        </Link>
      </p>
    );
  } else if (state.kind === "applied") {
    main = (
      <div ref={doneRef} tabIndex={-1} role="status" className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.86rem]">
        <span className="inline-flex items-center gap-1.5 font-medium">
          <Check {...ICON} />
          {state.withdrawn ? "You withdrew this application" : `Applied · ${APPLICATION_STAGE_LABELS[state.stage]}`}
        </span>
        <Link href="/arrivals" className="inline-flex min-h-11 items-center text-ink underline underline-offset-2">
          Follow it on Arrivals
        </Link>
      </div>
    );
  } else {
    main = (
      <div className="flex flex-col gap-1.5">
        <button ref={buttonRef} type="button" aria-label={`Express apply: ${title}`} aria-haspopup="dialog" className={`${inkBtn} self-start`} onClick={() => setOpen(true)}>
          <Zap {...ICON} />
          Express apply
        </button>
        <p className="text-[0.8rem] text-muted">See exactly what {company} receives before anything is sent.</p>
      </div>
    );
  }

  return (
    <>
      {main}
      {open && (
        <ApplyPreview
          jobId={jobId}
          company={company}
          title={title}
          sent={state.kind === "applied"}
          form={{ canJoin, note, consent, setCanJoin, setNote, setConsent }}
          action={action}
          preview={preview}
          example={example}
          onClose={closed}
        />
      )}
    </>
  );
}

type PreviewForm = {
  canJoin: CanJoin | "";
  note: string;
  consent: boolean;
  setCanJoin: (v: CanJoin | "") => void;
  setNote: (v: string) => void;
  setConsent: (v: boolean) => void;
};

/** The note as it will be sent (trimmed), so the count matches the server's. */
const noteLength = (v: string) => v.trim().length;

/**
 * The preview dialog: the packet (public profile, Match to this job, the criteria), then Can join, the note, what is
 * never sent and the consent tick. `sent` turns true once Departures reloads with the application, which closes it.
 */
export function ApplyPreview({
  jobId,
  company,
  title,
  sent,
  form,
  action,
  preview,
  example,
  onClose,
}: {
  jobId: string;
  company: string;
  title: string;
  sent: boolean;
  form: PreviewForm;
  action?: ApplyAction;
  preview?: ApplyPreviewAction;
  example?: ApplyPacketView;
  onClose: (sent: boolean) => void;
}) {
  const [packet, setPacket] = useState<ApplyPacketView | null>(preview ? null : (example ?? null));
  const [loadError, setLoadError] = useState<string | null>(preview || example ? null : "Sign in to apply.");
  const [error, setError] = useState<string | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const ids = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    // A native modal dialog: the page behind it is inert, so focus can't leave it. Focus starts on its heading.
    const d = dialogRef.current;
    if (d && !d.open) d.showModal();
    headingRef.current?.focus();
    if (!preview) return;
    let live = true;
    preview(jobId).then((r) => {
      if (!live) return;
      if (r.ok) setPacket(r.packet);
      else setLoadError(r.error);
    });
    return () => {
      live = false;
    };
  }, [preview, jobId]);
  useEffect(() => {
    // Leaving the page with the preview open must not leave a modal dialog in the top layer.
    const d = dialogRef.current;
    return () => d?.close();
  }, []);
  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);
  useEffect(() => {
    // Departures reloaded with the application: close, and the panel moves focus to the confirmation.
    if (!sent) return;
    dialogRef.current?.close();
    onClose(true);
  }, [sent, onClose]);

  const close = () => {
    if (pending) return;
    dialogRef.current?.close();
    onClose(false);
  };

  const len = noteLength(form.note);
  const noteProblem = len > APPLICATION_NOTE_MAX ? APPLICATION_NOTE_LONG_TEXT : hasContactDetails(form.note) ? APPLICATION_NOTE_CONTACT_TEXT : null;

  const send = () => {
    // Send stays focusable while sending (aria-disabled, not disabled), so focus never drops to the page body.
    if (pending) return;
    if (!form.canJoin) return setError("Pick when you can join.");
    if (noteProblem) return setError(noteProblem);
    if (!form.consent) return setError(`Tick the box to send this to ${company}.`);
    if (!action) return setError(example ? "Example preview. Nothing is sent." : "Sign in to apply.");
    const canJoin = form.canJoin;
    start(async () => {
      setError(null);
      setSaid("Sending…");
      const message = await action(jobId, canJoin, true, form.note);
      if (message) {
        setSaid(null);
        setError(message);
      }
    });
  };

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={`${ids}-h`}
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      onClick={(e) => e.target === e.currentTarget && close()}
      className="m-auto max-h-[calc(100dvh-24px)] w-[calc(100%-24px)] max-w-[640px] flex-col rounded-lg border border-line bg-surface p-0 text-ink shadow-[0_20px_40px_-30px_var(--shadow)] backdrop:bg-ink/30 open:flex"
    >
      <div className="flex items-start gap-3 border-b border-line p-4">
        <div className="min-w-0 flex-1">
          <span className="font-mono text-[0.7rem] uppercase tracking-[0.06em] text-muted">Express apply · preview</span>
          <h2 ref={headingRef} id={`${ids}-h`} tabIndex={-1} className="mt-0.5 text-[1.2rem] font-semibold leading-[1.2] [overflow-wrap:anywhere]">
            What {company} receives
          </h2>
          <p className="text-[0.84rem] text-muted [overflow-wrap:anywhere]">For {title}. Nothing is sent until you press Send.</p>
          {/* The company's drawer reads the profile and proof live (dev/express-apply-plan.md, decision on T51). */}
          <p className="text-[0.84rem] text-muted">{PREVIEW_LIVE_NOTE}</p>
        </div>
        <button type="button" aria-label="Close the preview" className={`${actionBtn} w-11 shrink-0 px-0`} onClick={close}>
          <X {...ICON} />
        </button>
      </div>

      <form
        noValidate
        aria-labelledby={`${ids}-h`}
        className="flex min-h-0 flex-1 flex-col"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-4">
          {!packet ? (
            loadError ? (
              <p role="alert" className="text-[0.9rem]">
                {loadError}
              </p>
            ) : (
              <p className="text-[0.9rem] text-muted">Loading what {company} would receive…</p>
            )
          ) : (
            <>
              <PacketProfile packet={packet} />
              <section aria-labelledby={`${ids}-match`} className="flex flex-col gap-2">
                <h3 id={`${ids}-match`} className="text-[1rem] font-semibold">
                  Match to this job
                </h3>
                <MatchList match={packet.match} />
              </section>
              {packet.criteria.total > 0 && (
                <section aria-label="Express apply criteria" className="flex flex-col gap-2">
                  <CriteriaList criteria={packet.criteria} warn />
                </section>
              )}
            </>
          )}

          <section aria-labelledby={`${ids}-you`} className="flex flex-col gap-3">
            <h3 id={`${ids}-you`} className="text-[1rem] font-semibold">
              From you
            </h3>
            <label className="flex flex-col gap-1.5 text-[0.84rem] font-semibold">
              When can you join?
              <select
                value={form.canJoin}
                onChange={(e) => form.setCanJoin(e.target.value as CanJoin)}
                className="min-h-11 rounded-sm border border-line-strong bg-surface px-3 text-[0.88rem] font-normal text-ink"
              >
                <option value="">Choose</option>
                {CAN_JOIN.map((c) => (
                  <option key={c} value={c}>
                    {CAN_JOIN_LABELS[c]}
                  </option>
                ))}
              </select>
            </label>
            {/* FR-55: Open to work in goes with the application as it is now; it is changed in Settings, not here. */}
            {packet?.openToWorkIn && packet.openToWorkIn.length > 0 && (
              <p className="text-[0.84rem] [overflow-wrap:anywhere]">
                <span className="font-semibold">Open to work in:</span>
                {` ${packet.openToWorkIn.join(", ")}. `}
                <Link href="/settings#acc-pay" className="text-ink underline underline-offset-2">
                  Change in Settings
                </Link>
              </p>
            )}
            <label className="flex flex-col gap-1.5 text-[0.84rem] font-semibold">
              A note to {company} (optional)
              <span id={`${ids}-note-hint`} className="text-[0.78rem] font-normal text-muted">
                Up to {APPLICATION_NOTE_MAX} characters, about this job. No email address or phone number: they write to you in the application&apos;s chat.
              </span>
              <textarea
                rows={4}
                value={form.note}
                onChange={(e) => form.setNote(e.target.value)}
                aria-describedby={`${ids}-note-hint ${ids}-note-count`}
                aria-invalid={noteProblem ? true : undefined}
                className="rounded-sm border border-line-strong bg-bg px-3 py-2 text-[0.88rem] font-normal text-ink"
              />
              <span id={`${ids}-note-count`} className={`self-end font-mono text-[0.72rem] font-normal ${len > APPLICATION_NOTE_MAX ? "text-ink" : "text-muted"}`}>
                {len} of {APPLICATION_NOTE_MAX}
              </span>
            </label>
          </section>

          <p className="flex items-start gap-2 rounded-md bg-surface-2 px-3.5 py-2.5 text-[0.82rem]">
            <Lock {...ICON} className="mt-0.5 shrink-0" />
            <span>{APPLY_NEVER}</span>
          </p>
          <label className="flex min-h-11 items-start gap-2.5 text-[0.84rem]">
            <input type="checkbox" checked={form.consent} onChange={(e) => form.setConsent(e.target.checked)} className="mt-1 size-4 shrink-0 accent-ink" />
            <span>
              I agree to send this to {company} for this job. I can withdraw the application on Arrivals, which stops further sharing.
            </span>
          </label>
        </div>

        <div className="flex flex-col gap-2 border-t border-line p-4">
          {error && (
            <p ref={errorRef} tabIndex={-1} role="alert" className="text-[0.86rem] font-medium">
              {error}
            </p>
          )}
          {said && !error && (
            <p role="status" className="text-[0.86rem] text-muted">
              {said}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <button
              type="submit"
              className={`${inkBtn} aria-disabled:cursor-not-allowed aria-disabled:opacity-50`}
              aria-disabled={pending || undefined}
              // Off only until the packet has loaded (nothing to send yet, and focus is on the heading then).
              disabled={!packet && !!preview}
            >
              <Send {...ICON} />
              Send application
            </button>
            <button type="button" className={`${actionBtn} aria-disabled:cursor-not-allowed aria-disabled:opacity-60`} onClick={close} aria-disabled={pending || undefined}>
              Cancel
            </button>
          </div>
        </div>
      </form>
    </dialog>
  );
}

/** The public profile parts the company receives: name, headline, job titles, employers, dates, education, certificates. */
function PacketProfile({ packet }: { packet: ApplyPacketView }) {
  const { profile } = packet;
  const h = "font-mono text-[0.7rem] uppercase tracking-[0.06em] text-muted";
  return (
    <section aria-label="Your profile, as the company sees it" className="flex flex-col gap-3">
      <div>
        <h3 className="text-[1rem] font-semibold [overflow-wrap:anywhere]">{profile.name}</h3>
        {profile.headline && <p className="text-[0.86rem] text-muted [overflow-wrap:anywhere]">{profile.headline}</p>}
      </div>
      <div className="flex flex-col gap-1.5">
        <h4 className={h}>Experience</h4>
        {profile.experience.length ? (
          <ul className="flex flex-col gap-1.5">
            {profile.experience.map((x, i) => (
              <li key={i} className="flex flex-col">
                <span className="text-[0.88rem] font-medium [overflow-wrap:anywhere]">
                  {x.title} · {x.employer}
                </span>
                <span className="font-mono text-[0.74rem] text-muted">{x.dates}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[0.86rem] text-muted">No work experience listed.</p>
        )}
      </div>
      {profile.education.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <h4 className={h}>Education</h4>
          <ul className="flex flex-col gap-1 text-[0.86rem]">
            {profile.education.map((e, i) => (
              <li key={i} className="[overflow-wrap:anywhere]">
                {e.qualification}, {e.institution}
                {e.year && ` (${e.year})`}
              </li>
            ))}
          </ul>
        </div>
      )}
      {profile.certifications.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <h4 className={h}>Certifications on your resume</h4>
          <ul className="flex flex-col gap-1 text-[0.86rem]">
            {profile.certifications.map((c) => (
              <li key={c} className="[overflow-wrap:anywhere]">
                {c}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
