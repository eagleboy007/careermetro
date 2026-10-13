"use client";

import { ArrowLeft, ArrowRight, Lock, MapPin, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useId, useRef, useState, useTransition } from "react";
import { formatDay } from "@/lib/corporate/format";
import type { ApplicationEventView, ApplicationStage, BoardActions, BoardCardView, CandidateView, JobBoardView } from "@/lib/corporate/types";
import {
  APPLICATION_STAGE_HINTS,
  APPLICATION_STAGE_LABELS,
  APPLICATION_STAGES,
  CAN_JOIN_LABELS,
  JOB_WORK_TYPE_LABELS,
  NOT_THIS_TIME_NOTE_MAX,
} from "@/lib/schemas/constants";
import { JobStatusBadge, monoLabel } from "./job-parts";
import { actionBtn, inkBtn } from "./jobs-panel";
import { MatchDots, MatchList } from "./match-parts";
import { AntiScamLine, ICON } from "./parts";

/*
 * One job's board (dev/corporate-plan.md build step 4; C7): six lanes, the same stages candidates see on Arrivals.
 * Cards show the name, a headline, Match to this job in words and Can join; no ranking score (FR-13). Opening a card
 * shows the candidate: their public profile, Match to this job and Activity. Recruiter admins and Hiring HR on the job
 * move candidates; Not this time needs a note the candidate reads. Interviewers see only candidates assigned to them.
 * Without `actions` (the /design page) moves are off and `example` stands in for the opened candidate.
 */

type Tab = "profile" | "match" | "activity";
const TABS: { key: Tab; label: string }[] = [
  { key: "profile", label: "Profile" },
  { key: "match", label: "Match to this job" },
  { key: "activity", label: "Activity" },
];

const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? name;
const allProved = (c: BoardCardView) => c.match.requiredTotal > 0 && c.match.requiredProved === c.match.requiredTotal;

/** One line of Activity (and of Arrivals), without who did it. */
export function eventText(e: ApplicationEventView): string {
  if (e.kind === "applied") return "Applied on CareerMetro";
  if (e.kind === "withdrawn") return "Withdrew the application";
  return `Moved to ${APPLICATION_STAGE_LABELS[e.stage]}`;
}

export function JobBoard({ board, actions, example }: { board: JobBoardView; actions?: BoardActions; example?: CandidateView }) {
  const [onlyProved, setOnlyProved] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const messageRef = useRef<HTMLParagraphElement>(null);
  const returnTo = useRef<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const ids = useId();

  useEffect(() => {
    if (message) messageRef.current?.focus();
  }, [message]);

  const close = (done?: string) => {
    setOpenId(null);
    if (done) setMessage(done);
    else {
      const id = returnTo.current;
      requestAnimationFrame(() => id && rootRef.current?.querySelector<HTMLElement>(`[data-card="${CSS.escape(id)}"]`)?.focus());
    }
  };

  const cards = onlyProved ? board.cards.filter(allProved) : board.cards;
  const { job } = board;
  return (
    <div ref={rootRef} className="mx-auto flex w-full max-w-[1200px] flex-col gap-[18px]">
      <div className="flex flex-col gap-2">
        <Link href="/corporate#jobs" className="inline-flex min-h-11 items-center gap-1.5 self-start text-[0.86rem] text-muted hover:text-ink">
          <ArrowLeft {...ICON} />
          Jobs
        </Link>
        <span className={monoLabel}>Corporate · {job.company}</span>
        <div className="flex flex-wrap items-center gap-2.5">
          <h1 className="text-[clamp(1.5rem,3.2vw,2rem)] font-semibold leading-[1.1] [overflow-wrap:anywhere]">{job.title}</h1>
          <JobStatusBadge status={job.status} />
        </div>
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.86rem] text-muted">
          <span className="inline-flex items-center gap-1">
            <MapPin {...ICON} size={14} />
            {job.city}
          </span>
          <span>{JOB_WORK_TYPE_LABELS[job.workType]}</span>
          <span>L1 AI interview {job.aiRound ? "on" : "off"}</span>
        </p>
      </div>

      <AntiScamLine />

      {board.assignedOnly ? (
        <p role="note" className="rounded-md bg-surface-2 px-3.5 py-3 text-[0.9rem]">
          Interviewers see only the candidates assigned to them. Candidates show here once you are on their interview. You can&apos;t move candidates between lanes.
        </p>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <label className="inline-flex min-h-11 items-center gap-2 text-[0.88rem]">
            <input type="checkbox" checked={onlyProved} onChange={(e) => setOnlyProved(e.target.checked)} className="size-4 accent-ink" />
            All required skills proved
          </label>
          <span className="text-[0.84rem] text-muted" aria-live="polite">
            {cards.length} {cards.length === 1 ? "candidate" : "candidates"}
            {board.withdrawn > 0 && ` · ${board.withdrawn} withdrew`}
          </span>
        </div>
      )}

      {message && (
        <p ref={messageRef} tabIndex={-1} role="status" className="rounded-md bg-surface-2 px-3.5 py-2.5 text-[0.86rem] text-ink">
          {message}
        </p>
      )}

      <div className="grid grid-cols-1 gap-3 min-[700px]:grid-cols-2 min-[1100px]:grid-cols-3">
        {APPLICATION_STAGES.map((stage) => {
          const inLane = cards.filter((c) => c.stage === stage);
          const off = stage === "ai" && !job.aiRound;
          return (
            <section key={stage} aria-labelledby={`${ids}-${stage}`} className={`flex min-w-0 flex-col gap-2 rounded-lg border border-line p-3 ${stage === "not_this_time" || off ? "bg-bg" : "bg-surface"}`}>
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <h2 id={`${ids}-${stage}`} className="text-[0.98rem] font-semibold">
                    {APPLICATION_STAGE_LABELS[stage]}
                  </h2>
                  <p className="text-[0.78rem] text-muted">{APPLICATION_STAGE_HINTS[stage]}</p>
                </div>
                <span className="rounded-full bg-surface-2 px-2 py-0.5 font-mono text-[0.76rem]">{inLane.length}</span>
              </div>
              {inLane.length === 0 ? (
                <p className="px-1 py-2 text-[0.82rem] text-muted">No one here.</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {inLane.map((c) => (
                    <li key={c.applicationId}>
                      <button
                        type="button"
                        data-card={c.applicationId}
                        onClick={() => {
                          returnTo.current = c.applicationId;
                          setMessage(null);
                          setOpenId(c.applicationId);
                        }}
                        className="flex min-h-11 w-full flex-col gap-1.5 rounded-md border border-line bg-surface p-3 text-left hover:bg-surface-2"
                      >
                        <span className="flex items-center gap-2.5">
                          <span aria-hidden="true" className="grid size-8 shrink-0 place-items-center rounded-full bg-surface-2 text-[0.78rem] font-semibold">
                            {c.name
                              .split(/\s+/)
                              .map((w) => w[0])
                              .join("")
                              .slice(0, 2)
                              .toUpperCase()}
                          </span>
                          <span className="min-w-0">
                            <b className="block text-[0.9rem] font-semibold [overflow-wrap:anywhere]">{c.name}</b>
                            {c.headline && <small className="block text-[0.78rem] text-muted [overflow-wrap:anywhere]">{c.headline}</small>}
                          </span>
                        </span>
                        <MatchDots match={c.match} />
                        <span className="flex flex-wrap justify-between gap-x-3 text-[0.76rem] text-muted">
                          <span>Can join: {CAN_JOIN_LABELS[c.canJoin]}</span>
                          <span>Applied {formatDay(c.appliedOn)}</span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          );
        })}
      </div>

      {openId && (
        <CandidateDrawer
          key={openId}
          applicationId={openId}
          card={board.cards.find((c) => c.applicationId === openId) ?? null}
          aiRound={job.aiRound}
          canMove={board.canMove}
          actions={actions}
          example={example}
          onClose={close}
        />
      )}
    </div>
  );
}

function CandidateDrawer({
  applicationId,
  card,
  aiRound,
  canMove,
  actions,
  example,
  onClose,
}: {
  applicationId: string;
  card: BoardCardView | null;
  aiRound: boolean;
  canMove: boolean;
  actions?: BoardActions;
  example?: CandidateView;
  onClose: (done?: string) => void;
}) {
  const [candidate, setCandidate] = useState<CandidateView | null>(actions ? null : (example ? { ...example, applicationId, stage: card?.stage ?? example.stage } : null));
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("profile");
  const [closing, setClosing] = useState(false);
  const [note, setNote] = useState("");
  const [pending, start] = useTransition();
  const ids = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const tabRefs = useRef<Partial<Record<Tab, HTMLButtonElement | null>>>({});
  const noteRef = useRef<HTMLTextAreaElement>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    // A native modal dialog: the page behind it is inert, so focus can't leave it.
    const d = dialogRef.current;
    if (d && !d.open) d.showModal();
    d?.querySelector<HTMLElement>("[data-close]")?.focus();
    if (!actions) return;
    let live = true;
    actions.open(applicationId).then((r) => {
      if (!live) return;
      if (r.ok) setCandidate(r.candidate);
      else setError(r.error);
    });
    return () => {
      live = false;
    };
  }, [actions, applicationId]);
  useEffect(() => {
    if (closing) noteRef.current?.focus();
  }, [closing]);
  useEffect(() => {
    if (error && candidate) errorRef.current?.focus();
  }, [error, candidate]);

  /** Closes the dialog first, so focus can go back to the card or on to the message. */
  const close = (done?: string) => {
    dialogRef.current?.close();
    onClose(done);
  };
  /** Escape and the backdrop: never while a Not this time note is half written. */
  const dismiss = () => {
    if (closing && note.trim()) {
      setError("Send the note or press Cancel first, so it isn't lost.");
      return;
    }
    close();
  };
  const onTabKey = (e: React.KeyboardEvent, current: Tab) => {
    const i = TABS.findIndex((t) => t.key === current);
    const next = ({ ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: TABS.length - 1 } as Record<string, number>)[e.key];
    if (next === undefined) return;
    e.preventDefault();
    const key = TABS[(next + TABS.length) % TABS.length].key;
    setTab(key);
    tabRefs.current[key]?.focus();
  };

  const name = candidate?.profile.name ?? card?.name ?? "Candidate";
  const stage = candidate?.stage ?? card?.stage ?? "applied";
  const targets = APPLICATION_STAGES.filter((s) => s !== stage && s !== "not_this_time");
  const [moveTo, setMoveTo] = useState<ApplicationStage>(targets.find((s) => APPLICATION_STAGES.indexOf(s) > APPLICATION_STAGES.indexOf(stage) && (s !== "ai" || aiRound)) ?? "applied");

  const move = (to: ApplicationStage, text = "") =>
    start(async () => {
      if (!actions) {
        setError("Example board. Nothing moves here.");
        return;
      }
      setError(null);
      const problem = await actions.move(applicationId, to, text);
      if (problem) setError(problem);
      else close(to === "not_this_time" ? `${name}: Not this time, with your note. ${firstName(name)} sees it on Arrivals.` : `Moved ${name} to ${APPLICATION_STAGE_LABELS[to]}. ${firstName(name)} sees it on Arrivals.`);
    });

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={`${ids}-name`}
      onCancel={(e) => {
        e.preventDefault();
        dismiss();
      }}
      onClick={(e) => e.target === e.currentTarget && dismiss()}
      className="my-0 mr-0 ml-auto h-dvh max-h-none w-full max-w-[560px] flex-col border-0 border-l border-line bg-surface p-0 text-ink shadow-[0_20px_40px_-30px_var(--shadow)] backdrop:bg-ink/30 open:flex"
    >
        <div className="flex items-start gap-3 border-b border-line p-4">
          <div className="min-w-0 flex-1">
            <h2 id={`${ids}-name`} className="text-[1.25rem] font-semibold leading-[1.2] [overflow-wrap:anywhere]">
              {name}
            </h2>
            {(candidate?.profile.headline ?? card?.headline) && <p className="text-[0.86rem] text-muted">{candidate?.profile.headline ?? card?.headline}</p>}
            <p className="mt-1.5 flex flex-wrap gap-1.5 text-[0.78rem]">
              <span className="rounded-full bg-surface-2 px-2.5 py-0.5 font-medium">{APPLICATION_STAGE_LABELS[stage]}</span>
              {card && <span className="rounded-full border border-line px-2.5 py-0.5">Can join: {CAN_JOIN_LABELS[card.canJoin]}</span>}
            </p>
          </div>
          <button type="button" data-close aria-label="Close" className={`${actionBtn} w-11 px-0`} onClick={() => close()}>
            <X {...ICON} />
          </button>
        </div>
        <div role="tablist" aria-label="About this candidate" className="flex gap-1 overflow-x-auto border-b border-line px-2">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              ref={(el) => {
                tabRefs.current[t.key] = el;
              }}
              id={`${ids}-tab-${t.key}`}
              aria-selected={tab === t.key}
              aria-controls={`${ids}-panel`}
              tabIndex={tab === t.key ? 0 : -1}
              onClick={() => setTab(t.key)}
              onKeyDown={(e) => onTabKey(e, t.key)}
              className={`min-h-11 whitespace-nowrap border-b-2 px-3 text-[0.86rem] ${tab === t.key ? "border-ink font-semibold text-ink" : "border-transparent text-muted hover:text-ink"}`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div id={`${ids}-panel`} role="tabpanel" tabIndex={0} aria-labelledby={`${ids}-tab-${tab}`} className="flex-1 overflow-y-auto p-4">
          {!candidate ? (
            error ? (
              <p role="alert" className="text-[0.9rem]">
                {error}
              </p>
            ) : (
              <p className="text-[0.9rem] text-muted">Loading…</p>
            )
          ) : tab === "profile" ? (
            <ProfileTab candidate={candidate} />
          ) : tab === "match" ? (
            <MatchList match={candidate.match} />
          ) : (
            <ol className="flex flex-col gap-3">
              {candidate.events.map((e, i) => (
                <li key={i} className="flex flex-col gap-1 border-l-2 border-line pl-3">
                  <span className="text-[0.88rem]">{eventText(e)}</span>
                  <span className="font-mono text-[0.72rem] text-muted">{formatDay(e.on)}</span>
                  {e.note && <span className="rounded-md bg-surface-2 px-3 py-2 text-[0.84rem]">Note to the candidate: {e.note}</span>}
                </li>
              ))}
            </ol>
          )}
        </div>
        <div className="flex flex-col gap-2.5 border-t border-line p-4">
          {candidate && error && (
            <p ref={errorRef} tabIndex={-1} role="alert" className="text-[0.86rem] font-medium">
              {error}
            </p>
          )}
          {!canMove ? (
            <p className="text-[0.84rem] text-muted">Interviewers can&apos;t change stages.</p>
          ) : closing ? (
            <form
              className="flex flex-col gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (note.trim().length < 10) {
                  setError("Add a short note the candidate will see, with what would help next time.");
                  return;
                }
                move("not_this_time", note);
              }}
            >
              <label className="flex flex-col gap-1.5 text-[0.84rem] font-semibold">
                Note for {firstName(name)}
                <span className="text-[0.78rem] font-normal text-muted">They read it on Arrivals. Say what would help next time; stick to the job&apos;s skills.</span>
                <textarea
                  ref={noteRef}
                  rows={3}
                  maxLength={NOT_THIS_TIME_NOTE_MAX}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  className="rounded-sm border border-line bg-bg px-3 py-2 text-[0.88rem] font-normal text-ink"
                />
              </label>
              <div className="flex flex-wrap gap-2">
                <button type="submit" className={inkBtn} disabled={pending}>
                  Send Not this time
                </button>
                <button type="button" className={actionBtn} onClick={() => setClosing(false)}>
                  Cancel
                </button>
              </div>
            </form>
          ) : (
            <div className="flex flex-wrap items-end gap-2">
              <label className="flex min-w-0 flex-col gap-1 text-[0.8rem] font-semibold">
                {stage === "not_this_time" ? "Open again in" : "Move to"}
                <select
                  value={moveTo}
                  onChange={(e) => setMoveTo(e.target.value as ApplicationStage)}
                  className="min-h-11 rounded-sm border border-line bg-surface px-3 text-[0.88rem] font-normal text-ink"
                >
                  {targets.map((s) => (
                    <option key={s} value={s} disabled={s === "ai" && !aiRound}>
                      {APPLICATION_STAGE_LABELS[s]}
                      {s === "ai" && !aiRound ? " (off for this job)" : ""}
                    </option>
                  ))}
                </select>
              </label>
              <button type="button" className={inkBtn} disabled={pending || !candidate} onClick={() => move(moveTo)}>
                <ArrowRight {...ICON} />
                Move
              </button>
              {stage !== "not_this_time" && (
                <button
                  type="button"
                  className={actionBtn}
                  disabled={!candidate}
                  onClick={() => {
                    setError(null);
                    setClosing(true);
                  }}
                >
                  Not this time
                </button>
              )}
            </div>
          )}
        </div>
    </dialog>
  );
}

function ProfileTab({ candidate }: { candidate: CandidateView }) {
  const { profile } = candidate;
  return (
    <div className="flex flex-col gap-4">
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[0.86rem]">
        <dt className="text-muted">Applied</dt>
        <dd>{formatDay(candidate.appliedOn)}</dd>
        <dt className="text-muted">Can join</dt>
        <dd>{CAN_JOIN_LABELS[candidate.canJoin]}</dd>
        <dt className="text-muted">Contact</dt>
        <dd className="text-muted">Shared only if they choose to, after accepting an interview</dd>
      </dl>
      <section className="flex flex-col gap-1.5">
        <h3 className={monoLabel}>Experience</h3>
        {profile.experience.length ? (
          <ul className="flex flex-col gap-2">
            {profile.experience.map((x, i) => (
              <li key={i} className="flex flex-col">
                <b className="text-[0.88rem] font-semibold [overflow-wrap:anywhere]">
                  {x.title} · {x.employer}
                </b>
                <span className="font-mono text-[0.74rem] text-muted">{x.dates}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[0.86rem] text-muted">No work experience listed.</p>
        )}
      </section>
      <section className="flex flex-col gap-1.5">
        <h3 className={monoLabel}>Education</h3>
        {profile.education.length ? (
          <ul className="flex flex-col gap-1 text-[0.86rem]">
            {profile.education.map((e, i) => (
              <li key={i} className="[overflow-wrap:anywhere]">
                {e.qualification}, {e.institution}
                {e.year && ` (${e.year})`}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[0.86rem] text-muted">None listed.</p>
        )}
      </section>
      <section className="flex flex-col gap-1.5">
        <h3 className={monoLabel}>Certifications on the resume</h3>
        {profile.certifications.length ? (
          <ul className="flex flex-col gap-1 text-[0.86rem]">
            {profile.certifications.map((c) => (
              <li key={c} className="[overflow-wrap:anywhere]">
                {c}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[0.86rem] text-muted">None listed.</p>
        )}
      </section>
      <p className="flex items-start gap-2 rounded-md bg-surface-2 px-3.5 py-2.5 text-[0.8rem] text-muted">
        <Lock {...ICON} className="mt-0.5 shrink-0" />
        <span>
          Never shown to companies: email, phone number, pay, notice period (only Can join), resume lines, their goals and path, streak, other applications, and anything
          they keep private. Every time you open a candidate it is logged.
        </span>
      </p>
    </div>
  );
}
