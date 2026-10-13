"use client";

import { Check, Clock, UserMinus, UserPlus, X } from "lucide-react";
import { useEffect, useId, useRef, useState, useTransition } from "react";
import { formatDay } from "@/lib/corporate/format";
import type { AccessRequestView, InviteView, OrgRole, TeamActions, TeamMemberView } from "@/lib/corporate/types";
import { ORG_ROLE_LABELS, ORG_ROLES } from "@/lib/schemas/constants";
import { ghostSm, hintClass, ICON, inputClass } from "./parts";

/**
 * Team and access (handoff 12e), admins only. People, their role and work-email state, and access waiting for a code.
 * A role is given by typing a colleague's work email (plan call A); nobody's email address is ever shown here, only
 * "Verified on <date>". Without `actions` (the /design page) the controls are off.
 */
export function TeamAccess({
  domain,
  members,
  invites,
  requests,
  actions,
}: {
  domain: string;
  members: TeamMemberView[];
  invites: InviteView[];
  requests: AccessRequestView[];
  actions?: TeamActions;
}) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<OrgRole>("hiring");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const errorId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  /** Where focus goes once the confirm buttons close: back to that person's Remove button after Keep. */
  const returnTo = useRef<string | null>(null);
  const noticeRef = useRef<HTMLParagraphElement>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);

  // The buttons that had focus unmount (Keep, a removed row), so move focus on: to the result, or back to Remove.
  useEffect(() => {
    if (confirming !== null) return;
    const id = returnTo.current;
    returnTo.current = null;
    if (id) rootRef.current?.querySelector<HTMLElement>(`[data-remove="${CSS.escape(id)}"]`)?.focus();
  }, [confirming]);
  // A notice moves focus to its line. An error is announced by its alert; focus stays where the person is working:
  // on the work email field for an invite (the error describes it), or back on the control that was used.
  useEffect(() => {
    if (notice) noticeRef.current?.focus();
  }, [notice]);

  const act = (fn: () => Promise<string | null>, success: string, on?: { field?: boolean; member?: string }) =>
    start(async () => {
      setError(null);
      setNotice(null);
      const message = await fn();
      // The field is always there, so an invite error puts focus straight back on it. The confirm buttons close
      // either way; after an error, focus returns to that person's Remove button.
      if (message && on?.field) emailRef.current?.focus();
      if (message && on?.member) returnTo.current = on.member;
      if (message) setError(message);
      else setNotice(success);
      setConfirming(null);
    });

  return (
    <div ref={rootRef} className="flex flex-col gap-5">
      <form
        className="flex flex-col gap-2"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          if (!actions) return;
          act(async () => {
            const m = await actions.invite(email, role);
            if (!m) setEmail("");
            return m;
          }, `Access is waiting. They sign in with their own CareerMetro account, open Corporate and confirm their @${domain} email with a code.`, { field: true });
        }}
      >
        <span className="text-[0.82rem] font-semibold">Give a role</span>
        <div className="flex flex-wrap gap-2">
          <input
            ref={emailRef}
            type="email"
            aria-label="Colleague's work email"
            placeholder={`name@${domain}`}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            aria-describedby={error ? errorId : undefined}
            className={`${inputClass} min-w-[200px] flex-1`}
          />
          <select aria-label="Role" value={role} onChange={(e) => setRole(e.target.value as OrgRole)} className={`${inputClass}`}>
            {ORG_ROLES.map((r) => (
              <option key={r} value={r}>
                {ORG_ROLE_LABELS[r]}
              </option>
            ))}
          </select>
          <button type="submit" disabled={pending || !actions || !email.trim()} className={ghostSm}>
            <UserPlus {...ICON} />
            Give access
          </button>
        </div>
        <span className={hintClass}>Only a work email on {domain}. We keep a one-way code of it, never the address.</span>
      </form>

      {error && (
        <p ref={errorRef} id={errorId} role="alert" className="text-sm text-bad">
          {error}
        </p>
      )}
      {notice && (
        <p ref={noticeRef} tabIndex={-1} role="status" className="text-sm text-muted">
          {notice}
        </p>
      )}

      <ul aria-label="People" className="flex flex-col divide-y divide-line overflow-hidden rounded-[14px] border border-line">
        {members.map((m) => (
          <li key={m.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 px-3.5 py-3">
            <div className="min-w-0">
              <b className="text-[0.92rem] font-semibold">
                {m.name}
                {m.isYou && <span className="font-normal text-muted"> (you)</span>}
              </b>
              <small className="block text-[0.78rem] text-muted">
                {ORG_ROLE_LABELS[m.role]} · Work email: {m.recheckDue ? "re-check due" : `Verified on ${formatDay(m.workEmailVerifiedOn)}`}
              </small>
            </div>
            {confirming === m.id ? (
              <span className="flex flex-wrap justify-end gap-1.5">
                <button
                  type="button"
                  autoFocus
                  disabled={pending}
                  onClick={() => actions && act(() => actions.remove(m.id), `${m.name} no longer has access. Their own CareerMetro account stays as it is.`, { member: m.id })}
                  className={ghostSm}
                >
                  <Check {...ICON} />
                  Remove access
                </button>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => {
                    returnTo.current = m.id;
                    setConfirming(null);
                  }}
                  className={ghostSm}
                >
                  Keep
                </button>
              </span>
            ) : (
              <button type="button" data-remove={m.id} disabled={pending || !actions} onClick={() => setConfirming(m.id)} aria-label={`Remove access for ${m.name}`} className={ghostSm}>
                <UserMinus {...ICON} />
                Remove
              </button>
            )}
          </li>
        ))}
      </ul>

      {requests.length > 0 && (
        <div className="flex flex-col gap-2">
          <h3 className="text-[0.95rem] font-semibold">Asked for access</h3>
          <ul className="flex flex-col divide-y divide-line overflow-hidden rounded-[14px] border border-line">
            {requests.map((r) => (
              <RequestRow key={r.id} request={r} pending={pending} onAnswer={actions ? (answer) => act(() => actions.answerRequest(r.id, answer), answer === "decline" ? "Request declined." : `Role given. ${r.name} confirms a work email on ${domain} next.`) : undefined} />
            ))}
          </ul>
        </div>
      )}

      {invites.length > 0 && (
        <div className="flex flex-col gap-2">
          <h3 className="text-[0.95rem] font-semibold">Waiting for a work-email code</h3>
          <ul className="flex flex-col divide-y divide-line overflow-hidden rounded-[14px] border border-line">
            {invites.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center gap-3 px-3.5 py-3">
                <Clock {...ICON} className="text-muted" />
                <span className="min-w-0 flex-1 text-[0.86rem]">
                  {ORG_ROLE_LABELS[i.role]} · @{i.domain}
                  <small className="block text-[0.78rem] text-muted">
                    Given {formatDay(i.createdOn)} · open until {formatDay(i.expiresOn)}
                  </small>
                </span>
                <button type="button" disabled={pending || !actions} onClick={() => actions && act(() => actions.cancelInvite(i.id), "Invite cancelled.")} className={ghostSm}>
                  <X {...ICON} />
                  Cancel
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid gap-3 min-[760px]:grid-cols-3">
        <RoleCard role="admin" points={["Everything Hiring HR can do, on every job", "Gives and removes access", "Company page and verification", "At least two per company"]} />
        <RoleCard role="hiring" points={["Posts jobs", "Moves applicants on jobs they own or are added to", "Schedules interviews, makes offers"]} />
        <RoleCard role="interviewer" points={["Sees only candidates assigned to them", "Writes feedback", "Can't move stages or see other jobs"]} />
      </div>
    </div>
  );
}

function RequestRow({ request, pending, onAnswer }: { request: AccessRequestView; pending: boolean; onAnswer?: (answer: OrgRole | "decline") => void }) {
  const [role, setRole] = useState<OrgRole>("hiring");
  return (
    <li className="flex flex-wrap items-center gap-2 px-3.5 py-3">
      <span className="min-w-0 flex-1 text-[0.86rem]">
        <b className="font-semibold">{request.name}</b>
        <small className="block text-[0.78rem] text-muted">
          Asked {formatDay(request.createdOn)} with an @{request.domain} email
        </small>
      </span>
      <select aria-label={`Role for ${request.name}`} value={role} onChange={(e) => setRole(e.target.value as OrgRole)} className={`${inputClass} py-1.5`}>
        {ORG_ROLES.map((r) => (
          <option key={r} value={r}>
            {ORG_ROLE_LABELS[r]}
          </option>
        ))}
      </select>
      <button type="button" disabled={pending || !onAnswer} onClick={() => onAnswer?.(role)} className={ghostSm}>
        <Check {...ICON} />
        Give role
      </button>
      <button type="button" disabled={pending || !onAnswer} onClick={() => onAnswer?.("decline")} className={ghostSm}>
        Decline
      </button>
    </li>
  );
}

function RoleCard({ role, points }: { role: OrgRole; points: string[] }) {
  return (
    <div className="rounded-md border border-line p-3.5">
      <span className="inline-flex rounded-full bg-surface-2 px-2.5 py-0.5 text-xs font-medium">{ORG_ROLE_LABELS[role]}</span>
      <ul className="mt-2 flex list-disc flex-col gap-1 pl-4 text-[0.8rem] text-muted">
        {points.map((p) => (
          <li key={p}>{p}</li>
        ))}
      </ul>
    </div>
  );
}
