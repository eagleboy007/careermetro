"use client";

import { ArrowLeft, HelpCircle, LayoutGrid, Send, Users } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, useTransition, type ReactNode } from "react";
import type { CompanyChatActions, CompanyChatMessage, CompanyChatState, CompanyChatView, CompanyMessagesView } from "@/lib/corporate/types";
import { APPLICATION_STAGE_LABELS } from "@/lib/schemas/constants";
import { actionBtn, inkBtn } from "./jobs-panel";
import { monoLabel } from "./job-parts";
import { AntiScamLine, ICON, OrgStatusBadge } from "./parts";

/*
 * Corporate Messages (dev/corporate-plan.md build step 5; handoff 12e): the company's application chats. They belong to
 * the company, not to one recruiter: Recruiter admins and the job's Hiring HR read and write them; Interviewers read
 * only the candidates assigned to them and never write. The candidate sees each sender's name and the company. "Ask a
 * question" sends the next message under a Question label. Without `actions` (the /design page and the example
 * preview) nothing sends.
 */

/** How often an open chat checks for new messages, as the Inbox does (no live push yet). */
const POLL_MS = 30_000;
/** MESSAGE_MAX_CHARS in lib/schemas/inbox, which holds Zod and so stays out of client code; the server checks it again. */
const MESSAGE_MAX = 2000;

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");

const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? name;

/** Why the person can't write here, in words. */
const STATE_TEXT: Record<Exclude<CompanyChatState, "open">, string> = {
  read_only: "Interviewers can read this chat. Hiring HR and Recruiter admins send messages.",
  not_allowed: "Only Recruiter admins, and Hiring HR on this job, can message its candidates.",
  suspended: "Your company's messages are paused while we review it.",
  closed: "This chat is closed. Chats close 30 days after an application does.",
};

export function CompanyMessages({
  view,
  chat,
  chatError,
  actions,
  note,
}: {
  view: CompanyMessagesView;
  chat: CompanyChatView | null;
  /** Words to show when the chat asked for in the address can't be opened. */
  chatError?: string | null;
  actions?: CompanyChatActions;
  note?: ReactNode;
}) {
  const router = useRouter();
  useEffect(() => {
    if (!actions) return;
    const timer = setInterval(() => document.visibilityState === "visible" && router.refresh(), POLL_MS);
    return () => clearInterval(timer);
  }, [actions, router]);

  const showing = !!chat || !!chatError;
  const interviewer = view.role === "interviewer";
  return (
    <div className="mx-auto flex w-full max-w-[1100px] flex-col gap-[18px]">
      <div className="flex flex-col gap-2">
        <Link href="/corporate" className="inline-flex min-h-11 items-center gap-1.5 self-start text-[0.86rem] text-muted hover:text-ink">
          <ArrowLeft {...ICON} />
          Corporate
        </Link>
        <span className={monoLabel}>Corporate · {view.company}</span>
        <div className="flex flex-wrap items-center gap-2.5">
          <h1 className="text-[clamp(1.5rem,3.2vw,2rem)] font-semibold leading-[1.1]">Messages</h1>
          <OrgStatusBadge status={view.status} />
        </div>
        <p className="max-w-[680px] text-[0.9rem] text-muted">
          Chats with people who applied to your jobs. They belong to the company: Recruiter admins and each job&apos;s team read them, and the candidate sees
          each sender&apos;s name and {view.company}. Your personal Inbox stays separate.
        </p>
      </div>
      {note}

      <div className="grid items-start gap-3.5 min-[760px]:grid-cols-[280px_minmax(0,1fr)]">
        <nav aria-label="Chats" className={`min-w-0 rounded-lg border border-line bg-surface ${showing ? "max-[759px]:hidden" : ""}`}>
          {interviewer ? (
            <p className="p-4 text-[0.86rem] text-muted">
              Interviewers read the chats of candidates assigned to them, once interviews are set up. Hiring HR and Recruiter admins send messages.
            </p>
          ) : view.items.length === 0 ? (
            <p className="p-4 text-[0.86rem] text-muted">No chats yet. Open a candidate on a job&apos;s board and choose Message to write to them.</p>
          ) : (
            <ul className="flex flex-col gap-0.5 p-2">
              {view.items.map((item) => (
                <li key={item.applicationId}>
                  <Link
                    href={`/corporate/messages?application=${item.applicationId}`}
                    aria-current={chat?.applicationId === item.applicationId ? "page" : undefined}
                    className="grid min-h-11 w-full grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-x-2.5 rounded-md p-2.5 hover:bg-surface-2 aria-[current=page]:bg-surface-2"
                  >
                    <span aria-hidden="true" className="grid size-9 shrink-0 place-items-center rounded-full bg-surface-2 font-mono text-[0.74rem] font-medium">
                      {initials(item.name)}
                    </span>
                    <span className="min-w-0">
                      <b className="block text-[0.88rem] font-semibold leading-[1.25] [overflow-wrap:anywhere]">{item.name}</b>
                      <small className="block truncate text-[0.76rem] text-muted">
                        {item.job} · {item.preview}
                      </small>
                    </span>
                    <span>
                      {item.unread ? (
                        <span className="ml-auto mt-[5px] block size-2 rounded-full bg-ink">
                          <span className="sr-only">unread</span>
                        </span>
                      ) : (
                        <span className="whitespace-nowrap font-mono text-[0.66rem] text-muted">{item.at}</span>
                      )}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </nav>

        {chat ? (
          <CompanyChat key={chat.applicationId} chat={chat} company={view.company} actions={actions} />
        ) : chatError ? (
          <section aria-label="Chat" className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-4">
            <Link href="/corporate/messages" className="inline-flex min-h-11 items-center gap-1.5 self-start text-[0.86rem] text-muted hover:text-ink min-[760px]:hidden">
              <ArrowLeft {...ICON} />
              All chats
            </Link>
            <p role="alert" className="text-[0.92rem]">
              {chatError}
            </p>
          </section>
        ) : (
          <p className="hidden rounded-lg border border-line bg-surface p-4 text-[0.88rem] text-muted min-[760px]:block">Pick a chat to read it.</p>
        )}
      </div>
    </div>
  );
}

/** One application's chat: the people it is shared with, the anti-scam line, the messages and the composer. */
export function CompanyChat({ chat, company, actions }: { chat: CompanyChatView; company: string; actions?: CompanyChatActions }) {
  const [draft, setDraft] = useState("");
  const [question, setQuestion] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<CompanyChatMessage[]>([]);
  const [pending, start] = useTransition();
  const draftRef = useRef<HTMLTextAreaElement>(null);
  const listRef = useRef<HTMLOListElement>(null);
  const ids = useId();
  const messages = [...chat.messages, ...sent];

  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [messages.length]);

  const send = () => {
    const text = draft.trim();
    if (!text) {
      setError("Write a message first.");
      draftRef.current?.focus();
      return;
    }
    setError(null);
    if (!actions) {
      // The example: shown here only, nothing sent.
      setSent((s) => [...s, { by: "me", who: "You", text, at: "now", ...(question ? { question: true } : {}) }]);
      setDraft("");
      setQuestion(false);
      return;
    }
    start(async () => {
      const problem = await actions.send(chat.applicationId, text, question);
      if (problem) {
        setError(problem);
        draftRef.current?.focus();
      } else {
        setDraft("");
        setQuestion(false);
      }
    });
  };

  return (
    <section aria-labelledby={`${ids}-name`} className="flex min-w-0 flex-col overflow-hidden rounded-lg border border-line bg-surface">
      <div className="flex flex-wrap items-center gap-2.5 border-b border-line px-3 py-2.5 min-[760px]:px-4">
        <Link href="/corporate/messages" aria-label="Back to all chats" className="inline-flex min-h-11 min-w-11 items-center justify-center text-muted hover:text-ink min-[760px]:hidden">
          <ArrowLeft size={20} strokeWidth={1.75} aria-hidden="true" />
        </Link>
        <span aria-hidden="true" className="grid size-9 shrink-0 place-items-center rounded-full bg-surface-2 font-mono text-[0.74rem] font-medium">
          {initials(chat.candidate)}
        </span>
        <div className="min-w-0 flex-1">
          <h2 id={`${ids}-name`} className="text-[1rem] font-semibold [overflow-wrap:anywhere]">
            {chat.candidate}
          </h2>
          <small className="block text-[0.78rem] text-muted [overflow-wrap:anywhere]">
            {chat.job} · {APPLICATION_STAGE_LABELS[chat.stage]}
          </small>
        </div>
        <Link href={`/corporate/jobs/board?id=${chat.jobId}`} className={`${actionBtn} max-[519px]:basis-full`}>
          <LayoutGrid {...ICON} />
          Open board
        </Link>
      </div>
      <p className="mx-3 mt-3 flex items-start gap-2 rounded-md bg-surface-2 px-3 py-2 text-[0.8rem] text-muted min-[760px]:mx-4">
        <Users {...ICON} className="mt-0.5 shrink-0" />
        <span>
          Shared with {company}&apos;s Recruiter admins and this job&apos;s team. {firstName(chat.candidate)} sees each sender&apos;s name and {company}, never your email
          or phone.
        </span>
      </p>
      <div className="mx-3 mt-2 min-[760px]:mx-4">
        <AntiScamLine />
      </div>

      <ol ref={listRef} aria-label="Messages" className="flex max-h-[520px] min-h-[200px] flex-1 flex-col gap-2.5 overflow-y-auto p-3 min-[760px]:p-4">
        {messages.map((m, i) =>
          m.by === "system" ? (
            <li key={m.id ?? i} className="max-w-[90%] self-center text-center text-[0.76rem] text-muted">
              {m.text}
            </li>
          ) : (
            <li key={m.id ?? i} className={`flex max-w-[92%] flex-col gap-[3px] min-[760px]:max-w-[78%] ${m.by === "me" ? "items-end self-end" : "items-start"}`}>
              {m.question && <span className={monoLabel}>Question</span>}
              <div
                className={`whitespace-pre-wrap rounded-[14px] border px-3 py-[9px] text-[0.88rem] [overflow-wrap:anywhere] ${m.by === "candidate" ? "border-line bg-surface" : "border-transparent bg-surface-2"}`}
              >
                {m.text}
              </div>
              <span className="font-mono text-[0.68rem] text-muted">
                {m.who} · {m.at ?? "now"}
              </span>
            </li>
          ),
        )}
      </ol>

      <div className="flex flex-col gap-2 border-t border-line px-3 py-2.5">
        {chat.state !== "open" ? (
          <p className="py-1.5 text-[0.84rem] text-muted">{STATE_TEXT[chat.state]}</p>
        ) : (
          <form
            className="flex flex-col gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              send();
            }}
          >
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                aria-pressed={question}
                onClick={() => {
                  setQuestion((q) => !q);
                  draftRef.current?.focus();
                }}
                className={`${actionBtn} aria-pressed:border-ink`}
              >
                <HelpCircle {...ICON} />
                Ask a question
              </button>
              <span className="text-[0.78rem] text-muted">{question ? "Your next message goes as a question. Keep it about the job." : "Interview times come with Interviews."}</span>
            </div>
            {error && (
              <p id={`${ids}-error`} role="alert" className="text-[0.84rem] font-medium">
                {error}
              </p>
            )}
            <div className="flex items-end gap-2">
              <textarea
                ref={draftRef}
                rows={2}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                maxLength={MESSAGE_MAX}
                placeholder={question ? "Your question. Keep it about the job." : "Write a message"}
                aria-label={question ? "Question" : "Message"}
                aria-describedby={error ? `${ids}-error` : undefined}
                className="min-h-11 flex-1 resize-none rounded-md border border-line bg-bg px-3 py-2.5 text-[0.88rem] text-ink focus:outline-2 focus:outline-offset-1 focus:outline-accent"
              />
              <button type="submit" className={inkBtn} disabled={pending}>
                <Send {...ICON} />
                Send
              </button>
            </div>
          </form>
        )}
      </div>
    </section>
  );
}
