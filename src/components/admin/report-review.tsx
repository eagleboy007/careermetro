"use client";

import { Archive, ArchiveRestore, Check, Eye, EyeOff, Lock, LockOpen, X } from "lucide-react";
import { useEffect, useId, useRef, useState, useTransition } from "react";
import { JUNCTION_REPORT_REASON_LABELS, JUNCTION_REPORT_REASONS, REMOVAL_REASON_MAX, type JunctionReportReason } from "@/lib/schemas/constants";
import { istClock, istDayWords } from "@/lib/day-words";
import type {
  HiddenMessageView,
  RemovalState,
  ReportDecision,
  ReportRemovalAct,
  ReportRemovalInput,
  ReportReviewAction,
  ReportReviewView,
  SuspendedAccountView,
} from "@/lib/schemas/admin";
import type { HiddenJunctionView, LegalHoldInput } from "@/lib/schemas/junction";
import { REMOVAL_KEEP_DAYS } from "@/lib/schemas/legal-timings";

/*
 * Reports (/admin/reports, FR-45; docs/plans/reports-review-plan.md): open reports from the Inbox and job pages,
 * nearest deadline first, with the deadlines the Grievances page promises. Each row: the reason, what was reported and the
 * reported message or job, the reporter's note, the times, and Acknowledge, Action taken and Dismiss. People are first
 * name and last initial; never an email or phone. Neutral colours, as on the other admin pages: a passed deadline says
 * "Overdue" in words and weight, not in red. Results are announced in a polite live region. After a row leaves the
 * list, focus moves to the next row's first button, or to the list heading; it never drops to the page. Buttons use
 * aria-disabled while a review is running. Without `review` (the /design page) the buttons do nothing.
 *
 * The removal tools (FR-46): a row about a message offers Hide message or Unhide message, and a row that points at a
 * person's account offers Suspend account or Lift suspension (never for an admin's account or the admin's own). Each
 * opens a small form in the row that confirms it; hiding and suspending need a reason. What is in force is said in
 * words ("Message hidden 15 Oct by Asha V."), never in a status colour. Focus moves into the form when it opens and
 * back to its button when it closes. Below the open reports, hidden messages and suspended accounts stay listed until
 * they are undone, whatever became of their report. Without `remove` (the /design page) these do nothing either.
 *
 * Junction (FR-61, migration 0059): a row about a post or comment says whether it is held for review (out of every feed
 * until an admin decides; held rows come first) and offers Hide post or Hide comment, which needs the reason (admins
 * only) and the rule it broke (the author's notice quotes the rule). Hidden posts and comments stay listed below with
 * Unhide and the removal record's legal hold.
 */

const ICON = { size: 16, strokeWidth: 1.75, "aria-hidden": true } as const;
/** 44px tall targets. */
const button =
  "inline-flex min-h-11 items-center justify-center gap-1.5 rounded-full border px-4 text-[0.86rem] font-medium aria-disabled:cursor-not-allowed aria-disabled:opacity-60";
const solid = `${button} border-ink bg-ink text-bg hover:opacity-90`;
const ghost = `${button} border-line bg-surface text-ink hover:bg-surface-2`;

/** "15 Oct, 10:00" in India time. */
export function formatWhen(iso: string): string {
  return `${istDayWords(iso)}, ${istClock(iso)}`;
}

function Due({ by, now, done }: { by: string; now: string; done?: string | null }) {
  if (done) return <>Done {formatWhen(done)}</>;
  const late = by < now;
  return late ? <strong className="font-semibold">Overdue since {formatWhen(by)}</strong> : <>By {formatWhen(by)}</>;
}

/** "15 Oct" in India time. */
const formatDay = (iso: string) => istDayWords(iso);

/** "Message hidden 15 Oct by Asha V. Reason: Asked for an OTP." */
export function removalLine(what: "Message hidden" | "Account suspended" | "Post hidden" | "Comment hidden", state: RemovalState & { rule?: string }): string {
  const reason = state.reason.trim().replace(/[.\s]+$/, "");
  return `${what} ${formatDay(state.at)} by ${state.by}.${state.rule ? ` Rule: ${state.rule}.` : ""} Reason: ${reason}.`;
}

const RULE_OPTIONS = JUNCTION_REPORT_REASONS.map((value) => ({ value, label: JUNCTION_REPORT_REASON_LABELS[value] }));

/** Runs a removal and says whether it worked, so the form can close. */
type Remove = (input: ReportRemovalInput) => Promise<boolean>;

const field = "w-full rounded-sm border border-line-strong bg-surface px-3 py-2.5 text-[0.86rem] text-ink";

/**
 * One removal tool: its button, then a form in place of it that confirms the change, with a required reason when
 * `reason` is set. Focus goes to the form's first control when it opens, and back to the button when it closes.
 */
function RemovalControl({
  label,
  ariaLabel,
  icon,
  prompt,
  reason: reasonHint,
  rules,
  initialRule,
  off,
  onConfirm,
}: {
  label: string;
  ariaLabel: string;
  icon: React.ReactNode;
  prompt: string;
  /** The hint under a required reason field; no field when absent. */
  reason?: string;
  /** A required "Rule it broke" picker (Junction's hide); none when absent. */
  rules?: { value: JunctionReportReason; label: string }[];
  initialRule?: JunctionReportReason;
  off: boolean;
  onConfirm?: (reason: string, rule: JunctionReportReason) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [rule, setRule] = useState<JunctionReportReason>(initialRule ?? "other");
  const [error, setError] = useState("");
  const [focusTo, setFocusTo] = useState<{ to: "form" | "button"; n: number }>({ to: "button", n: 0 });
  const buttonRef = useRef<HTMLButtonElement>(null);
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const ids = useId();
  const disabled = off || !onConfirm;

  useEffect(() => {
    if (!focusTo.n) return;
    const target = focusTo.to === "button" ? buttonRef.current : (fieldRef.current ?? confirmRef.current);
    target?.focus();
  }, [focusTo]);

  const close = () => {
    setOpen(false);
    setText("");
    setError("");
    setFocusTo((f) => ({ to: "button", n: f.n + 1 }));
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (disabled) return;
    if (reasonHint !== undefined && !text.trim()) {
      setError("Write the reason.");
      fieldRef.current?.focus();
      return;
    }
    if (await onConfirm?.(text.trim(), rule)) close();
  };

  if (!open) {
    return (
      <button
        ref={buttonRef}
        type="button"
        aria-disabled={disabled || undefined}
        onClick={() => {
          if (disabled) return;
          setOpen(true);
          setFocusTo((f) => ({ to: "form", n: f.n + 1 }));
        }}
        aria-label={ariaLabel}
        className={ghost}
      >
        {icon}
        {label}
      </button>
    );
  }
  return (
    <form onSubmit={submit} aria-labelledby={`${ids}-prompt`} className="flex w-full flex-col gap-2.5 rounded-md border border-line bg-surface-2 p-3">
      <p id={`${ids}-prompt`} className="text-[0.86rem] font-medium">
        {prompt}
      </p>
      {rules && (
        <div className="flex flex-col gap-1">
          <label htmlFor={`${ids}-rule`} className="font-mono text-[0.7rem] uppercase tracking-[0.06em] text-muted">
            Rule it broke
          </label>
          <select id={`${ids}-rule`} value={rule} onChange={(e) => setRule(e.target.value as JunctionReportReason)} aria-describedby={`${ids}-rule-hint`} className={field}>
            {rules.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <span id={`${ids}-rule-hint`} className="text-[0.78rem] text-muted">
            The author&apos;s notice names this rule.
          </span>
        </div>
      )}
      {reasonHint !== undefined && (
        <div className="flex flex-col gap-1">
          <label htmlFor={`${ids}-reason`} className="font-mono text-[0.7rem] uppercase tracking-[0.06em] text-muted">
            Reason
          </label>
          <textarea
            ref={fieldRef}
            id={`${ids}-reason`}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              if (error) setError("");
            }}
            aria-required="true"
            aria-invalid={error ? true : undefined}
            aria-describedby={`${ids}-hint ${ids}-error`}
            maxLength={REMOVAL_REASON_MAX}
            rows={3}
            className={field}
          />
          <span id={`${ids}-hint`} className="text-[0.78rem] text-muted">
            {reasonHint}
          </span>
          <span id={`${ids}-error`} role="alert" className="text-[0.8rem] font-[550] text-ink empty:hidden">
            {error}
          </span>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <button ref={confirmRef} type="submit" aria-disabled={disabled || undefined} className={solid}>
          {icon}
          {label}
        </button>
        <button type="button" onClick={close} className={ghost}>
          Cancel
        </button>
      </div>
    </form>
  );
}

/** The removal tools of one report row, with what is in force said in words. */
function RowRemovals({ report: r, off, onRemove }: { report: ReportReviewView; off: boolean; onRemove?: Remove }) {
  if (!r.message && !r.account && !r.junction) return null;
  const about = `${r.reason}, reported by ${r.reporter}`;
  const m = r.message;
  const a = r.account;
  const j = r.junction;
  const noun = j?.target === "comment" ? "comment" : "post";
  const reportedRule = JUNCTION_REPORT_REASONS.find((x) => JUNCTION_REPORT_REASON_LABELS[x] === r.reason);
  return (
    <div className="flex flex-col gap-2.5 border-t border-line pt-3">
      {j?.hidden && <p className="text-[0.86rem] font-medium [overflow-wrap:anywhere]">{removalLine(j.target === "comment" ? "Comment hidden" : "Post hidden", j.hidden)}</p>}
      {m?.hidden && <p className="text-[0.86rem] font-medium [overflow-wrap:anywhere]">{removalLine("Message hidden", m.hidden)}</p>}
      {a?.suspended && <p className="text-[0.86rem] font-medium [overflow-wrap:anywhere]">{removalLine("Account suspended", a.suspended)}</p>}
      {a && !a.suspended && !a.canSuspend && <p className="text-[0.86rem] text-muted">{a.name} is an admin, so the account can&apos;t be suspended here.</p>}
      <div className="flex flex-wrap gap-2">
        {j && (
          <RemovalControl
            key="junction"
            label={j.hidden ? `Unhide ${noun}` : `Hide ${noun}`}
            ariaLabel={`${j.hidden ? `Unhide ${noun}` : `Hide ${noun}`}: ${about}`}
            icon={j.hidden ? <Eye {...ICON} /> : <EyeOff {...ICON} />}
            prompt={
              j.hidden
                ? `Show this ${noun} to everyone again? The removal record stays.`
                : `Hide this ${noun}? It leaves every feed, its author sees a notice naming the rule and can appeal. A copy is kept as the removal record.`
            }
            reason={j.hidden ? undefined : "Only admins see this reason."}
            rules={j.hidden ? undefined : RULE_OPTIONS}
            initialRule={reportedRule}
            off={off}
            onConfirm={
              onRemove &&
              ((reason: string, rule: JunctionReportReason) =>
                onRemove(
                  j.hidden
                    ? j.target === "post"
                      ? { action: "unhide_post", postId: j.id }
                      : { action: "unhide_comment", commentId: j.id }
                    : { action: j.target === "post" ? "hide_post" : "hide_comment", reportId: r.id, reason, rule },
                ))
            }
          />
        )}
        {m && (
          <RemovalControl
            key="message"
            label={m.hidden ? "Unhide message" : "Hide message"}
            ariaLabel={`${m.hidden ? "Unhide message" : "Hide message"}: ${about}`}
            icon={m.hidden ? <Eye {...ICON} /> : <EyeOff {...ICON} />}
            prompt={m.hidden ? "Show this message to everyone in the chat again?" : "Hide this message? Everyone in the chat sees a notice in its place. It isn't deleted."}
            reason={m.hidden ? undefined : "Only admins see this reason."}
            off={off}
            onConfirm={onRemove && ((reason: string) => onRemove(m.hidden ? { action: "unhide_message", messageId: m.id } : { action: "hide_message", reportId: r.id, reason }))}
          />
        )}
        {a && (a.suspended || a.canSuspend) && (
          <RemovalControl
            key="account"
            label={a.suspended ? "Lift suspension" : "Suspend account"}
            ariaLabel={`${a.suspended ? "Lift suspension" : "Suspend account"}: ${a.name}, ${about}`}
            icon={a.suspended ? <LockOpen {...ICON} /> : <Lock {...ICON} />}
            prompt={
              a.suspended
                ? `Lift ${a.name}'s suspension? They can use CareerMetro again, and companies see them again.`
                : `Suspend ${a.name}'s account? They see only a notice with your reason, and companies stop seeing them. Nothing is deleted.`
            }
            reason={a.suspended ? undefined : "They see this reason on their notice."}
            off={off}
            onConfirm={onRemove && ((reason: string) => onRemove(a.suspended ? { action: "lift_suspension", userId: a.id } : { action: "suspend_account", reportId: r.id, reason }))}
          />
        )}
      </div>
    </div>
  );
}

/** One open report with its actions. */
export function ReportRow({
  report: r,
  now,
  pending,
  onDecide,
  onRemove,
}: {
  report: ReportReviewView;
  now: string;
  pending: boolean;
  onDecide?: (decision: ReportDecision) => void;
  onRemove?: Remove;
}) {
  const off = pending || !onDecide;
  const press = (decision: ReportDecision) => () => {
    if (!off) onDecide?.(decision);
  };
  const titleId = `report-${r.id}`;
  return (
    <article aria-labelledby={titleId} className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-4 min-[760px]:flex-row min-[760px]:items-start min-[760px]:gap-5 min-[760px]:p-5">
      <div className="flex min-w-0 flex-1 flex-col gap-2.5">
        <h3 id={titleId} className="text-[1.05rem] font-semibold [overflow-wrap:anywhere]">
          {r.reason}
        </h3>
        <p className="text-[0.86rem]">{r.context ? r.context.label : `${r.what}, no longer on CareerMetro`}.</p>
        {r.held && <p className="text-[0.86rem] font-semibold">Held for review: out of every feed until you hide it or dismiss the report.</p>}
        {r.junction && r.junction.target === "post" && (
          <p className="text-[0.82rem] text-muted">
            {r.junction.upvotes} upvotes · {r.junction.comments} comments{r.junction.tags.length ? ` · ${r.junction.tags.join(", ")}` : ""}
          </p>
        )}
        {r.context?.text && <blockquote className="whitespace-pre-line rounded-md bg-surface-2 px-3.5 py-2.5 text-[0.86rem] [overflow-wrap:anywhere]">{r.context.text}</blockquote>}
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-[0.86rem] min-[560px]:grid-cols-[auto_minmax(0,1fr)_auto_minmax(0,1fr)]">
          <Item label="Reported by">{r.reporter}</Item>
          <Item label="Reported">{formatWhen(r.reportedAt)}</Item>
          <Item label="Acknowledge">
            <Due by={r.acknowledgeBy} now={now} done={r.acknowledgedAt} />
          </Item>
          <Item label="Decide">
            <Due by={r.decideBy} now={now} />
          </Item>
        </dl>
        {r.note && (
          <p className="text-[0.86rem] [overflow-wrap:anywhere]">
            <span className="font-mono text-[0.7rem] uppercase tracking-[0.06em] text-muted">Their note </span>
            {r.note}
          </p>
        )}
        <RowRemovals report={r} off={pending} onRemove={onRemove} />
      </div>
      <div className="flex flex-wrap gap-2 min-[760px]:w-[200px] min-[760px]:flex-col min-[760px]:items-stretch">
        {!r.acknowledgedAt && (
          <button type="button" data-first-action={r.id} aria-disabled={off || undefined} onClick={press("acknowledge")} aria-label={`Acknowledge: ${r.reason}, reported by ${r.reporter}`} className={ghost}>
            <Eye {...ICON} />
            Acknowledge
          </button>
        )}
        <button
          type="button"
          data-first-action={r.acknowledgedAt ? r.id : undefined}
          aria-disabled={off || undefined}
          onClick={press("actioned")}
          aria-label={`Action taken: ${r.reason}, reported by ${r.reporter}`}
          className={solid}
        >
          <Check {...ICON} />
          Action taken
        </button>
        <button type="button" aria-disabled={off || undefined} onClick={press("dismissed")} aria-label={`Dismiss: ${r.reason}, reported by ${r.reporter}`} className={ghost}>
          <X {...ICON} />
          Dismiss
        </button>
      </div>
    </article>
  );
}

function Item({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="font-mono text-[0.7rem] uppercase leading-[1.9] tracking-[0.06em] text-muted">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </>
  );
}

/** A hidden message in force, with Unhide message. */
export function HiddenMessageRow({ message: m, off, onRemove }: { message: HiddenMessageView; off: boolean; onRemove?: Remove }) {
  const titleId = `hidden-${m.id}`;
  return (
    <article aria-labelledby={titleId} className="flex flex-col gap-2.5 rounded-lg border border-line bg-surface p-4 min-[760px]:p-5">
      <h3 id={titleId} className="text-[1rem] font-semibold [overflow-wrap:anywhere]">
        {m.label}
      </h3>
      <blockquote className="whitespace-pre-line rounded-md bg-surface-2 px-3.5 py-2.5 text-[0.86rem] [overflow-wrap:anywhere]">{m.text}</blockquote>
      <p className="text-[0.86rem] font-medium [overflow-wrap:anywhere]">{removalLine("Message hidden", m.hidden)}</p>
      <div className="flex flex-wrap gap-2">
        <RemovalControl
          label="Unhide message"
          ariaLabel={`Unhide message: ${m.label}`}
          icon={<Eye {...ICON} />}
          prompt="Show this message to everyone in the chat again?"
          off={off}
          onConfirm={onRemove && (() => onRemove({ action: "unhide_message", messageId: m.id }))}
        />
      </div>
    </article>
  );
}

/** A hidden post or comment in force, with Unhide and the removal record's legal hold. */
export function HiddenJunctionRow({
  item: h,
  off,
  onRemove,
  onHold,
}: {
  item: HiddenJunctionView;
  off: boolean;
  onRemove?: Remove;
  onHold?: (input: LegalHoldInput) => Promise<boolean>;
}) {
  const titleId = `hidden-${h.what}-${h.id}`;
  const noun = h.what === "comment" ? "comment" : "post";
  return (
    <article aria-labelledby={titleId} className="flex flex-col gap-2.5 rounded-lg border border-line bg-surface p-4 min-[760px]:p-5">
      <h3 id={titleId} className="text-[1rem] font-semibold [overflow-wrap:anywhere]">
        {h.label}
      </h3>
      <blockquote className="whitespace-pre-line rounded-md bg-surface-2 px-3.5 py-2.5 text-[0.86rem] [overflow-wrap:anywhere]">
        {h.title && <strong className="block font-semibold">{h.title}</strong>}
        {h.text}
      </blockquote>
      <p className="text-[0.86rem] font-medium [overflow-wrap:anywhere]">{removalLine(h.what === "comment" ? "Comment hidden" : "Post hidden", h.hidden)}</p>
      {h.removalId && (
        <p className="text-[0.82rem] text-muted">
          {h.legalHold ? "Removal record kept under a legal hold until you lift it." : h.purgeAfter ? `Removal record kept until ${formatDay(h.purgeAfter)}.` : null}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <RemovalControl
          label={`Unhide ${noun}`}
          ariaLabel={`Unhide ${noun}: ${h.label}`}
          icon={<Eye {...ICON} />}
          prompt={`Show this ${noun} to everyone again? The removal record stays.`}
          off={off}
          onConfirm={onRemove && (() => onRemove(h.what === "post" ? { action: "unhide_post", postId: h.id } : { action: "unhide_comment", commentId: h.id }))}
        />
        {h.removalId && (
          <RemovalControl
            label={h.legalHold ? "Lift legal hold" : "Keep under legal hold"}
            ariaLabel={`${h.legalHold ? "Lift legal hold" : "Keep under legal hold"}: ${h.label}`}
            icon={h.legalHold ? <ArchiveRestore {...ICON} /> : <Archive {...ICON} />}
            prompt={
              h.legalHold
                ? `Lift the legal hold? The record is deleted at the end of its ${REMOVAL_KEEP_DAYS} days, or at the next cleanup if they have passed.`
                : `Keep this removal record past its ${REMOVAL_KEEP_DAYS} days, because an order or an investigation asks for it?`
            }
            off={off}
            onConfirm={onHold && (() => onHold({ removalId: h.removalId!, hold: !h.legalHold }))}
          />
        )}
      </div>
    </article>
  );
}

/** A suspended account in force, with Lift suspension. */
export function SuspendedAccountRow({ account: a, off, onRemove }: { account: SuspendedAccountView; off: boolean; onRemove?: Remove }) {
  const titleId = `suspended-${a.id}`;
  return (
    <article aria-labelledby={titleId} className="flex flex-col gap-2.5 rounded-lg border border-line bg-surface p-4 min-[760px]:p-5">
      <h3 id={titleId} className="text-[1rem] font-semibold [overflow-wrap:anywhere]">
        Account: {a.name}
      </h3>
      <p className="text-[0.86rem] font-medium [overflow-wrap:anywhere]">{removalLine("Account suspended", a.suspended)}</p>
      <div className="flex flex-wrap gap-2">
        <RemovalControl
          label="Lift suspension"
          ariaLabel={`Lift suspension: ${a.name}`}
          icon={<LockOpen {...ICON} />}
          prompt={`Lift ${a.name}'s suspension? They can use CareerMetro again, and companies see them again.`}
          off={off}
          onConfirm={onRemove && (() => onRemove({ action: "lift_suspension", userId: a.id }))}
        />
      </div>
    </article>
  );
}

/**
 * The whole list with its live region. `now` is the server's time, so the page reads the same on both sides.
 * `inForce` lists the hidden messages and suspended accounts below the open reports.
 */
export function ReportReview({
  reports,
  now,
  review,
  remove,
  hold,
  inForce,
}: {
  reports: ReportReviewView[];
  now: string;
  review?: ReportReviewAction;
  remove?: ReportRemovalAct;
  /** Junction's legal hold on a removal record. */
  hold?: (input: LegalHoldInput) => Promise<{ ok: boolean; message: string }>;
  inForce?: { messages: HiddenMessageView[]; accounts: SuspendedAccountView[]; junction?: HiddenJunctionView[] };
}) {
  const [message, setMessage] = useState("");
  const [pending, start] = useTransition();
  const rootRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const headingId = useId();
  /** After a review: the reviewed row, the rows after it, its place, and the list it was pressed on. */
  const focusAfter = useRef<{ id: string; after: string[]; index: number; until: ReportReviewView[] } | null>(null);

  useEffect(() => {
    const f = focusAfter.current;
    if (!f || reports === f.until) return;
    // The new list has arrived: the same row if it stayed (acknowledged), else the next row, else the heading.
    focusAfter.current = null;
    const present = new Set(reports.map((r) => r.id));
    const nextId = present.has(f.id) ? f.id : (f.after.find((id) => present.has(id)) ?? reports[Math.min(f.index, reports.length - 1)]?.id);
    const target = nextId ? rootRef.current?.querySelector<HTMLElement>(`[data-first-action="${CSS.escape(nextId)}"]`) : null;
    (target ?? headingRef.current)?.focus();
  }, [reports, message]);

  const inForceRef = useRef<HTMLHeadingElement>(null);
  const inForceId = useId();
  /** After undoing a row of the in-force list: its id. Once the row has gone, focus goes to that list's heading. */
  const undone = useRef<string | null>(null);
  useEffect(() => {
    const id = undone.current;
    if (!id || !inForce || inForce.messages.some((m) => m.id === id) || inForce.accounts.some((a) => a.id === id) || inForce.junction?.some((h) => h.id === id)) return;
    undone.current = null;
    inForceRef.current?.focus();
  }, [inForce, message]);

  /** Runs a removal, announces the result, and says whether it worked so the row's form can close. */
  const act = (input: ReportRemovalInput, inForceRow?: string) =>
    new Promise<boolean>((resolve) => {
      if (!remove) {
        resolve(false);
        return;
      }
      start(async () => {
        setMessage("");
        const result = await remove(input);
        if (result.ok && inForceRow) undone.current = inForceRow;
        setMessage(result.message);
        resolve(result.ok);
      });
    });
  const inForceCount = (inForce?.messages.length ?? 0) + (inForce?.accounts.length ?? 0) + (inForce?.junction?.length ?? 0);

  /** Sets or lifts a legal hold and announces the result. */
  const keep = (input: LegalHoldInput) =>
    new Promise<boolean>((resolve) => {
      if (!hold) {
        resolve(false);
        return;
      }
      start(async () => {
        setMessage("");
        const result = await hold(input);
        setMessage(result.message);
        resolve(result.ok);
      });
    });

  const decide = (r: ReportReviewView, index: number, decision: ReportDecision) =>
    review &&
    start(async () => {
      setMessage("");
      const result = await review(r.id, decision);
      if (result.ok) focusAfter.current = { id: r.id, after: reports.slice(index + 1).map((x) => x.id), index, until: reports };
      setMessage(result.message);
    });

  return (
    <div ref={rootRef} className="mx-auto flex w-full max-w-[920px] flex-col gap-[18px]">
      <div className="flex flex-col gap-1.5">
        <span className="font-mono text-[0.72rem] uppercase tracking-[0.06em] text-muted">Admin</span>
        <h1 className="text-[clamp(1.6rem,3.5vw,2.2rem)] font-semibold leading-[1.1]">Reports</h1>
        <p className="text-[0.9rem] text-muted">
          Open reports from chats, job pages and Junction: held posts and comments first, then the nearest deadline. Acknowledge each within 24 hours. Act on sexual content or impersonation within 24
          hours, other rule breaks within 72 hours, and decide anything else within 15 days. Hide a reported message or suspend a reported person&apos;s
          account from its row, with a reason; both can be undone, and neither closes the report. Hide a reported post or comment with a reason and
          the rule it broke; its author can appeal. Suspend a company from Company review. Action taken
          and Dismiss close the report.
        </p>
      </div>

      <p role="status" aria-live="polite" className={message ? "rounded-md bg-surface-2 px-3.5 py-2.5 text-[0.86rem]" : "sr-only"}>
        {message}
      </p>

      <h2 ref={headingRef} id={headingId} tabIndex={-1} className="font-mono text-[0.72rem] uppercase tracking-[0.06em] text-muted focus:outline-2 focus:outline-offset-2 focus:outline-ink">
        Open · {reports.length}
      </h2>

      {reports.length === 0 ? (
        <p className="rounded-lg border border-line bg-surface px-4 py-6 text-center text-[0.9rem] text-muted">Nothing to review. No report is open.</p>
      ) : (
        <ul aria-labelledby={headingId} className="flex flex-col gap-3">
          {reports.map((r, index) => (
            <li key={r.id}>
              <ReportRow report={r} now={now} pending={pending} onDecide={review ? (d) => decide(r, index, d) : undefined} onRemove={remove ? (input) => act(input) : undefined} />
            </li>
          ))}
        </ul>
      )}

      {inForce && (
        <section aria-labelledby={inForceId} className="flex flex-col gap-3">
          <h2 ref={inForceRef} id={inForceId} tabIndex={-1} className="font-mono text-[0.72rem] uppercase tracking-[0.06em] text-muted focus:outline-2 focus:outline-offset-2 focus:outline-ink">
            Hidden and suspended · {inForceCount}
          </h2>
          {inForceCount === 0 ? (
            <p className="rounded-lg border border-line bg-surface px-4 py-6 text-center text-[0.9rem] text-muted">Nothing is hidden and no account is suspended.</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {inForce.messages.map((m) => (
                <li key={m.id}>
                  <HiddenMessageRow message={m} off={pending} onRemove={remove ? (input) => act(input, m.id) : undefined} />
                </li>
              ))}
              {inForce.junction?.map((h) => (
                <li key={`${h.what}-${h.id}`}>
                  <HiddenJunctionRow item={h} off={pending} onRemove={remove ? (input) => act(input, h.id) : undefined} onHold={hold ? keep : undefined} />
                </li>
              ))}
              {inForce.accounts.map((a) => (
                <li key={a.id}>
                  <SuspendedAccountRow account={a} off={pending} onRemove={remove ? (input) => act(input, a.id) : undefined} />
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
