"use client";

import { ArrowLeft, CalendarDays, ShieldAlert, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Fragment, useEffect, useRef, useState, useSyncExternalStore, useTransition, type ReactNode } from "react";
import { exampleAvailability, exampleSlots } from "@/lib/inbox/fixtures";
import {
  filterThreads,
  INBOX_FILTERS,
  initialsOf,
  lastMessage,
  REPORT_REASON_LABELS,
  type InboxActions,
  type InboxAsk,
  type InboxFilter,
  type InboxMessage,
  type InboxThread,
} from "@/lib/inbox/types";
import { ANTI_SCAM_LINE } from "@/lib/schemas/constants";
import type { ReportReason } from "@/lib/schemas/inbox";
import { GRIEVANCE_OFFICER } from "@/lib/grievance";

const ICON = { size: 14, strokeWidth: 1.75, "aria-hidden": true } as const;
const btn = "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full border px-[11px] py-1.5 text-[0.8rem] font-[550]";
const primary = `${btn} border-transparent bg-accent text-on-accent hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60`;
const ghost = `${btn} border-line bg-surface text-ink hover:bg-surface-2`;
const quiet = `${btn} border-transparent bg-transparent px-2 text-muted hover:text-ink`;
const label = "font-mono text-[0.7rem] uppercase tracking-[0.06em] text-muted";

const slotName = (key: string) => {
  const [d, t] = key.split("-").map(Number);
  const [day, date] = exampleSlots.days[d!]!;
  return `${day} ${date}, ${exampleSlots.times[t!]}`;
};

type Thread = InboxThread & { offered?: string[] };

const WIDE = "(min-width: 760px)";
const isWide = () => window.matchMedia(WIDE).matches;
const subscribeWide = (change: () => void) => {
  const query = window.matchMedia(WIDE);
  query.addEventListener("change", change);
  return () => query.removeEventListener("change", change);
};

/** How often an open Inbox checks for new messages (dev/inbox-plan.md: no live push in part 1). */
const POLL_MS = 30_000;

/**
 * Inbox (handoff 12b, prototype v2): applications, people and message requests in one list, the open chat, and the
 * private availability panel. With `actions` it works on the person's real chats: each change goes to the server and
 * the page refreshes from it. Without, it is the example: replies, offered times, accept and delete change this page and
 * nothing else. On a phone the list shows first and a chat opens full screen with a back arrow.
 */
export function InboxView({ threads: initial, note, actions }: { threads: InboxThread[]; note?: ReactNode; actions?: InboxActions }) {
  const router = useRouter();
  const [threads, setThreads] = useState<Thread[]>(initial);
  const [pending, startTransition] = useTransition();
  // Which button opened the Report panel, so Cancel can put focus back on it.
  const [reporting, setReporting] = useState<{ block: boolean; from: "header" | "footer" } | null>(null);
  const [filter, setFilter] = useState<InboxFilter>("all");
  const [currentId, setCurrentId] = useState(initial[0]?.id ?? null);
  const [open, setOpen] = useState(false);
  const [picking, setPicking] = useState(false);
  const [picks, setPicks] = useState<string[]>([]);
  const [calendarOn, setCalendarOn] = useState(true);
  const [draft, setDraft] = useState("");
  const [toast, setToast] = useState<string | null>(null);
  // Read out politely to screen readers: "Sent." after a send, and a new message that arrives in the chat on screen.
  const [heard, setHeard] = useState("");
  // New data from the server (after an action, or the 30-second check) replaces the list.
  const [shownFrom, setShownFrom] = useState(initial);
  if (initial !== shownFrom) {
    const before = threads.find((t) => t.id === currentId);
    const after = initial.find((t) => t.id === currentId);
    const last = after?.messages.at(-1);
    if (before && after && after.messages.length > before.messages.length && last?.by === "them") setHeard(`New message from ${last.who ?? after.name}`);
    setShownFrom(initial);
    setThreads(initial);
    if (!initial.some((t) => t.id === currentId)) {
      setCurrentId(initial[0]?.id ?? null);
      setOpen(false);
    }
  }
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const draftRef = useRef<HTMLTextAreaElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  // When the control in focus goes away (a chat opens on a phone, the slot grid opens or closes), focus moves to the
  // control that takes its place instead of falling back to the page.
  const focusNext = (selector: string) => requestAnimationFrame(() => rootRef.current?.querySelector<HTMLElement>(selector)?.focus());
  const phone = () => window.matchMedia("(max-width: 759px)").matches;

  useEffect(() => () => clearTimeout(toastTimer.current), []);
  useEffect(() => {
    if (!actions) return;
    const timer = setInterval(() => document.visibilityState === "visible" && router.refresh(), POLL_MS);
    return () => clearInterval(timer);
  }, [actions, router]);
  // A message that arrives in the chat on screen is read: the server marks it, and its refresh clears the dot and badge.
  const wide = useSyncExternalStore(subscribeWide, isWide, () => false);
  const onScreen = threads.find((t) => t.id === currentId);
  const readNow = !!actions && !!onScreen?.unread && onScreen.kind !== "request" && (open || wide);
  useEffect(() => {
    if (readNow && currentId && actions) void actions.read(currentId);
  }, [readNow, currentId, actions]);
  const say = (text: string) => {
    // Cleared first, so the same message twice is read out twice.
    setToast(null);
    requestAnimationFrame(() => setToast(text));
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2600);
  };

  const shown = filterThreads(threads, filter);
  const current = threads.find((t) => t.id === currentId) ?? null;
  const update = (id: string, change: (t: Thread) => Thread) => setThreads((all) => all.map((t) => (t.id === id ? change(t) : t)));

  /** Runs a real action; shows its error, or `done` when it worked. */
  const act = (run: () => Promise<string | null>, done?: () => void) =>
    startTransition(async () => {
      const error = await run();
      if (error) say(error);
      else done?.();
    });

  const openThread = (id: string) => {
    setCurrentId(id);
    setPicking(false);
    setReporting(null);
    setOpen(true);
    // Opening a chat reads it; a request stays unread until it is accepted or deleted.
    const opened = threads.find((t) => t.id === id);
    if (opened?.unread && opened.kind !== "request") {
      update(id, (t) => ({ ...t, unread: false }));
      if (actions) void actions.read(id);
    }
    if (phone()) focusNext("[data-back]");
  };

  const back = () => {
    setOpen(false);
    focusNext(`[data-thread="${currentId}"]`);
  };

  const send = () => {
    if (!current) return;
    const text = draft.trim();
    if (!text) {
      draftRef.current?.focus();
      return;
    }
    if (actions) {
      // Cleared at once and put back if the message doesn't go.
      setDraft("");
      startTransition(async () => {
        const error = await actions.send(current.id, text);
        if (error) {
          setDraft((now) => now || text);
          say(error);
        } else setHeard("Sent.");
      });
      return;
    }
    update(current.id, (t) => ({
      ...t,
      messages: [...t.messages, { by: "me", text, at: "now" }],
    }));
    setDraft("");
    setHeard("Sent.");
  };

  const sendPicks = (ask?: InboxAsk) => {
    if (!current) return;
    if (ask && actions?.offerTimes) {
      // A real "Ask for times": only the picked slot keys go to the server; the page refreshes with the answer.
      const offerTimes = actions.offerTimes;
      startTransition(async () => {
        const error = await offerTimes(ask.messageId, [...picks].sort());
        if (error) return say(error);
        setPicking(false);
        say(`Sent. ${current.name} sees only the times you picked.`);
        focusNext("[data-draft]");
      });
      return;
    }
    const offered = [...picks].sort();
    update(current.id, (t) => ({
      ...t,
      offered,
      messages: [
        ...t.messages,
        {
          by: "me",
          text: `I have offered ${offered.length} times. Any of them works for me.`,
          at: "now",
        },
      ],
    }));
    setPicking(false);
    say(`Sent. ${current.name} sees only the times you picked.`);
    focusNext("[data-draft]");
  };

  const accept = () => {
    if (!current) return;
    if (actions) {
      act(
        () => actions.accept(current.id),
        () => focusNext("[data-draft]"),
      );
      return;
    }
    update(current.id, (t) => ({
      ...t,
      kind: "person",
      unread: false,
      messages: [...t.messages, { by: "system", text: "You accepted. You can now message each other." }],
    }));
    focusNext("[data-draft]");
  };

  /** Takes a chat off this page after Delete, or after a report that blocks, and says so. */
  const drop = (id: string, message: string) => {
    const rest = threads.filter((t) => t.id !== id);
    setThreads(rest);
    setCurrentId(rest[0]?.id ?? null);
    setOpen(false);
    setReporting(null);
    say(message);
    focusNext("[data-thread]");
  };

  const remove = () => {
    if (!current) return;
    const message = `Deleted. ${current.name.split(" ")[0]} is not told.`;
    if (actions)
      act(
        () => actions.remove(current.id),
        () => drop(current.id, message),
      );
    else drop(current.id, message);
  };

  const sendReport = (reason: ReportReason, note: string, block: boolean) => {
    if (!current) return;
    const company = isCompany(current);
    const target = company ? "chat" : "person";
    const blocks = block;
    const finish = () => {
      if (blocks)
        drop(
          current.id,
          current.found
            ? `Reported and blocked. We confirm within 24 hours. ${current.name} can't find or message you any more.`
            : company
            ? `Reported and blocked. We confirm within 24 hours. ${current.name} can't message you in this chat any more.`
            : `Reported and blocked. We confirm within 24 hours. ${current.name.split(" ")[0]} is not told.`,
        );
      else {
        const from = reporting?.from;
        setReporting(null);
        say("Reported. We confirm within 24 hours.");
        focusNext(from === "footer" ? "[data-report-footer]" : "[data-report]");
      }
    };
    if (actions)
      act(
        () =>
          actions.report({
            conversationId: current.id,
            target,
            reason,
            note: note.trim() || undefined,
            block: blocks,
          }),
        finish,
      );
    else finish();
  };

  const startReport = (block: boolean, from: "header" | "footer") => {
    setReporting({ block, from });
    focusNext("[data-report-panel] input");
  };

  return (
    <div ref={rootRef} className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[1.5rem] font-semibold leading-[1.1] min-[760px]:text-[2rem]">Inbox</h1>
          <p className="mt-1.5 text-[0.92rem] text-muted">
            Messages with people on your line and with companies you applied to. Your phone number and email are never shared from here.
          </p>
        </div>
      </div>
      {note}

      <div className="grid items-start gap-3.5 min-[760px]:grid-cols-[260px_minmax(0,1fr)] min-[1100px]:grid-cols-[290px_minmax(0,1fr)_270px]">
        <section aria-label="Conversations" className={`min-w-0 rounded-[20px] border border-line bg-surface ${open ? "max-[759px]:hidden" : ""}`}>
          <div role="group" aria-label="Show" className="flex flex-wrap gap-1 border-b border-line px-2.5 pb-2 pt-2.5">
            {INBOX_FILTERS.map((f) => (
              <button
                key={f.key}
                type="button"
                aria-pressed={filter === f.key}
                onClick={() => setFilter(f.key)}
                className="inline-flex rounded-full border border-line px-[11px] py-1 text-[0.78rem] font-[550] text-muted aria-pressed:border-transparent aria-pressed:bg-surface-2 aria-pressed:text-ink"
              >
                {f.label}
              </button>
            ))}
          </div>
          <ul className="flex flex-col gap-0.5 p-2">
            {shown.length === 0 && <li className="p-3 text-[0.84rem] text-muted">Nothing here.</li>}
            {shown.map((t) => {
              const last = lastMessage(t);
              const lead = t.found && t.kind === "request" ? `Company · ${t.job} · ` : t.kind === "request" ? "Message request · " : t.kind === "application" ? `${t.job} · ` : "";
              return (
                <li key={t.id}>
                  <button
                    type="button"
                    data-thread={t.id}
                    onClick={() => openThread(t.id)}
                    aria-current={t.id === currentId ? "true" : undefined}
                    className="grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-x-2.5 rounded-[12px] p-2.5 text-left hover:bg-surface-2 aria-[current=true]:bg-surface-2"
                  >
                    <Avatar thread={t} />
                    <span className="min-w-0">
                      <b className="block text-[0.88rem] font-semibold leading-[1.25]">{t.name}</b>
                      <small className="block truncate text-[0.76rem] text-muted">
                        {lead}
                        {last?.text}
                      </small>
                    </span>
                    <span>
                      {t.unread ? (
                        <span className="ml-auto mt-[5px] block size-2 rounded-full bg-ink">
                          <span className="sr-only">unread</span>
                        </span>
                      ) : (
                        <span className="whitespace-nowrap font-mono text-[0.66rem] text-muted">{last?.at}</span>
                      )}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>

        {current && (
          <section
            aria-label={`Chat with ${current.name}`}
            className={`flex min-w-0 flex-col overflow-hidden rounded-[20px] border border-line bg-surface min-[760px]:min-h-[520px] ${open ? "" : "max-[759px]:hidden"}`}
          >
            <div className="flex items-center gap-2.5 border-b border-line px-3 py-2.5 min-[760px]:flex-wrap min-[760px]:px-4 min-[760px]:py-3.5">
              <button type="button" data-back onClick={back} aria-label="Back to all messages" className={`${quiet} px-1.5 min-[760px]:hidden`}>
                <ArrowLeft size={20} strokeWidth={1.75} aria-hidden="true" />
              </button>
              <Avatar thread={current} />
              <div className="min-w-0 flex-1 min-[760px]:flex-none">
                <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                  <b className="font-semibold">{current.name}</b>
                  {isCompany(current) && current.verified && <VerifiedBadge />}
                </span>
                <small className="block truncate text-[0.78rem] text-muted">
                  {current.found ? `${current.job} · found you in a search` : current.kind === "application" ? `${current.job} · your application` : current.status}
                </small>
              </div>
              <span className="hidden flex-1 min-[760px]:block" />
              {current.kind === "application" && !current.found && (
                <Link href="/arrivals" className={`${ghost} hidden min-[760px]:inline-flex`}>
                  See on Arrivals
                </Link>
              )}
              {current.state !== "left" && (
                <button
                  type="button"
                  data-report
                  onClick={() => startReport(false, "header")}
                  aria-expanded={!!reporting}
                  aria-controls={reporting ? "report-panel" : undefined}
                  className={`${quiet} min-h-11`}
                >
                  Block or report
                </button>
              )}
            </div>

            {reporting && (
              <ReportPanel
                key={current.id}
                name={current.name}
                company={isCompany(current)}
                canBlock
                block={reporting.block}
                pending={pending}
                onSubmit={sendReport}
                onCancel={() => {
                  const from = reporting.from;
                  setReporting(null);
                  focusNext(from === "footer" ? "[data-report-footer]" : "[data-report]");
                }}
              />
            )}

            {isCompany(current) && (
              <p className="mx-4 mt-3 flex items-start gap-2 rounded-[12px] bg-surface-2 px-2.5 py-2 text-[0.78rem] text-muted">
                <ShieldAlert {...ICON} className="mt-0.5 shrink-0" />
                <span>
                  {current.verified ? `${current.name} is a verified company. ` : ""}
                  {ANTI_SCAM_LINE}
                </span>
              </p>
            )}

            <ol aria-label="Messages" className="flex max-h-[560px] flex-1 flex-col gap-2.5 overflow-y-auto p-4">
              {current.messages.map((m, i) => (
                <Message
                  key={m.id ?? i}
                  thread={current}
                  message={m}
                  picking={picking}
                  picks={picks}
                  calendarOn={calendarOn}
                  onPick={() => {
                    setPicks([]);
                    setPicking(true);
                    focusNext('[aria-label="Pick times"] button:not([disabled])');
                  }}
                  onToggle={(k) => setPicks((p) => (p.includes(k) ? p.filter((x) => x !== k) : [...p, k]))}
                  onSendPicks={() => sendPicks(m.ask)}
                  sending={pending}
                  onCancel={() => {
                    setPicking(false);
                    focusNext("[data-offer]");
                  }}
                />
              ))}
            </ol>

            <div className="flex flex-col gap-2 border-t border-line px-3 py-2.5">
              {current.kind === "request" ? (
                <>
                  <p className="text-[0.82rem] text-muted">
                    {current.found
                      ? `${current.name} found you because you let companies find you. They can't send more until you accept, and they never see your email or phone.`
                      : `${current.name} is not a connection. They can't send more until you accept, and they never see your contact details.`}
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    <button type="button" className={primary} onClick={accept} disabled={pending}>
                      Accept
                    </button>
                    <button type="button" className={ghost} onClick={remove} disabled={pending}>
                      Delete
                    </button>
                    <button type="button" data-report-footer className={quiet} onClick={() => startReport(true, "footer")}>
                      Block and report
                    </button>
                  </div>
                </>
              ) : current.state ? (
                <p className="py-1.5 text-[0.82rem] text-muted">
                  {current.state === "waiting"
                    ? `Your message request is waiting for ${current.name.split(" ")[0]} to accept. You can send more once they do.`
                    : current.state === "left"
                      ? "This person has left CareerMetro, so you can't reply."
                      : current.state === "paused"
                        ? `${current.name}'s messages are paused while we review the company.`
                        : current.kind === "application" && !current.found
                          ? "This chat is closed. Application chats close 30 days after the application does."
                          : "This chat is closed."}
                </p>
              ) : (
                <div className="flex items-end gap-2">
                  <textarea
                    ref={draftRef}
                    data-draft
                    rows={1}
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    maxLength={2000}
                    placeholder="Write a message"
                    aria-label="Message"
                    className="min-h-[42px] flex-1 resize-none rounded-[12px] border border-line bg-bg px-3 py-2.5 text-[0.88rem] text-ink focus:outline-2 focus:outline-offset-1 focus:outline-accent"
                  />
                  <button type="button" onClick={send} disabled={pending} className={`${primary} px-[15px] py-[9px] text-[0.86rem]`}>
                    Send
                  </button>
                </div>
              )}
            </div>
          </section>
        )}

        <aside
          aria-label="Your availability"
          className={`flex min-w-0 flex-col gap-2.5 rounded-[20px] border border-line bg-surface p-4 min-[760px]:col-span-2 min-[1100px]:col-span-1 ${open ? "max-[759px]:hidden" : ""}`}
        >
          <h2 className="text-base font-semibold">Your availability</h2>
          <p className="text-[0.8rem] text-muted">Companies never see your calendar. They see only the times you offer when they ask.</p>
          {actions ? (
            <p className="text-[0.8rem] text-muted">Setting your usual free times and connecting a calendar come with job applications.</p>
          ) : (
            <>
              <dl className="flex flex-col">
                <Row k="Usually free" v={exampleAvailability.usuallyFree} />
                <Row k="Calendar" v={calendarOn ? exampleAvailability.calendar : "Not connected"} />
              </dl>
              <button
                type="button"
                className={`${ghost} self-start`}
                onClick={() => {
                  setCalendarOn((on) => !on);
                  say(calendarOn ? "Calendar disconnected." : "Calendar connected. Only busy and free are read.");
                }}
              >
                {calendarOn ? "Disconnect calendar" : "Connect Google or Outlook"}
              </button>
              <p className="text-[0.8rem] text-muted">
                Connected, it greys out busy times when you pick slots. Event names, guests and other companies&apos; interviews are never read or shared.
                &quot;Usually free&quot; only pre-fills your picks.
              </p>
            </>
          )}
          <h2 className="mt-1.5 text-base font-semibold">Who can message you</h2>
          <p className="text-[0.8rem] text-muted">
            Your connections, and companies you applied to, about that application. Anyone else sends one message request; you accept or delete it. Report and
            Block are on every chat.
          </p>
          <p className="text-[0.8rem] text-muted">
            Complaints go to our{" "}
            <Link href="/grievances" className="text-ink underline underline-offset-2">
              {GRIEVANCE_OFFICER.name}
            </Link>
            .
          </p>
        </aside>
      </div>

      <p role="status" aria-live="polite" className="sr-only">
        {heard}
      </p>
      <p
        role="status"
        className={`pointer-events-none fixed bottom-24 left-1/2 z-40 w-max max-w-[calc(100%-32px)] -translate-x-1/2 rounded-2xl bg-ink min-[700px]:rounded-full px-4 py-2.5 text-[0.84rem] font-[550] text-bg transition-opacity min-[760px]:bottom-6 ${toast ? "opacity-100" : "opacity-0"}`}
      >
        {toast}
      </p>
    </div>
  );
}

/** A chat with a company: an application chat, or a company that found the person in a search (pending item 19). */
const isCompany = (t: InboxThread) => t.kind === "application" || !!t.found;

function Avatar({ thread }: { thread: InboxThread }) {
  return (
    <span
      aria-hidden="true"
      className={`grid size-9 shrink-0 place-items-center rounded-full font-mono text-[0.74rem] font-medium ${isCompany(thread) ? "bg-board text-board-ink" : "bg-surface-2 text-ink"}`}
    >
      {initialsOf(thread.name)}
    </span>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-2.5 border-t border-line py-2 text-[0.84rem]">
      <dt>{k}</dt>
      <dd className="text-right text-muted">{v}</dd>
    </div>
  );
}

function Message({
  thread,
  message: m,
  picking,
  picks,
  calendarOn,
  onPick,
  onToggle,
  onSendPicks,
  onCancel,
  sending = false,
}: {
  thread: Thread;
  message: InboxMessage;
  picking: boolean;
  picks: string[];
  calendarOn: boolean;
  onPick: () => void;
  onToggle: (key: string) => void;
  onSendPicks: () => void;
  onCancel: () => void;
  sending?: boolean;
}) {
  if (m.by === "system") return <li className="max-w-[90%] self-center text-center text-[0.76rem] text-muted">{m.text}</li>;
  const who = m.by === "me" ? "You" : m.who ? `${m.who} · ${thread.name}` : thread.name;
  const meta = <span className="font-mono text-[0.68rem] text-muted">{`${who} · ${m.at ?? "now"}`}</span>;

  if (m.type === "times" && m.ask) {
    // A real "Ask for times" (corporate build step 6): the days asked, the picker's times, the slots too soon to offer.
    const ask = m.ask;
    const name = (key: string) => {
      const d = ask.days.find((x) => x.day === key.slice(0, 10));
      return d ? `${d.label[0]} ${d.label[1]}, ${key.slice(11)}` : key;
    };
    const unavailable = new Set(ask.unavailable);
    return (
      <li className="flex max-w-[92%] flex-col gap-2 rounded-[14px] border border-line bg-surface p-3">
        <span className={`${label} flex items-center gap-1.5`}>
          <CalendarDays {...ICON} />
          Asking for interview times
        </span>
        <p className="text-[0.88rem]">{m.text}</p>
        {ask.offered ? (
          <small className="text-[0.78rem] text-muted">
            You offered {ask.offered.length} {ask.offered.length === 1 ? "time" : "times"}: {ask.offered.join(" · ")}
          </small>
        ) : ask.passed ? (
          <small className="text-[0.78rem] text-muted">You offered times for this. They have passed.</small>
        ) : !ask.open ? (
          <small className="text-[0.78rem] text-muted">This can&apos;t be answered now.</small>
        ) : !picking ? (
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" data-offer className={primary} onClick={onPick}>
              Offer times
            </button>
            <small className="text-[0.78rem] text-muted">You choose what to share. The company sees only the times you pick.</small>
          </div>
        ) : (
          <>
            <div
              role="group"
              aria-label="Pick times"
              className="grid grid-cols-[38px_repeat(5,minmax(0,1fr))] gap-1 text-[0.72rem] min-[760px]:grid-cols-[44px_repeat(5,minmax(40px,1fr))]"
            >
              <span />
              {ask.days.map(({ day, label: [wd, date] }) => (
                <span key={day} className="p-0.5 text-center font-mono leading-[1.3] text-muted">
                  {wd}
                  <br />
                  {date}
                </span>
              ))}
              {ask.times.map((time) => (
                <Fragment key={time}>
                  <span className="flex min-h-11 items-center font-mono text-muted">{time}</span>
                  {ask.days.map(({ day }) => {
                    const key = `${day}T${time}`;
                    const off = unavailable.has(key);
                    const picked = picks.includes(key);
                    return (
                      <button
                        key={key}
                        type="button"
                        disabled={off}
                        aria-pressed={picked}
                        aria-label={off ? `${name(key)}, too soon to offer` : name(key)}
                        onClick={() => onToggle(key)}
                        className="min-h-11 rounded-[7px] border border-line bg-surface text-[0.72rem] text-muted aria-pressed:border-ink aria-pressed:bg-ink aria-pressed:text-surface disabled:cursor-not-allowed disabled:bg-[repeating-linear-gradient(135deg,var(--surface-2)_0_5px,transparent_5px_10px)]"
                      >
                        {picked ? "✓" : ""}
                      </button>
                    );
                  })}
                </Fragment>
              ))}
            </div>
            <small className="text-[0.76rem] text-muted">India time. Each slot is an hour. Striped times are too soon to offer.</small>
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" className={primary} disabled={picks.length === 0 || sending} onClick={onSendPicks}>
                Send {picks.length} time{picks.length === 1 ? "" : "s"}
              </button>
              <button type="button" className={quiet} onClick={onCancel}>
                Cancel
              </button>
            </div>
          </>
        )}
        {meta}
      </li>
    );
  }

  if (m.type === "times") {
    const busy = new Set<string>(calendarOn ? exampleSlots.busy : []);
    return (
      <li className="flex max-w-[92%] flex-col gap-2 rounded-[14px] border border-line bg-surface p-3">
        <span className={`${label} flex items-center gap-1.5`}>
          <CalendarDays {...ICON} />
          Asking for interview times
        </span>
        <p className="text-[0.88rem]">{m.text}</p>
        {thread.offered ? (
          <small className="text-[0.78rem] text-muted">
            You offered {thread.offered.length} times: {thread.offered.map(slotName).join(" · ")}
          </small>
        ) : !picking ? (
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" data-offer className={primary} onClick={onPick}>
              Offer times
            </button>
            <small className="text-[0.78rem] text-muted">You choose what to share. Your calendar stays private.</small>
          </div>
        ) : (
          <>
            <div
              role="group"
              aria-label="Pick times"
              className="grid grid-cols-[38px_repeat(5,minmax(0,1fr))] gap-1 text-[0.72rem] min-[760px]:grid-cols-[44px_repeat(5,minmax(40px,1fr))]"
            >
              <span />
              {exampleSlots.days.map(([day, date]) => (
                <span key={day} className="p-0.5 text-center font-mono leading-[1.3] text-muted">
                  {day}
                  <br />
                  {date}
                </span>
              ))}
              {exampleSlots.times.map((time, ti) => (
                <Slots key={time} time={time} ti={ti} busy={busy} picks={picks} onToggle={onToggle} />
              ))}
            </div>
            <small className="text-[0.76rem] text-muted">
              {calendarOn
                ? "Striped times are busy in your connected calendar. Only busy or free is read, never event names."
                : "Connect a calendar to grey out times you are already busy."}
            </small>
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" className={primary} disabled={picks.length === 0} onClick={onSendPicks}>
                Send {picks.length} time{picks.length === 1 ? "" : "s"}
              </button>
              <button type="button" className={quiet} onClick={onCancel}>
                Cancel
              </button>
            </div>
          </>
        )}
        {meta}
      </li>
    );
  }

  const mine = m.by === "me";
  return (
    <li className={`flex max-w-[92%] flex-col gap-[3px] min-[760px]:max-w-[78%] ${mine ? "items-end self-end" : "items-start"}`}>
      {m.type === "question" && <span className={label}>Question</span>}
      <div className={`rounded-[14px] border px-3 py-[9px] text-[0.88rem] ${mine ? "border-transparent bg-surface-2" : "border-line bg-surface"}`}>
        {m.text}
      </div>
      {meta}
    </li>
  );
}

function Slots({ time, ti, busy, picks, onToggle }: { time: string; ti: number; busy: Set<string>; picks: string[]; onToggle: (key: string) => void }) {
  return (
    <>
      <span className="py-[5px] font-mono text-muted">{time}</span>
      {exampleSlots.days.map((_, di) => {
        const key = `${di}-${ti}`;
        const isBusy = busy.has(key);
        const picked = picks.includes(key);
        return (
          <button
            key={key}
            type="button"
            disabled={isBusy}
            aria-pressed={picked}
            aria-label={isBusy ? `${slotName(key)}, busy in your calendar` : slotName(key)}
            onClick={() => onToggle(key)}
            className="min-h-11 rounded-[7px] border border-line bg-surface text-[0.72rem] text-muted aria-pressed:border-ink aria-pressed:bg-ink aria-pressed:text-surface disabled:cursor-not-allowed disabled:bg-[repeating-linear-gradient(135deg,var(--surface-2)_0_5px,transparent_5px_10px)]"
          >
            {isBusy ? "busy" : picked ? "✓" : ""}
          </button>
        );
      })}
    </>
  );
}

/** The verified-company badge on an application chat. Shown only while CareerMetro has the company verified. */
export function VerifiedBadge() {
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full border border-line bg-surface-2 px-2 py-0.5 text-[0.7rem] font-medium text-ink">
      <ShieldCheck size={12} strokeWidth={1.75} aria-hidden="true" />
      Verified company
    </span>
  );
}

/** Report, with an optional block: a reason (it sets how fast the grievance team must act), a note, then send. */
function ReportPanel({
  name,
  company = false,
  canBlock,
  block: blockAtFirst,
  pending,
  onSubmit,
  onCancel,
}: {
  name: string;
  /** An application chat: blocking closes the chat with the company instead of blocking a person. */
  company?: boolean;
  canBlock: boolean;
  block: boolean;
  pending: boolean;
  onSubmit: (reason: ReportReason, note: string, block: boolean) => void;
  onCancel: () => void;
}) {
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [note, setNote] = useState("");
  const [block, setBlock] = useState(blockAtFirst);
  const [missing, setMissing] = useState(false);
  const firstReason = useRef<HTMLInputElement>(null);
  const row = "flex min-h-11 items-center gap-2 py-2 text-[0.84rem]";
  return (
    <form
      id="report-panel"
      data-report-panel
      aria-label={`Report ${name}`}
      className="mx-4 mt-3 flex flex-col gap-2.5 rounded-[14px] border border-line bg-surface-2 p-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (reason) onSubmit(reason, note, block);
        else {
          setMissing(true);
          firstReason.current?.focus();
        }
      }}
    >
      <fieldset className="flex flex-col" aria-describedby={missing ? "report-missing" : undefined}>
        <legend className="mb-1 text-[0.86rem] font-semibold">What happened?</legend>
        {(Object.keys(REPORT_REASON_LABELS) as ReportReason[]).map((key, i) => (
          <label key={key} className={row}>
            <input
              ref={i === 0 ? firstReason : undefined}
              type="radio"
              name="reason"
              value={key}
              checked={reason === key}
              onChange={() => {
                setReason(key);
                setMissing(false);
              }}
              className="accent-ink"
            />
            {REPORT_REASON_LABELS[key]}
          </label>
        ))}
      </fieldset>
      <p id="report-missing" role="alert" className="text-[0.8rem] font-[550] text-ink empty:hidden">
        {missing ? "Choose what happened." : ""}
      </p>
      <label className="flex flex-col gap-1 text-[0.8rem] text-muted">
        Anything we should know (optional)
        <textarea
          rows={2}
          maxLength={500}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          className="resize-none rounded-[10px] border border-line bg-bg px-2.5 py-2 text-[0.84rem] text-ink focus:outline-2 focus:outline-offset-1 focus:outline-accent"
        />
      </label>
      {canBlock && (
        <label className={row}>
          <input type="checkbox" checked={block} onChange={(e) => setBlock(e.target.checked)} className="accent-ink" />
          {company ? `Also block ${name}. This chat closes and they can't message you in it again.` : `Also block ${name.split(" ")[0]}. They are not told.`}
        </label>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <button type="submit" className={primary} disabled={pending}>
          {block && canBlock ? "Report and block" : "Report"}
        </button>
        <button type="button" className={quiet} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
