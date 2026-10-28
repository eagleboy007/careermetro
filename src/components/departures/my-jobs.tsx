"use client";

import { Briefcase, Check, ChevronDown, ExternalLink, Link2, Lock, Pen, Play, ShieldCheck, Target, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { ICON } from "@/components/map/map-parts";
import { StatusChip } from "@/components/ui/status-chip";
import { actionFailed, readApiReply } from "@/lib/api-reply";
import { initials } from "@/lib/departures/filter";
import { inFilter, isClosed, isMoving, linkKind, LINK_HINTS, myJobsEmpty, prepareHref, type MyJobFilter, type MyJobStatus } from "@/lib/my-jobs/rules";
import { dayValue, fitSentence, fitWords, shortDay, type MyJobFit } from "@/lib/my-jobs/view";
import type { MyJobRef, MyJobView } from "@/lib/schemas";
import {
  JOB_COMPANY_MAX,
  JOB_TEXT_MAX,
  JOB_TITLE_MAX,
  MY_JOB_CITY_MAX,
  MY_JOB_FILTER_LABELS,
  MY_JOB_FILTERS,
  MY_JOB_NOTE_MAX,
  MY_JOB_STATUS_LABELS,
  MY_JOB_STATUSES,
  MY_JOB_URL_MAX,
} from "@/lib/schemas/constants";

/*
 * My jobs (handoff 12m, prototype v48): the person's own list of feed jobs and jobs they added from any site, its
 * status menu and edit sheet, and "Add a job you found". Private to the person. Red, amber and green are for gaps
 * only; cobalt marks an application that is moving.
 */

/** My jobs' changes, kept on the server (src/app/(app)/departures/actions.ts). Each returns null or the words to show. */
export type MyJobActions = {
  save: (input: { checkId: string; company: string; title: string; city: string | null }) => Promise<string | null>;
  status: (input: { ref: MyJobRef; status: MyJobStatus }) => Promise<string | null>;
  update: (input: EditValues & { ref: MyJobRef }) => Promise<string | null>;
  remove: (input: { ref: MyJobRef }) => Promise<string | null>;
  description: (checkId: string) => Promise<{ text: string | null } | { error: string }>;
};

/** What the edit sheet sends: company, title, link and city only for a job the person added. */
export type EditValues = {
  company?: string;
  title?: string;
  url?: string | null;
  city?: string | null;
  status: MyJobStatus;
  appliedOn: string | null;
  closedOn: string | null;
  note: string | null;
};

const btn = "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full px-[15px] py-[9px] text-[0.86rem] font-[550]";
const primary = `${btn} bg-accent text-on-accent hover:opacity-90 disabled:opacity-60`;
const ghost = `${btn} border border-line-strong text-ink hover:bg-surface-2`;
const small = "px-[11px] py-1.5 text-[0.8rem]";
const pill =
  "inline-flex items-center gap-1.5 rounded-full border border-line px-[11px] py-1 text-[0.78rem] font-[550] text-muted aria-pressed:border-transparent aria-pressed:bg-surface-2 aria-pressed:text-ink";
const mono = "font-mono text-[0.68rem] uppercase tracking-[0.05em]";
const field = "flex min-w-0 flex-col gap-1 rounded-[10px] border border-line bg-surface px-2.5 py-2 focus-within:border-accent";
const fieldLabel = `${mono} text-[0.64rem] text-muted`;
const fieldInput = "min-w-0 bg-transparent text-[0.9rem] text-ink outline-none disabled:text-muted";

const today = () => shortDay(new Date().toISOString())!;

/** The status chip's look: Saved neutral, a moving application cobalt-soft, a closed one outlined and muted. */
const chipTone = (status: MyJobStatus) =>
  isMoving(status) ? "bg-accent-soft text-accent" : isClosed(status) ? "border-line bg-transparent text-muted" : "bg-surface-2 text-muted";

export const Logo = ({ name }: { name: string }) => (
  <span
    aria-hidden="true"
    className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] bg-surface-2 font-display text-[0.85rem] font-semibold text-ink min-[760px]:h-11 min-[760px]:w-11 min-[760px]:rounded-[12px] min-[760px]:text-base"
  >
    {initials(name)}
  </span>
);

/** "You have 3 ·" and the still-open gaps, or one green chip; then "Only for this job" in muted words, never a gap chip. */
export function FitLine({ fit }: { fit: MyJobFit }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {fit.open.length ? (
        <>
          <span className="text-[0.78rem] text-muted">You have {fit.have} ·</span>
          {fit.open.map((g) => (
            <StatusChip key={g.name} status={g.status} label={g.name} />
          ))}
        </>
      ) : (
        <StatusChip status="met" label={`You have all ${fit.have} it asks for`} />
      )}
      {fit.only.length > 0 && <span className="text-[0.78rem] text-muted">Only for this job: {fit.only.join(", ")}</span>}
    </div>
  );
}

/**
 * The My jobs tab: lead line, filter chips and the rows. `onChange` sets a row's status from its menu; `onEdit` opens
 * the edit sheet; `onAdd` takes the person to "Add a job you found".
 */
export function MyJobsList({
  jobs,
  onStatus,
  onEdit,
  onAdd,
}: {
  jobs: MyJobView[];
  onStatus: (job: MyJobView, status: MyJobStatus) => void;
  onEdit: (job: MyJobView) => void;
  onAdd: () => void;
}) {
  const [filter, setFilter] = useState<MyJobFilter>("all");
  const shown = jobs.filter((j) => inFilter(j.status, filter));
  const empty = myJobsEmpty(filter, MY_JOB_FILTER_LABELS[filter]);
  return (
    <section aria-label="My jobs" className="flex flex-col gap-3">
      <div className="flex flex-col gap-2.5">
        <p className="text-[0.86rem] text-muted">Jobs you saved or applied to, from our company boards and from anywhere else. Only you see this list.</p>
        <div role="group" aria-label="Filter My jobs" className="inline-flex flex-wrap gap-1">
          {MY_JOB_FILTERS.map((f) => (
            <button key={f} type="button" aria-pressed={filter === f} className={pill} onClick={() => setFilter(f)}>
              {MY_JOB_FILTER_LABELS[f]}
            </button>
          ))}
        </div>
      </div>
      {shown.length ? (
        <ul className="flex flex-col gap-2.5">
          {shown.map((j) => (
            <MyJobRow key={j.key} job={j} onStatus={(s) => onStatus(j, s)} onEdit={() => onEdit(j)} />
          ))}
        </ul>
      ) : (
        <div data-my-jobs-empty className="flex flex-wrap items-center gap-3 rounded-[18px] border border-dashed border-line bg-surface p-[18px]">
          <Briefcase size={20} {...ICON} className="shrink-0 text-muted" />
          <div className="min-w-[220px] flex-1">
            <b className="text-[0.95rem] font-semibold">{empty.heading}</b>
            <p className="mt-0.5 text-[0.84rem] text-muted">{empty.text}</p>
          </div>
          <button type="button" className={`${ghost} ${small}`} onClick={onAdd}>
            Add a job you found
          </button>
        </div>
      )}
    </section>
  );
}

function MyJobRow({ job, onStatus, onEdit }: { job: MyJobView; onStatus: (s: MyJobStatus) => void; onEdit: () => void }) {
  const closed = isClosed(job.status);
  const dates: [string, string][] = [];
  if (job.status === "saved" && job.savedAt) dates.push(["Saved", shortDay(job.savedAt)!]);
  if (job.appliedAt) dates.push(["Applied", shortDay(job.appliedAt)!]);
  if (closed && job.closedAt) dates.push([MY_JOB_STATUS_LABELS[job.status], shortDay(job.closedAt)!]);
  const meta: ReactNode[] = [job.company, job.city ?? "City not given"];
  return (
    <li
      data-my-job={job.key}
      className={`grid grid-cols-[36px_minmax(0,1fr)] items-start gap-2.5 rounded-[18px] border border-line bg-surface p-3.5 min-[760px]:grid-cols-[44px_minmax(0,1fr)_auto] min-[760px]:gap-3.5 min-[760px]:p-4 ${closed ? "bg-bg" : ""}`}
    >
      {/* A closed row is dimmed in its logo and title only, so the small grey text keeps its contrast. */}
      <div className={closed ? "opacity-[.72]" : undefined}>
        <Logo name={job.company} />
      </div>
      <div className="flex min-w-0 flex-col gap-1.5">
        <b className={`text-[0.98rem] font-semibold [overflow-wrap:anywhere] ${closed ? "opacity-[.72]" : ""}`}>{job.title}</b>
        <p className="flex flex-wrap items-center gap-1.5 text-[0.8rem] text-muted">
          {meta.map((m, i) => (
            <span key={i} className="contents">
              {i > 0 && <span aria-hidden="true">·</span>}
              <span className="[overflow-wrap:anywhere]">{m}</span>
            </span>
          ))}
          <span aria-hidden="true">·</span>
          <span className={`${mono} rounded-[6px] px-[7px] py-0.5 ${job.source === "you" ? "border border-line" : "bg-surface-2"}`}>
            {job.source === "you" ? "You added" : "Company job board"}
          </span>
          {job.url && (
            <>
              <span aria-hidden="true">·</span>
              <a href={job.url} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex items-center gap-1 text-ink hover:underline">
                Open the original
                <ExternalLink size={13} {...ICON} />
                <span className="sr-only"> (opens in a new tab)</span>
              </a>
            </>
          )}
        </p>
        {job.postClosed && <p className="text-[0.8rem] font-[550] text-muted">Closed on the company&apos;s board</p>}
        {job.fit && <FitLine fit={job.fit} />}
        {dates.length > 0 && (
          <p className="flex flex-wrap gap-2.5 font-mono text-[0.7rem] tracking-[0.04em] text-muted">
            {dates.map(([label, day], i) => (
              <span key={label} className="contents">
                {i > 0 && <span aria-hidden="true">·</span>}
                <span>
                  {label} <b className="font-medium text-ink">{day}</b>
                </span>
              </span>
            ))}
          </p>
        )}
        {job.note && (
          <p className="flex items-start gap-1.5 text-[0.8rem] text-muted">
            <Lock size={13} {...ICON} className="mt-[3px] shrink-0" />
            <span className="sr-only">Your private note: </span>
            <span className="whitespace-pre-line [overflow-wrap:anywhere]">{job.note}</span>
          </p>
        )}
      </div>
      <div className="col-start-2 flex flex-wrap items-center justify-between gap-2 min-[760px]:col-start-3 min-[760px]:flex-col min-[760px]:items-end">
        <StatusMenu job={job} onPick={onStatus} />
        <div className="flex items-center gap-1.5">
          {!closed && <PrepareMenu job={job} />}
          <button
            type="button"
            onClick={onEdit}
            aria-label={`Edit ${job.title} at ${job.company}`}
            className="grid h-[34px] w-[34px] place-items-center rounded-[10px] border border-line text-muted hover:text-ink"
          >
            <Pen size={16} {...ICON} />
          </button>
        </div>
      </div>
    </li>
  );
}

/**
 * The status chip and its menu: all seven in order, a rule before the two closed ones, "sets 28 Oct" on each and "now"
 * on the current one. Arrow keys move between items; Escape and a click outside close it, with focus back on the chip.
 */
function StatusMenu({ job, onPick }: { job: MyJobView; onPick: (s: MyJobStatus) => void }) {
  const [open, setOpen] = useState(false);
  const ids = useId();
  const wrap = useRef<HTMLDivElement>(null);
  const chip = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    wrap.current?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus();
    const away = (e: PointerEvent) => !wrap.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [open]);
  const close = () => {
    setOpen(false);
    chip.current?.focus();
  };
  const keys = (e: KeyboardEvent) => {
    if (e.key === "Escape") return close();
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const items = [...(wrap.current?.querySelectorAll<HTMLElement>('[role="menuitemradio"]') ?? [])];
    const at = items.indexOf(document.activeElement as HTMLElement);
    items[(at + (e.key === "ArrowDown" ? 1 : items.length - 1)) % items.length]?.focus();
  };
  return (
    <div ref={wrap} className="relative" onKeyDown={open ? keys : undefined}>
      <button
        ref={chip}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? `${ids}-menu` : undefined}
        aria-label={`Status: ${MY_JOB_STATUS_LABELS[job.status]}. Change it`}
        onClick={() => setOpen((o) => !o)}
        className={`inline-flex items-center gap-[5px] whitespace-nowrap rounded-[8px] border border-transparent py-[5px] pl-2.5 pr-[9px] font-mono text-[0.7rem] uppercase tracking-[0.06em] hover:border-muted aria-expanded:border-muted ${chipTone(job.status)}`}
      >
        {MY_JOB_STATUS_LABELS[job.status]}
        <ChevronDown size={12} {...ICON} />
      </button>
      {open && (
        <div
          id={`${ids}-menu`}
          role="menu"
          aria-label={`Status of ${job.title}`}
          className="absolute left-0 top-[calc(100%+6px)] z-20 flex min-w-[230px] flex-col rounded-[14px] border border-line bg-surface p-1.5 shadow-[0_14px_40px_-20px_var(--shadow)] min-[760px]:left-auto min-[760px]:right-0"
        >
          {MY_JOB_STATUSES.map((s, i) => (
            <div key={s} className="contents">
              {i === 5 && <hr className="my-1 border-line" />}
              <button
                type="button"
                role="menuitemradio"
                aria-checked={s === job.status}
                onClick={() => {
                  close();
                  if (s !== job.status) onPick(s);
                }}
                className="flex items-center justify-between gap-3 rounded-[9px] px-2.5 py-2 text-left text-[0.86rem] text-ink outline-none hover:bg-surface-2 focus-visible:bg-surface-2 aria-checked:font-semibold"
              >
                <span className="inline-flex items-center gap-2">
                  {s === job.status && <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-accent" />}
                  {MY_JOB_STATUS_LABELS[s]}
                </span>
                <small className={`${mono} text-[0.64rem] text-muted`}>{s === job.status ? "now" : s === "saved" ? "" : `sets ${today()}`}</small>
              </button>
            </div>
          ))}
          <p className="px-2.5 pb-1.5 pt-1 text-[0.74rem] text-muted">Only you see this. Nothing moves on its own.</p>
        </div>
      )}
    </div>
  );
}

/**
 * "Prepare for this job" on an open row (handoff 12m): a menu of two links, Practice on the job's skills (free) and the
 * mock interview set up for it (Elite, free in the beta). Arrow keys move between them; Escape and a click outside
 * close it, with focus back on the button.
 */
function PrepareMenu({ job }: { job: MyJobView }) {
  const [open, setOpen] = useState(false);
  const ids = useId();
  const wrap = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    wrap.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    const away = (e: PointerEvent) => !wrap.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [open]);
  const keys = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      setOpen(false);
      button.current?.focus();
      return;
    }
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const items = [...(wrap.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
    const at = items.indexOf(document.activeElement as HTMLElement);
    items[(at + (e.key === "ArrowDown" ? 1 : items.length - 1)) % items.length]?.focus();
  };
  const item = "flex flex-col items-start gap-0.5 rounded-[9px] px-2.5 py-2 text-left text-[0.86rem] text-ink outline-none hover:bg-surface-2 focus-visible:bg-surface-2";
  return (
    <div ref={wrap} className="relative" onKeyDown={open ? keys : undefined}>
      <button
        ref={button}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? `${ids}-menu` : undefined}
        onClick={() => setOpen((o) => !o)}
        className={`${ghost} ${small}`}
      >
        <Play size={14} {...ICON} />
        Prepare for this job
      </button>
      {open && (
        <div
          id={`${ids}-menu`}
          role="menu"
          aria-label={`Prepare for ${job.title}`}
          className="absolute left-0 top-[calc(100%+6px)] z-20 flex min-w-[280px] flex-col rounded-[14px] border border-line bg-surface p-1.5 shadow-[0_14px_40px_-20px_var(--shadow)] min-[760px]:left-auto min-[760px]:right-0"
        >
          <Link role="menuitem" href={prepareHref(job.ref, "practice")} className={item}>
            Practice on this job&apos;s skills
            <span className="text-[0.76rem] text-muted">Still-open goals first, then what only this job asks for. Free.</span>
          </Link>
          <Link role="menuitem" href={prepareHref(job.ref, "mock")} className={item}>
            <span className="inline-flex items-center gap-1.5">
              Mock interview for this job
              <span className="rounded-full bg-elite px-1.5 py-px font-mono text-[0.6rem] font-medium uppercase tracking-[0.06em] text-on-elite">Elite</span>
            </span>
            <span className="text-[0.76rem] text-muted">Titled for {job.company}, with an AI interviewer and a timer. Free in the beta.</span>
          </Link>
        </div>
      )}
    </div>
  );
}

/**
 * The edit sheet (a native modal dialog): company, title, link and city (fixed for a feed job, which keeps the
 * posting's), status, Applied on, Closed on for a closed status, the private note, and "Read the job again" with the
 * person's own copy of an added job's description. Save, Cancel and "Delete this job".
 */
export function EditSheet({
  job,
  onClose,
  onSave,
  onDelete,
  readDescription,
}: {
  job: MyJobView;
  onClose: () => void;
  onSave: (values: EditValues) => Promise<string | null>;
  onDelete: () => Promise<string | null>;
  readDescription?: (checkId: string) => Promise<{ text: string | null } | { error: string }>;
}) {
  const ids = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const added = job.ref.kind === "check";
  const [values, setValues] = useState({
    company: job.company,
    title: job.title,
    url: job.url ?? "",
    city: job.city ?? "",
    status: job.status,
    appliedOn: dayValue(job.appliedAt),
    closedOn: dayValue(job.closedAt),
    note: job.note ?? "",
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [description, setDescription] = useState<string | null | undefined>(undefined);
  const set = (patch: Partial<typeof values>) => setValues((v) => ({ ...v, ...patch }));
  useEffect(() => {
    const d = dialog.current;
    if (d && !d.open) d.showModal();
    return () => d?.close();
  }, []);
  const run = async (call: () => Promise<string | null>) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const message = await call().catch(actionFailed);
    setBusy(false);
    if (message) setError(message);
    else onClose();
  };
  const save = () =>
    run(() =>
      onSave({
        ...(added ? { company: values.company, title: values.title, url: values.url.trim() || null, city: values.city.trim() || null } : {}),
        status: values.status,
        appliedOn: values.appliedOn || null,
        closedOn: isClosed(values.status) ? values.closedOn || null : null,
        note: values.note.trim() || null,
      }),
    );
  const loadText = async () => {
    if (description !== undefined || !readDescription || job.ref.kind !== "check") return;
    const read = await readDescription(job.ref.checkId).catch(() => ({ error: actionFailed() }));
    if ("error" in read) setError(read.error);
    else setDescription(read.text);
  };
  return (
    <dialog
      ref={dialog}
      aria-labelledby={`${ids}-h`}
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
      onClick={(e) => e.target === e.currentTarget && !busy && onClose()}
      className="m-auto max-h-[calc(100dvh-24px)] w-[calc(100%-24px)] max-w-[620px] flex-col gap-3.5 rounded-lg border border-line bg-surface p-4 text-ink shadow-[0_20px_40px_-30px_var(--shadow)] backdrop:bg-ink/30 open:flex"
    >
      <div className="flex items-start gap-3">
        <Logo name={job.company} />
        <div className="min-w-0 flex-1">
          <h2 id={`${ids}-h`} className="text-[1.15rem] font-semibold leading-[1.2] [overflow-wrap:anywhere]">
            {job.title}
          </h2>
          <small className="text-[0.8rem] text-muted [overflow-wrap:anywhere]">
            {job.company} · {job.source === "you" ? "You added" : "From a company job board"}
            {added ? "" : " · company and title come from the posting"}
          </small>
        </div>
        <button type="button" onClick={onClose} aria-label="Close" className="grid h-[34px] w-[34px] place-items-center rounded-[10px] text-muted hover:text-ink">
          <X size={18} {...ICON} />
        </button>
      </div>
      <form
        className="flex flex-col gap-3.5"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <div className="grid gap-2 min-[560px]:grid-cols-2">
          <label className={field}>
            <span className={fieldLabel}>Company</span>
            <input value={values.company} onChange={(e) => set({ company: e.target.value })} maxLength={JOB_COMPANY_MAX} disabled={!added} required className={fieldInput} />
          </label>
          <label className={field}>
            <span className={fieldLabel}>Title</span>
            <input value={values.title} onChange={(e) => set({ title: e.target.value })} maxLength={JOB_TITLE_MAX} disabled={!added} required className={fieldInput} />
          </label>
          <label className={field}>
            <span className={fieldLabel}>Link</span>
            <input type="url" value={values.url} onChange={(e) => set({ url: e.target.value })} maxLength={MY_JOB_URL_MAX} disabled={!added} className={fieldInput} />
          </label>
          <label className={field}>
            <span className={fieldLabel}>City</span>
            <input value={values.city} onChange={(e) => set({ city: e.target.value })} maxLength={MY_JOB_CITY_MAX} disabled={!added} className={fieldInput} />
          </label>
          <label className={field}>
            <span className={fieldLabel}>Status</span>
            <select value={values.status} onChange={(e) => set({ status: e.target.value as MyJobStatus })} className={`${fieldInput} bg-surface`}>
              {MY_JOB_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {MY_JOB_STATUS_LABELS[s]}
                </option>
              ))}
            </select>
          </label>
          <label className={field}>
            <span className={fieldLabel}>Applied on</span>
            <input type="date" value={values.appliedOn} onChange={(e) => set({ appliedOn: e.target.value })} className={fieldInput} />
          </label>
          {isClosed(values.status) && (
            <label className={`${field} min-[560px]:col-span-2`}>
              <span className={fieldLabel}>Closed on</span>
              <input type="date" value={values.closedOn} onChange={(e) => set({ closedOn: e.target.value })} className={fieldInput} />
            </label>
          )}
          <label className={`${field} min-[560px]:col-span-2`}>
            <span className={fieldLabel}>Private note</span>
            <textarea
              value={values.note}
              onChange={(e) => set({ note: e.target.value })}
              maxLength={MY_JOB_NOTE_MAX}
              rows={3}
              placeholder="Who you spoke to, what was discussed, what to ask next time"
              aria-describedby={`${ids}-note`}
              className={`${fieldInput} min-h-[72px] resize-y`}
            />
            <span id={`${ids}-note`} className="text-[0.76rem] text-muted">
              For you only. Don&apos;t add other people&apos;s phone numbers or emails.
            </span>
            <span className="self-end font-mono text-[0.64rem] text-muted">
              {values.note.length} / {MY_JOB_NOTE_MAX}
            </span>
          </label>
        </div>
        {added && job.hasDescription && (
          <details onToggle={(e) => e.currentTarget.open && void loadText()} className="rounded-[12px] border border-line bg-bg px-3 py-2.5">
            <summary className="flex cursor-pointer items-center gap-2 text-[0.88rem] font-[550]">
              Read the job again
              <span className={`${mono} rounded-[6px] bg-surface-2 px-[7px] py-0.5 text-[0.64rem] font-normal text-muted`}>your own copy</span>
            </summary>
            <div role="region" tabIndex={0} aria-label="The job description" className="mt-2.5 max-h-[40vh] overflow-y-auto whitespace-pre-line text-[0.86rem] leading-[1.5] [overflow-wrap:anywhere]">
              {description === undefined ? "Loading…" : (description ?? "No copy kept for this job.")}
            </div>
            <small className="mt-2 block text-[0.76rem] text-muted">
              Your own copy, kept so you can reread it before the interview, even after the posting comes down. Never shown to anyone.
            </small>
          </details>
        )}
        <p role="alert" className="text-sm text-bad empty:hidden">
          {error}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <button type="submit" className={primary} aria-disabled={busy || undefined}>
            <Check size={17} {...ICON} />
            Save
          </button>
          <button type="button" className={`${btn} text-ink hover:bg-surface-2`} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={`${btn} ml-auto text-bad hover:bg-bad-soft`} onClick={() => run(onDelete)} aria-disabled={busy || undefined}>
            Delete this job
          </button>
        </div>
      </form>
    </dialog>
  );
}

/** "Check these, then save": the job as read, before it joins My jobs. */
export type AddedJob = { checkId: string; company: string; title: string; city: string | null; source: "you" | "board"; url: string | null; fit: MyJobFit | null };

/** The example job /design and the signed-out page show after "Add and check my gaps"; nothing is sent. */
const EXAMPLE_ADDED: AddedJob = {
  checkId: "00000000-0000-4000-8000-000000000048",
  company: "Zephyr Payments",
  title: "Security operations analyst",
  city: "Mumbai",
  source: "you",
  url: null,
  fit: {
    have: 3,
    open: [
      { status: "missing", name: "SIEM" },
      { status: "weak", name: "Threat detection" },
    ],
    only: ["Phishing triage", "KQL"],
  },
};

/**
 * "Add a job you found" (handoff 12m): the description, an optional link with a hint that changes with it, and the
 * result to check before saving. `onSaved` gets the saved job; `onPost` a board link the feed already has (saved as
 * that feed job). `demo` sends nothing. With no resume it links to the upload.
 */
export function AddJobBox({
  id,
  resumeId,
  demo = false,
  save,
  onSaved,
  onPost,
}: {
  id: string;
  resumeId: string | null;
  demo?: boolean;
  save?: MyJobActions["save"];
  onSaved: (job: AddedJob, labels: { company: string; title: string; city: string | null }) => void;
  onPost: (postId: string) => void;
}) {
  const ids = useId();
  const router = useRouter();
  const [text, setText] = useState("");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [said, setSaid] = useState("");
  const [added, setAdded] = useState<AddedJob | null>(null);
  const [labels, setLabels] = useState({ company: "", title: "", city: "" });
  const kind = linkKind(url);
  const out = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (added) out.current?.querySelector<HTMLInputElement>("input")?.focus();
  }, [added]);

  const check = async () => {
    if (busy) return;
    setError(null);
    setSaid("");
    if (kind === "invalid") return setError(LINK_HINTS.invalid);
    if (!text.trim() && kind !== "board") return setError("Paste the job description. We only read links from company job boards.");
    if (demo) return show(EXAMPLE_ADDED);
    setBusy(true);
    try {
      const res = await fetch("/api/my-jobs", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ resumeId, text, url: url.trim() || null }) });
      const reply = await readApiReply(res);
      if (!reply.ok) return setError(reply.error ?? "Something went wrong. Please try again.");
      if (reply.kind === "post" && typeof reply.postId === "string") {
        reset();
        setSaid("This job is already on Departures from its company's board. Saved to My jobs.");
        return onPost(reply.postId);
      }
      show(reply.job as AddedJob);
    } catch {
      setError(actionFailed());
    } finally {
      setBusy(false);
    }
  };
  const show = (job: AddedJob) => {
    setAdded(job);
    setLabels({ company: job.company, title: job.title, city: job.city ?? "" });
    setSaid(job.source === "board" ? "Read from the company's job board and checked against your resume." : "Checked against your resume.");
  };
  const reset = () => {
    setText("");
    setUrl("");
    setAdded(null);
  };
  const keep = async (prepare = false) => {
    if (!added || busy) return;
    const checked = { company: labels.company.trim(), title: labels.title.trim(), city: labels.city.trim() || null };
    if (!checked.company || !checked.title) return setError("Add the company and the job title.");
    setError(null);
    if (!demo && save) {
      setBusy(true);
      const message = await save({ checkId: added.checkId, ...checked }).catch(actionFailed);
      setBusy(false);
      if (message) return setError(message);
    }
    reset();
    setSaid(demo ? "This is an example, so nothing was saved." : prepare ? `${checked.company} saved. Mock interview set up for it.` : `${checked.company} saved to My jobs.`);
    onSaved(added, checked);
    // "Save and prepare" opens the mock interview set up for the job just saved.
    if (prepare && !demo) router.push(prepareHref({ kind: "check", checkId: added.checkId }, "mock"));
  };

  return (
    <section id={id} aria-label="Add a job you found" className="mt-1.5 flex scroll-mt-20 flex-col gap-2.5">
      <div className="flex flex-wrap items-baseline gap-2.5">
        <h3 className="text-[1.05rem] font-semibold">Add a job you found</h3>
        <span className={`${mono} text-[0.7rem] text-muted`}>from any site · your copy</span>
      </div>
      {resumeId ? (
        <>
          <p className="text-[0.8rem] text-muted">
            Paste the description. We read the company, the title and the skills it asks for, check them against your resume, and keep the job in My jobs for you
            only.
          </p>
          <textarea
            id={`${ids}-text`}
            aria-label="Job description"
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={4}
            maxLength={JOB_TEXT_MAX}
            placeholder="Paste the job description here"
            disabled={busy}
            className="min-w-0 resize-y rounded-[12px] border border-line-strong bg-bg px-3 py-2.5 text-[0.88rem] text-ink focus:outline-2 focus:outline-offset-1 focus:outline-accent"
          />
          <label className="flex items-center gap-2 rounded-[12px] border border-line-strong bg-bg px-3 focus-within:outline-2 focus-within:outline-offset-1 focus-within:outline-accent">
            <Link2 size={15} {...ICON} className="shrink-0 text-muted" />
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              maxLength={MY_JOB_URL_MAX}
              placeholder="Link to the job (optional)"
              aria-label="Link to the job"
              aria-describedby={`${ids}-hint`}
              disabled={busy}
              className="min-w-0 flex-1 bg-transparent py-2.5 text-[0.88rem] text-ink outline-none"
            />
          </label>
          <p id={`${ids}-hint`} data-link-hint={kind} className={`flex items-start gap-1.5 text-[0.8rem] ${kind === "board" ? "text-good" : "text-muted"}`}>
            {kind === "board" ? <Check size={14} {...ICON} className="mt-0.5 shrink-0" /> : <ShieldCheck size={14} {...ICON} className="mt-0.5 shrink-0" />}
            <span>{LINK_HINTS[kind]}</span>
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" onClick={check} aria-disabled={busy || undefined} className={`${primary} ${small}`}>
              <Target size={16} {...ICON} />
              {busy && !added ? "Reading the job…" : "Add and check my gaps"}
            </button>
            <span className="text-[0.78rem] text-muted">Only you see it. Never shared, never used to find roles for anyone.</span>
          </div>
          {added && (
            <div ref={out} data-added-job className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-3.5">
              <h4 className="text-[0.98rem] font-semibold">Check these, then save</h4>
              <div className="grid gap-2 min-[760px]:grid-cols-3">
                {(
                  [
                    ["company", "Company", JOB_COMPANY_MAX, true],
                    ["title", "Title", JOB_TITLE_MAX, true],
                    ["city", "City", MY_JOB_CITY_MAX, false],
                  ] as const
                ).map(([k, label, max, ai]) => (
                  <label key={k} className={field}>
                    <span className={fieldLabel}>
                      {label}
                      {ai && <span className="normal-case tracking-normal"> · AI read it, check it</span>}
                    </span>
                    <input value={labels[k]} onChange={(e) => setLabels((l) => ({ ...l, [k]: e.target.value }))} maxLength={max} className={`${fieldInput} font-semibold`} />
                  </label>
                ))}
              </div>
              {added.fit ? (
                <div className="flex flex-col gap-2">
                  <h5 className={`${mono} text-[0.7rem] font-medium text-muted`}>{fitWords(added.fit)}</h5>
                  <FitLine fit={added.fit} />
                  <p className="text-[0.84rem] text-muted">{fitSentence(added.fit)}</p>
                </div>
              ) : (
                <p className="text-[0.84rem] text-muted">Confirm your resume&apos;s skills to see your fit for this job.</p>
              )}
              <div className="flex flex-wrap items-center gap-2.5">
                <button type="button" onClick={() => void keep()} aria-disabled={busy || undefined} className={`${primary} ${small}`}>
                  <Briefcase size={16} {...ICON} />
                  Save to My jobs
                </button>
                <button type="button" onClick={() => void keep(true)} aria-disabled={busy || undefined} className={`${ghost} ${small}`}>
                  <Play size={15} {...ICON} />
                  Save and prepare
                </button>
                <span className="text-[0.78rem] text-muted">
                  Saved as &quot;{added.source === "board" ? "Company job board" : "You added"}&quot;. The AI read the company and title; the skills check is code.
                </span>
              </div>
            </div>
          )}
          <p role="alert" className="text-sm text-bad empty:hidden">
            {error}
          </p>
          <p role="status" className="text-sm empty:hidden">
            {busy && !added ? "Reading the job. This takes up to a minute." : said}
          </p>
        </>
      ) : (
        <div className="flex flex-col gap-2.5 rounded-[18px] border border-line bg-surface p-[18px]">
          <p className="text-[0.88rem] text-muted">Upload your resume first. Then add the jobs you&apos;re applying to and see the gaps for each.</p>
          <Link href="/start" className={`${primary} ${small} self-start`}>
            Upload your resume
          </Link>
        </div>
      )}
    </section>
  );
}
