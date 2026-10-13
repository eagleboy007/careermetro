"use client";

import { ArrowLeft, ChevronLeft, ChevronRight, MessageSquare, Search, Send, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useId, useRef, useState, useTransition } from "react";
import type { FindActions, FindPeopleResults, FindPeopleView, FindPersonCard, FoundPersonView, FoundRequestState } from "@/lib/corporate/find-types";
import { formatDay } from "@/lib/corporate/format";
import type { FindBand } from "@/lib/schemas";
import { FIND_BAND_LABELS, FIND_BANDS } from "@/lib/schemas/constants";
import { monoLabel } from "./job-parts";
import { actionBtn, inkBtn } from "./jobs-panel";
import { MatchDots, MatchList } from "./match-parts";
import { ICON, inputClass, labelClass } from "./parts";

const firstName = (name: string) => name.split(" ")[0];

const REFUSALS: Record<NonNullable<FindPeopleView["refusal"]>, { title: string; text: string }> = {
  interviewer: { title: "Interviewers can't search for people", text: "Recruiter admins and Hiring HR find people from the company's open jobs. You see the candidates on the interviews you are on." },
  not_verified: { title: "Only verified companies can search", text: "Once we have verified your company, Recruiter admins and Hiring HR can find people from your open jobs." },
  unavailable: { title: "Find people isn't available right now", text: "Please try again later." },
};

const SENT_STATE: Record<FindPeopleView["sent"][number]["state"], string> = { waiting: "Waiting to accept", open: "Accepted", closed: "Closed" };

/** The address of one search, with only the job, band and page: nothing personal is ever in it. */
function searchHref(search: { jobId: string; band: string | null }, page: number) {
  const q = new URLSearchParams({ job: search.jobId });
  if (search.band) q.set("band", search.band);
  if (page > 1) q.set("page", String(page));
  return `/corporate/people?${q}`;
}

/**
 * Corporate > Find people (pending item 19, dev/companies-find-me-plan.md): Recruiter admins, and Hiring HR on the job,
 * search from one of the company's open jobs for people who turned on "Let companies find me", ranked by Match to the
 * job, proven skills first. Opening a person shows their public profile parts and Match, and lets the company send one
 * message request, which the person accepts or deletes in their Inbox. Without `actions` (preview, /design) nothing is
 * sent and the drawer shows `example`. A search runs only when Search (or a page button) is pressed, through
 * `actions.search`; the address then holds the job, band and page, and opening that address fills in the form without
 * searching (Testing T41).
 */
export function FindPeople({ view, actions, example, startOpen }: { view: FindPeopleView; actions?: FindActions; example?: FoundPersonView; startOpen?: string }) {
  const [openRef, setOpenRef] = useState<string | null>(startOpen ?? null);
  const [message, setMessage] = useState<string | null>(null);
  const [search, setSearch] = useState(view.search);
  const [results, setResults] = useState<FindPeopleResults | null>(view.results);
  const [error, setError] = useState<string | null>(view.error);
  const [searching, startSearch] = useTransition();
  const messageRef = useRef<HTMLParagraphElement>(null);
  const resultsRef = useRef<HTMLHeadingElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const ids = useId();

  useEffect(() => {
    if (message) messageRef.current?.focus();
  }, [message]);

  const close = (ref: string, done?: string) => {
    setOpenRef(null);
    if (done) setMessage(done);
    // Back to the card that opened it, never to the page.
    else requestAnimationFrame(() => rootRef.current?.querySelector<HTMLElement>(`[data-card="${CSS.escape(ref)}"]`)?.focus());
  };

  /** One search, on an explicit press only: never when the page opens. */
  const run = (next: { jobId: string; band: FindBand | null; page: number }) =>
    startSearch(async () => {
      if (!actions) return;
      setMessage(null);
      const r = await actions.search(next.jobId, next.band, next.page);
      setSearch(next);
      if (!r.ok) {
        setError(r.error);
        setResults(null);
        return;
      }
      setError(null);
      setResults(r.results);
      // The address keeps the job, band and page (nothing typed or personal), without loading the page again.
      window.history.replaceState(null, "", searchHref(next, next.page));
      requestAnimationFrame(() => resultsRef.current?.focus());
    });

  /** A request sent from the drawer: its card says so at once, without searching again. */
  const markSent = (ref: string) =>
    setResults((r) => (r ? { ...r, cards: r.cards.map((c) => (c.ref === ref && c.request.state === "none" ? { ...c, request: { state: "waiting", conversationId: "" } } : c)) } : r));

  const cards = results?.cards ?? [];
  const openCard = cards.find((c) => c.ref === openRef);
  const refusal = view.refusal ? REFUSALS[view.refusal] : null;

  return (
    <div ref={rootRef} className="mx-auto flex w-full max-w-[960px] flex-col gap-[18px]">
      <div className="flex flex-col gap-2">
        <Link href="/corporate" className="inline-flex min-h-11 items-center gap-1.5 self-start text-[0.86rem] text-muted hover:text-ink">
          <ArrowLeft {...ICON} />
          Corporate
        </Link>
        <span className={monoLabel}>Corporate · {view.company}</span>
        <h1 className="text-[clamp(1.5rem,3.2vw,2rem)] font-semibold leading-[1.1]">Find people</h1>
        <p className="max-w-[640px] text-[0.9rem] text-muted">
          People who chose to let companies find them, matched to one of your open jobs by the skills it asks for, proven skills first. You see what their profile
          shows, never their email, phone, pay or resume. They decide whether to accept your message.
        </p>
      </div>

      {message && (
        <p ref={messageRef} tabIndex={-1} role="status" className="rounded-md bg-surface-2 px-3.5 py-2.5 text-[0.86rem] outline-none">
          {message}
        </p>
      )}

      {refusal ? (
        <section className="flex flex-col gap-1.5 rounded-lg border border-line bg-surface p-4">
          <h2 className="text-[1.05rem] font-semibold">{refusal.title}</h2>
          <p className="text-[0.88rem] text-muted">{refusal.text}</p>
        </section>
      ) : !view.jobs.length ? (
        <section className="flex flex-col gap-1.5 rounded-lg border border-line bg-surface p-4">
          <h2 className="text-[1.05rem] font-semibold">No open jobs to search from</h2>
          <p className="text-[0.88rem] text-muted">
            {view.role === "admin" ? "Open a job first: you find people by matching them to its requirements." : "You find people from the open jobs you are on as Hiring HR."}
          </p>
          <Link href="/corporate#jobs" className={`${actionBtn} self-start`}>
            Jobs
          </Link>
        </section>
      ) : (
        <>
          <form
            className="flex flex-wrap items-end gap-3 rounded-lg border border-line bg-surface p-4"
            aria-label="Search"
            onSubmit={(e) => {
              e.preventDefault();
              const data = new FormData(e.currentTarget);
              const band = String(data.get("band") ?? "");
              run({ jobId: String(data.get("job") ?? ""), band: (FIND_BANDS as readonly string[]).includes(band) ? (band as FindBand) : null, page: 1 });
            }}
          >
            <label className={`${labelClass} min-w-0 flex-[2_1_220px]`}>
              Match to this job
              <select name="job" defaultValue={search?.jobId ?? view.jobs[0].id} className={`${inputClass} min-h-11 w-full`}>
                {view.jobs.map((j) => (
                  <option key={j.id} value={j.id}>
                    {j.title} · {j.city}
                  </option>
                ))}
              </select>
            </label>
            <label className={`${labelClass} min-w-0 flex-[1_1_160px]`}>
              Experience
              <select name="band" defaultValue={search?.band ?? ""} className={`${inputClass} min-h-11 w-full`}>
                <option value="">Any</option>
                {FIND_BANDS.map((b) => (
                  <option key={b} value={b}>
                    {FIND_BAND_LABELS[b]}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit" className={inkBtn} disabled={searching}>
              <Search {...ICON} />
              Search
            </button>
          </form>

          {error && (
            <p role="alert" className="rounded-md bg-surface-2 px-3.5 py-2.5 text-[0.86rem]">
              {error}
            </p>
          )}

          {search && results && (
            <section aria-labelledby={`${ids}-results`} className="flex flex-col gap-3">
              <h2 ref={resultsRef} tabIndex={-1} id={`${ids}-results`} className="text-[1.05rem] font-semibold outline-none">
                {results.total === 0 ? "No one matches yet" : results.total === 1 ? "1 person matches" : `${results.total} people match`}
              </h2>
              {results.total === 0 ? (
                <p className="text-[0.88rem] text-muted">
                  Only people who turned on &ldquo;Let companies find me&rdquo; and have at least one of the job&apos;s required skills show here. Try another job or any experience.
                </p>
              ) : (
                <ul className="flex flex-col gap-2.5">
                  {cards.map((c) => (
                    <PersonCard key={c.ref} card={c} onOpen={() => setOpenRef(c.ref)} />
                  ))}
                </ul>
              )}
              {(search.page > 1 || results.hasMore) && (
                <nav aria-label="Pages" className="flex flex-wrap items-center gap-2">
                  {search.page > 1 && (
                    <button type="button" className={actionBtn} disabled={searching} onClick={() => run({ ...search, page: search.page - 1 })}>
                      <ChevronLeft {...ICON} />
                      Previous
                    </button>
                  )}
                  <span className="text-[0.84rem] text-muted">Page {search.page}</span>
                  {results.hasMore && (
                    <button type="button" className={actionBtn} disabled={searching} onClick={() => run({ ...search, page: search.page + 1 })}>
                      Next
                      <ChevronRight {...ICON} />
                    </button>
                  )}
                </nav>
              )}
            </section>
          )}
        </>
      )}

      {view.sent.length > 0 && (
        <section aria-labelledby={`${ids}-sent`} className="flex flex-col gap-2.5">
          <h2 id={`${ids}-sent`} className="text-[1.05rem] font-semibold">
            Message requests you sent
          </h2>
          <ul className="flex flex-col divide-y divide-line overflow-hidden rounded-[14px] border border-line bg-surface">
            {view.sent.map((s) => (
              <li key={s.conversationId} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3.5 py-2.5">
                <span className="min-w-0 flex-1">
                  <b className="block text-[0.9rem] font-semibold [overflow-wrap:anywhere]">{s.name}</b>
                  <small className="block text-[0.78rem] text-muted">
                    {s.job ?? "A job that has closed"} · sent {formatDay(s.sentOn)}
                  </small>
                </span>
                {s.state === "open" ? (
                  <Link href={`/corporate/messages?found=${s.conversationId}`} className={actionBtn}>
                    <MessageSquare {...ICON} />
                    Open chat<span className="sr-only"> with {s.name}</span>
                  </Link>
                ) : (
                  <span className="rounded-full bg-surface-2 px-2.5 py-0.5 text-[0.78rem] font-medium">{SENT_STATE[s.state]}</span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {openRef && search && (
        <PersonDrawer
          key={openRef}
          jobId={search.jobId}
          personRef={openRef}
          card={openCard}
          actions={actions}
          example={example}
          onClose={(done) => {
            if (done) markSent(openRef);
            close(openRef, done);
          }}
        />
      )}
    </div>
  );
}

function RequestChip({ request }: { request: FoundRequestState }) {
  if (request.state === "none") return null;
  const text = request.state === "waiting" ? "Request sent" : request.state === "open" ? "Accepted" : "Closed";
  return <span className="rounded-full bg-surface-2 px-2.5 py-0.5 text-[0.76rem] font-medium">{text}</span>;
}

function PersonCard({ card, onOpen }: { card: FindPersonCard; onOpen: () => void }) {
  return (
    <li className="flex flex-col gap-2 rounded-lg border border-line bg-surface p-3.5">
      <div className="flex flex-wrap items-start gap-x-3 gap-y-1">
        <span className="min-w-0 flex-1">
          <b className="block text-[0.95rem] font-semibold [overflow-wrap:anywhere]">{card.name}</b>
          {card.headline && <span className="block text-[0.84rem] text-muted [overflow-wrap:anywhere]">{card.headline}</span>}
        </span>
        <RequestChip request={card.request} />
      </div>
      <MatchDots match={card.match} />
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="flex-1 text-[0.8rem] text-muted">{card.experience ? `${card.experience} of experience` : "Experience not shown"}</span>
        <button type="button" data-card={card.ref} onClick={onOpen} className={actionBtn}>
          View profile<span className="sr-only"> of {card.name}</span>
        </button>
      </div>
    </li>
  );
}

function PersonDrawer({
  jobId,
  personRef,
  card,
  actions,
  example,
  onClose,
}: {
  jobId: string;
  personRef: string;
  card?: FindPersonCard;
  actions?: FindActions;
  example?: FoundPersonView;
  onClose: (done?: string) => void;
}) {
  const [person, setPerson] = useState<FoundPersonView | null>(actions ? null : (example ?? null));
  const [error, setError] = useState<string | null>(null);
  const [body, setBody] = useState("");
  const [pending, start] = useTransition();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);
  const ids = useId();

  useEffect(() => {
    // A native modal dialog: the page behind it is inert, so focus can't leave it.
    const d = dialogRef.current;
    if (d && !d.open) d.showModal();
    d?.querySelector<HTMLElement>("[data-close]")?.focus();
    if (!actions) return;
    let live = true;
    actions.open(jobId, personRef).then((r) => {
      if (!live) return;
      if (r.ok) setPerson(r.person);
      else setError(r.error);
    });
    return () => {
      live = false;
    };
  }, [actions, jobId, personRef]);
  useEffect(() => {
    // Leaving the page with the drawer open must not leave a modal dialog in the top layer.
    const d = dialogRef.current;
    return () => d?.close();
  }, []);
  useEffect(() => {
    if (error && person) errorRef.current?.focus();
  }, [error, person]);

  const close = (done?: string) => {
    dialogRef.current?.close();
    onClose(done);
  };

  const name = person?.profile.name ?? card?.name ?? "Person";
  const request = person?.request ?? card?.request ?? { state: "none" as const };

  const send = () =>
    start(async () => {
      if (!actions) {
        setError("Example data. Nothing is sent here.");
        return;
      }
      setError(null);
      const problem = await actions.request(jobId, personRef, body);
      if (problem) setError(problem);
      else close(`Message request sent to ${name}. ${firstName(name)} sees it in their Inbox and can accept or delete it. You can't send more until they accept.`);
    });

  const p = person?.profile;
  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={`${ids}-name`}
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      onClick={(e) => e.target === e.currentTarget && close()}
      className="my-0 mr-0 ml-auto h-dvh max-h-none w-full max-w-[560px] flex-col border-0 border-l border-line bg-surface p-0 text-ink shadow-[0_20px_40px_-30px_var(--shadow)] backdrop:bg-ink/30 open:flex"
    >
      <div className="flex items-start gap-3 border-b border-line p-4">
        <div className="min-w-0 flex-1">
          <h2 id={`${ids}-name`} className="text-[1.25rem] font-semibold leading-[1.2] [overflow-wrap:anywhere]">
            {name}
          </h2>
          {(p?.headline ?? card?.headline) && <p className="text-[0.86rem] text-muted [overflow-wrap:anywhere]">{p?.headline ?? card?.headline}</p>}
          <p className="mt-1 text-[0.78rem] text-muted">Found from {person?.job ?? "your job"}</p>
        </div>
        <button type="button" data-close aria-label="Close" className={`${actionBtn} w-11 px-0`} onClick={() => close()}>
          <X {...ICON} />
        </button>
      </div>
      <div role="region" aria-label={`About ${name}`} tabIndex={0} className="flex flex-1 flex-col gap-5 overflow-y-auto p-4">
        {!person ? (
          error ? (
            <p role="alert" className="text-[0.9rem]">
              {error}
            </p>
          ) : (
            <p className="text-[0.9rem] text-muted">Loading…</p>
          )
        ) : (
          <>
            <section className="flex flex-col gap-2">
              <h3 className={monoLabel}>Match to {person.job}</h3>
              <MatchList match={person.match} />
            </section>
            {p && (
              <section className="flex flex-col gap-3">
                <h3 className={monoLabel}>On their profile</h3>
                {p.aim && (
                  <p className="text-[0.86rem]">
                    <span className="text-muted">Aiming for </span>
                    {p.aim}
                  </p>
                )}
                {p.experience.length > 0 && (
                  <div className="flex flex-col gap-1.5">
                    <h4 className="text-[0.84rem] font-semibold">Experience{p.experienceTotal ? ` · ${p.experienceTotal}` : ""}</h4>
                    <ul className="flex flex-col gap-2">
                      {p.experience.map((x) => (
                        <li key={x.id} className="flex flex-col">
                          <b className="text-[0.88rem] font-semibold [overflow-wrap:anywhere]">
                            {x.title} · {x.employer}
                          </b>
                          <span className="font-mono text-[0.74rem] text-muted">{x.dates}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {p.education.length > 0 && (
                  <div className="flex flex-col gap-1.5">
                    <h4 className="text-[0.84rem] font-semibold">Education</h4>
                    <ul className="flex flex-col gap-1 text-[0.86rem]">
                      {p.education.map((e, i) => (
                        <li key={i} className="[overflow-wrap:anywhere]">
                          {e.qualification}, {e.institution}
                          {e.year && ` (${e.year})`}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {p.skills.have.length > 0 && (
                  <div className="flex flex-col gap-1.5">
                    <h4 className="text-[0.84rem] font-semibold">Skills</h4>
                    <ul className="flex flex-wrap gap-1.5">
                      {p.skills.have.map((s) => (
                        <li key={s} className="rounded-full border border-line px-2.5 py-0.5 text-[0.8rem]">
                          {s}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {p.certifications.length > 0 && (
                  <div className="flex flex-col gap-1.5">
                    <h4 className="text-[0.84rem] font-semibold">Certifications</h4>
                    <ul className="flex flex-col gap-1 text-[0.86rem]">
                      {p.certifications.map((c) => (
                        <li key={c.name} className="[overflow-wrap:anywhere]">
                          {c.name}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {!p.aim && !p.experience.length && !p.education.length && !p.skills.have.length && !p.certifications.length && (
                  <p className="text-[0.86rem] text-muted">{firstName(name)} shows only their name and headline.</p>
                )}
              </section>
            )}
          </>
        )}
      </div>
      <div className="flex flex-col gap-2.5 border-t border-line p-4">
        {person && error && (
          <p ref={errorRef} tabIndex={-1} role="alert" className="text-[0.86rem] font-medium outline-none">
            {error}
          </p>
        )}
        {request.state === "none" ? (
          person && (
            <>
              <label htmlFor={`${ids}-body`} className="text-[0.84rem] font-semibold">
                Message request to {firstName(name)}
              </label>
              <textarea
                id={`${ids}-body`}
                value={body}
                onChange={(e) => setBody(e.target.value)}
                maxLength={2000}
                rows={3}
                aria-describedby={`${ids}-hint`}
                className={`${inputClass} w-full`}
              />
              <small id={`${ids}-hint`} className="text-[0.78rem] text-muted">
                One message. {firstName(name)} accepts or deletes it in their Inbox; you can&apos;t send more until they accept. Never ask for money, an OTP or bank details.
              </small>
              <button type="button" className={`${inkBtn} self-start`} disabled={pending || !body.trim()} onClick={send}>
                <Send {...ICON} />
                Send message request
              </button>
            </>
          )
        ) : request.state === "open" ? (
          <Link href={`/corporate/messages?found=${request.conversationId}`} onClick={() => close()} className={`${actionBtn} self-start`}>
            <MessageSquare {...ICON} />
            Message {firstName(name)}
          </Link>
        ) : (
          <p className="text-[0.86rem] text-muted">
            {request.state === "waiting" ? `Your message request is waiting for ${firstName(name)} to accept.` : "This chat is closed."}
          </p>
        )}
      </div>
    </dialog>
  );
}
