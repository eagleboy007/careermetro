"use client";

import { Ban, Check, Clock, MessageSquare, Plus, UserMinus } from "lucide-react";
import { useEffect, useRef, useState, useTransition } from "react";
import { CONNECTION_HOW_LABELS, CONNECTION_HOWS } from "@/lib/schemas/constants";
import type { ConnectionState } from "@/lib/schemas/network";
import type { NetworkActions } from "@/lib/network/types";
import { MessageBox } from "./message-box";

type How = (typeof CONNECTION_HOWS)[number];
type Panel = "pick" | "withdraw" | "remove" | "block" | "message" | null;

const ICON = { size: 16, strokeWidth: 1.75, "aria-hidden": true } as const;
const ink = "inline-flex min-h-11 items-center gap-1.5 rounded-full bg-ink px-3.5 text-[0.82rem] font-medium text-bg hover:opacity-90 aria-disabled:opacity-60";
const ghost =
  "inline-flex min-h-11 items-center gap-1.5 rounded-full border border-line bg-surface px-3.5 text-[0.82rem] font-medium text-ink hover:bg-surface-2 aria-disabled:opacity-60";
const quiet = "inline-flex min-h-11 items-center gap-1.5 rounded-full px-3 text-[0.82rem] font-medium text-muted hover:text-ink aria-disabled:opacity-60";

export type ProfileConnectActions = Pick<NetworkActions, "connect" | "answer" | "withdraw" | "remove" | "block" | "message">;

/**
 * Network on someone's profile (`/u/[handle]`, handoff 12j): the header button by state, then "In common with you".
 * Connect opens the how-you-know pick inline; Remove and Block confirm inline. No connection count and nobody's list.
 * Without actions (example data) nothing is sent.
 */
export function ProfileConnect({
  personId,
  name,
  initial,
  inCommon,
  actions,
}: {
  personId: string;
  name: string;
  initial: ConnectionState;
  inCommon: { skills: string[]; role: string | null };
  actions?: ProfileConnectActions;
}) {
  const [state, setState] = useState(initial);
  const [panel, setPanel] = useState<Panel>(null);
  const [pick, setPick] = useState<How>("same_line");
  const [message, setMessage] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const statusRef = useRef<HTMLParagraphElement>(null);
  const [focusTick, setFocusTick] = useState(0);
  useEffect(() => {
    if (focusTick) statusRef.current?.focus();
  }, [focusTick]);
  const first = name.split(" ")[0];
  const busy = pending || undefined;

  const run = (work: (a: ProfileConnectActions) => Promise<string | null>, next: ConnectionState | null | (() => ConnectionState), words: string | (() => string)) => {
    if (pending) return;
    const say = (text: string) => {
      setMessage(text);
      setFocusTick((n) => n + 1);
    };
    if (!actions) return say("This is an example. Nothing is sent.");
    start(async () => {
      // A dropped connection says so here instead of replacing the page with the error screen.
      const error = await work(actions).catch(() => "That didn't work. Please try again.");
      if (error) return say(error);
      setPanel(null);
      if (next) setState(typeof next === "function" ? next() : next);
      say(typeof words === "string" ? words : words());
    });
  };

  // Connect connects at once when they had already asked, so the button follows what the server says.
  const send = () => {
    let reached: ConnectionState = "requested";
    run(
      async (a) => {
        const r = await a.connect(personId, pick);
        if ("error" in r) return r.error;
        reached = r.state;
        return null;
      },
      () => reached,
      () => (reached === "connected" ? `You and ${first} are connected.` : `Request sent to ${first}.`),
    );
  };

  return (
    <section aria-label={`You and ${name}`} className="flex flex-col gap-3 rounded-[14px] border border-line bg-surface px-3.5 py-3" data-profile-connect>
      <div className="flex flex-wrap items-center gap-1.5">
        {state === "connected" ? (
          <>
            <button type="button" className={ink} aria-disabled={busy} aria-expanded={panel === "message"} onClick={() => setPanel("message")}>
              <MessageSquare {...ICON} />
              Message
            </button>
            <span className="inline-flex min-h-11 items-center gap-1.5 px-2 text-[0.82rem] text-muted">
              <Check {...ICON} />
              Connected
            </span>
            <button type="button" className={quiet} aria-disabled={busy} aria-expanded={panel === "remove"} onClick={() => setPanel("remove")}>
              <UserMinus {...ICON} />
              Remove connection
            </button>
          </>
        ) : state === "incoming" ? (
          <>
            <button type="button" className={ink} aria-disabled={busy} onClick={() => run((a) => a.answer(personId, "accept"), "connected", `You and ${first} are connected.`)}>
              Accept request
            </button>
            <button type="button" className={quiet} aria-disabled={busy} onClick={() => run((a) => a.answer(personId, "ignore"), "none", `Request ignored. ${first} isn't told.`)}>
              Ignore
            </button>
          </>
        ) : state === "requested" ? (
          <>
            <span className="inline-flex min-h-11 items-center gap-1.5 px-2 text-[0.82rem] text-muted">
              <Clock {...ICON} />
              Requested
            </span>
            <button type="button" className={quiet} aria-disabled={busy} aria-expanded={panel === "withdraw"} onClick={() => setPanel("withdraw")}>
              Withdraw
            </button>
          </>
        ) : (
          <button type="button" className={ink} aria-disabled={busy} aria-expanded={panel === "pick"} onClick={() => setPanel("pick")}>
            <Plus {...ICON} />
            Connect
          </button>
        )}
        <button type="button" className={quiet} aria-disabled={busy} aria-expanded={panel === "block"} onClick={() => setPanel("block")}>
          <Ban {...ICON} />
          Block
        </button>
      </div>

      {panel === "pick" && (
        <div role="group" aria-label={`How you know ${name}`} className="flex flex-col gap-2 rounded-md bg-surface-2 p-3">
          <b className="text-[0.86rem]">How do you know {first}?</b>
          <div className="flex flex-wrap gap-1.5">
            {CONNECTION_HOWS.map((h) => (
              <button
                key={h}
                type="button"
                aria-pressed={pick === h}
                onClick={() => setPick(h)}
                className={`min-h-11 rounded-full border px-3 text-[0.8rem] ${pick === h ? "border-ink bg-ink text-bg" : "border-line-strong bg-surface text-ink"}`}
              >
                {CONNECTION_HOW_LABELS[h]}
              </button>
            ))}
          </div>
          <small className="text-[0.78rem] text-muted">{first} sees this with your name and shared skills. Requests carry no message. You can send 20 a day.</small>
          <div className="flex flex-wrap gap-1.5">
            <button type="button" className={ink} aria-disabled={busy} onClick={send}>
              Send request
            </button>
            <button type="button" className={quiet} onClick={() => setPanel(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}
      {panel === "message" && (
        <MessageBox name={first} busy={busy} onSend={(body) => run((a) => a.message(personId, body), null, `Sent to ${first}. The chat is in your Inbox.`)} onCancel={() => setPanel(null)} />
      )}
      {panel === "withdraw" && (
        <Confirm
          title={`Withdraw your request to ${name}?`}
          body={`${first} isn't told. You can ask again 30 days after you sent it.`}
          yes="Withdraw"
          busy={busy}
          onYes={() => run((a) => a.withdraw(personId), "none", `Request to ${first} withdrawn.`)}
          onNo={() => setPanel(null)}
        />
      )}
      {panel === "remove" && (
        <Confirm
          title={`Remove ${name} from your connections?`}
          body={`${first} isn't told. What only connections see ends for both of you, and new messages need a message request. Either of you can connect again later.`}
          yes="Remove"
          busy={busy}
          onYes={() => run((a) => a.remove(personId), "none", `${first} removed from your connections.`)}
          onNo={() => setPanel(null)}
        />
      )}
      {panel === "block" && (
        <Confirm
          title={`Block ${name}?`}
          body="You disappear from each other's search, lists and profiles, any connection or request between you ends, and neither of you can message the other. They aren't told. Unblock in Account settings."
          yes="Block"
          busy={busy}
          onYes={() => run((a) => a.block(personId), null, `${first} is blocked.`)}
          onNo={() => setPanel(null)}
        />
      )}

      {(inCommon.skills.length > 0 || inCommon.role) && (
        <div className="flex flex-col gap-1.5">
          <h2 className="font-mono text-[0.7rem] uppercase tracking-wide text-muted">In common with you</h2>
          {inCommon.role && <p className="text-[0.84rem]">You are both aiming for {inCommon.role}.</p>}
          {inCommon.skills.length > 0 && (
            <ul className="flex flex-wrap gap-1.5" aria-label="Skills you both have">
              {inCommon.skills.map((s) => (
                <li key={s} className="rounded-full bg-surface-2 px-2.5 py-1 text-[0.78rem]">
                  {s}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <p ref={statusRef} tabIndex={-1} role="status" className="text-[0.82rem] text-muted outline-none empty:hidden">
        {message}
      </p>
    </section>
  );
}

function Confirm({ title, body, yes, onYes, onNo, busy }: { title: string; body: string; yes: string; onYes: () => void; onNo: () => void; busy?: true }) {
  return (
    <div role="group" aria-label={title} className="flex flex-col gap-2 rounded-md bg-surface-2 p-3">
      <b className="text-[0.86rem]">{title}</b>
      <small className="text-[0.78rem] text-muted">{body}</small>
      <div className="flex flex-wrap gap-1.5">
        <button type="button" className={ghost} aria-disabled={busy} onClick={onYes}>
          {yes}
        </button>
        <button type="button" className={quiet} onClick={onNo}>
          Cancel
        </button>
      </div>
    </div>
  );
}
