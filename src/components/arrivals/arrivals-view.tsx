"use client";

import { MapPin, Route, Undo2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { goalLinkText, type GoalLink } from "@/lib/arrivals/goal-link";
import { arrivalsGroups, waitingLine } from "@/lib/arrivals/groups";
import { actionBtn } from "@/components/corporate/jobs-panel";
import { ICON } from "@/components/corporate/parts";
import { formatDay } from "@/lib/corporate/format";
import { canWithdraw, withdrawConfirmText } from "@/lib/corporate/rules";
import type { ArrivalsActions, MyApplicationView, WithdrawAction } from "@/lib/corporate/types";
import { APPLICATION_STAGE_LABELS, CAN_JOIN_LABELS } from "@/lib/schemas/constants";
import { ApplicationInterviews, NextUp } from "./interviews";
import { NO_CONNECTION } from "@/lib/api-reply";

/*
 * Arrivals (handoff section 9; dev/corporate-plan.md build step 4): the person's applications on CareerMetro, each with
 * every step the company took. Moving forward is progress, so those stages wear cobalt. Not this time keeps the
 * company's note. Who at the company moved it is never shown. Interviews (step 6) add Next up, the 10-day strip and
 * Accept or Decline on each application; `today` is the India date from the server. Without `withdraw` and `actions`
 * (the /design page and the example) nothing changes. `goalLinks` holds, for a closed application, the goal on the
 * person's line its job asked for (src/lib/arrivals/goal-link.ts). `invitationsOnly` is the paused view (job search
 * off), which lists only live invitations, so it has no Offers place and no waiting count.
 */

const MOVING = new Set(["shortlisted", "ai", "team", "offer"]);

export function ArrivalsView({
  applications,
  today,
  withdraw,
  actions,
  note,
  goalLinks = {},
  invitationsOnly = false,
}: {
  applications: MyApplicationView[];
  today: string;
  withdraw?: WithdrawAction;
  actions?: Omit<ArrivalsActions, "withdraw">;
  note?: React.ReactNode;
  goalLinks?: Record<string, GoalLink>;
  invitationsOnly?: boolean;
}) {
  const [message, setMessage] = useState<{ error: boolean; text: string } | null>(null);
  const messageRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (message) messageRef.current?.focus();
  }, [message]);

  const groups = arrivalsGroups(applications, { showEmptyOffers: !invitationsOnly });
  const waiting = invitationsOnly ? null : waitingLine(applications);

  return (
    <div className="mx-auto flex w-full max-w-[920px] flex-col gap-[18px]">
      <div>
        <span className="font-mono text-[0.72rem] uppercase tracking-[0.06em] text-muted">Arrivals</span>
        <h1 className="mt-1 text-[clamp(1.6rem,3.5vw,2.2rem)] font-semibold leading-[1.1]">Your applications</h1>
        <p className="mt-1.5 max-w-[620px] text-[0.95rem] text-muted">Jobs you applied to on CareerMetro, and every step each company took. Companies never see your goals, path or other applications.</p>
        {waiting && <p className="mt-1.5 font-mono text-[0.72rem] uppercase tracking-[0.06em] text-muted">{waiting}</p>}
      </div>
      {note}
      {message && (
        <p ref={messageRef} tabIndex={-1} role={message.error ? "alert" : "status"} className="rounded-md bg-surface-2 px-3.5 py-2.5 text-[0.86rem]">
          {message.text}
        </p>
      )}
      <NextUp applications={applications} today={today} />
      {applications.length === 0 ? (
        <div className="flex flex-col items-start gap-2 rounded-lg border border-dashed border-line p-5">
          <p className="text-[0.95rem]">No applications yet.</p>
          <p className="text-[0.86rem] text-muted">Jobs posted on CareerMetro show on Departures with Apply. Each step the company takes shows up here.</p>
          <Link href="/departures" className={actionBtn}>
            Open Departures
          </Link>
        </div>
      ) : (
        groups.map((g) => (
          <section key={g.key} aria-labelledby={`arr-${g.key}`} className="flex flex-col gap-3">
            <div className="flex flex-wrap items-baseline gap-x-3">
              <h2 id={`arr-${g.key}`} className="text-[1.2rem] font-semibold">
                {g.title}
              </h2>
              <span className="text-[0.84rem] text-muted">{g.hint}</span>
            </div>
            {g.items.length ? (
              <ul className="flex flex-col gap-3">
                {g.items.map((a) => (
                  <li key={a.id}>
                    <ApplicationCard app={a} withdraw={withdraw} actions={actions} onDone={setMessage} goalLink={goalLinks[a.id]} />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="rounded-lg border border-dashed border-line px-4 py-3 text-[0.86rem] text-muted">{g.empty}</p>
            )}
          </section>
        ))
      )}
    </div>
  );
}

function ApplicationCard({
  app,
  withdraw,
  actions,
  onDone,
  goalLink,
}: {
  app: MyApplicationView;
  withdraw?: WithdrawAction;
  actions?: Omit<ArrivalsActions, "withdraw">;
  onDone: (m: { error: boolean; text: string }) => void;
  goalLink?: GoalLink;
}) {
  const [confirming, setConfirming] = useState(false);
  const [pending, start] = useTransition();
  const keepRef = useRef<HTMLButtonElement>(null);
  const withdrawRef = useRef<HTMLButtonElement>(null);
  const was = useRef(false);
  useEffect(() => {
    if (confirming) keepRef.current?.focus();
    else if (was.current) withdrawRef.current?.focus();
    was.current = confirming;
  }, [confirming]);

  const moving = !app.withdrawn && MOVING.has(app.stage);
  const closedNote = app.stage === "not_this_time" ? [...app.events].reverse().find((e) => e.stage === "not_this_time" && e.note)?.note : null;
  const withdrawable = canWithdraw(app);
  return (
    <article aria-labelledby={`app-${app.id}`} className="flex min-w-0 flex-col gap-3 rounded-lg border border-line bg-surface p-4 min-[760px]:p-5">
      <div className="flex flex-wrap items-start gap-2">
        <div className="min-w-0 flex-1">
          <span className="text-[0.86rem] text-muted [overflow-wrap:anywhere]">{app.company}</span>
          <h3 id={`app-${app.id}`} className="text-[1.1rem] font-semibold leading-[1.2] [overflow-wrap:anywhere]">
            {app.title}
          </h3>
          <p className="mt-1 flex flex-wrap items-center gap-x-3 text-[0.8rem] text-muted">
            <span className="inline-flex items-center gap-1">
              <MapPin {...ICON} size={14} />
              {app.city}
            </span>
            <span>Applied {formatDay(app.appliedOn)}</span>
            <span>Can join: {CAN_JOIN_LABELS[app.canJoin]}</span>
          </p>
        </div>
        <span className={`whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ${moving ? "bg-accent-soft text-ink" : "bg-surface-2 text-muted"}`}>
          {app.withdrawn ? "Withdrawn" : APPLICATION_STAGE_LABELS[app.stage]}
        </span>
      </div>
      {app.companyBlocked && !app.withdrawn && (
        <p className="rounded-md bg-surface-2 px-3.5 py-2.5 text-[0.86rem]">
          You blocked {app.company}. It can&apos;t message you, ask for times or arrange interviews. This application stays open until you withdraw it or the company
          closes it.
        </p>
      )}
      {closedNote && (
        <div className="rounded-md bg-surface-2 px-3.5 py-2.5 text-[0.88rem]">
          <span className="font-mono text-[0.7rem] uppercase tracking-[0.06em] text-muted">Note from {app.company}</span>
          <p className="mt-1 [overflow-wrap:anywhere]">{closedNote}</p>
        </div>
      )}
      {goalLink && app.stage === "not_this_time" && !app.withdrawn && (
        <p className="flex items-start gap-2 text-[0.86rem]">
          <Route {...ICON} className="mt-0.5 shrink-0 text-muted" />
          <span className="[overflow-wrap:anywhere]">{goalLinkText(goalLink)}</span>
        </p>
      )}
      <ApplicationInterviews app={app} actions={actions} onDone={onDone} />
      <ol aria-label="Steps" className="flex flex-col gap-1.5">
        {app.events.map((e, i) => (
          <li key={i} className="flex flex-wrap items-baseline gap-x-3 text-[0.84rem]">
            <span className="font-mono text-[0.72rem] text-muted">{formatDay(e.on)}</span>
            <span>
              {e.kind === "moved"
                ? e.stage === "not_this_time"
                  ? `${app.company} closed it: Not this time`
                  : `${app.company} moved you to ${APPLICATION_STAGE_LABELS[e.stage]}`
                : e.kind === "withdrawn"
                  ? "You withdrew it"
                  : "You applied on CareerMetro"}
            </span>
          </li>
        ))}
      </ol>
      {withdrawable && (
        <div className="flex flex-wrap items-center gap-2">
          {confirming ? (
            <>
              <span className="text-[0.84rem]">{withdrawConfirmText(app.company, app.stage)}</span>
              <button
                type="button"
                className={actionBtn}
                disabled={pending}
                onClick={() =>
                  start(async () => {
                    if (!withdraw) {
                      onDone({ error: true, text: "Example applications. Nothing changes here." });
                      setConfirming(false);
                      return;
                    }
                    const problem = await withdraw(app.id).catch(() => NO_CONNECTION);
                    onDone(problem ? { error: true, text: problem } : { error: false, text: `Withdrawn: ${app.title} at ${app.company}.` });
                  })
                }
              >
                Withdraw application
              </button>
              <button ref={keepRef} type="button" className={actionBtn} onClick={() => setConfirming(false)}>
                Keep it
              </button>
            </>
          ) : (
            <button ref={withdrawRef} type="button" aria-label={`Withdraw ${app.title} at ${app.company}`} className={actionBtn} onClick={() => setConfirming(true)}>
              <Undo2 {...ICON} />
              Withdraw
            </button>
          )}
        </div>
      )}
    </article>
  );
}
