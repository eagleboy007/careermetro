"use client";

import { Ban, Check, Clock, Flag, MessageSquare, Plus, UserMinus } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { CONNECTION_HOW_LABELS, CONNECTION_HOWS } from "@/lib/schemas/constants";
import type { ConnectionState } from "@/lib/schemas/network";
import type { NetworkActions, PathTogether, ProfileInCommon } from "@/lib/network/types";
import { MessageBox } from "./message-box";
import { ReportPerson } from "./report-person";

type How = (typeof CONNECTION_HOWS)[number];
type Panel = "pick" | "withdraw" | "remove" | "block" | "message" | "report" | null;

const ICON = { size: 16, strokeWidth: 1.75, "aria-hidden": true } as const;
const ink = "inline-flex min-h-11 items-center gap-1.5 rounded-full bg-ink px-3.5 text-[0.82rem] font-medium text-bg hover:opacity-90 aria-disabled:opacity-60";
const ghost =
  "inline-flex min-h-11 items-center gap-1.5 rounded-full border border-line bg-surface px-3.5 text-[0.82rem] font-medium text-ink hover:bg-surface-2 aria-disabled:opacity-60";
const quiet = "inline-flex min-h-11 items-center gap-1.5 rounded-full px-3 text-[0.82rem] font-medium text-muted hover:text-ink aria-disabled:opacity-60";

export type ProfileConnectActions = Pick<NetworkActions, "connect" | "answer" | "withdraw" | "remove" | "block" | "message" | "report">;

/**
 * Network on someone's profile (`/u/[handle]`, handoff 12j): the header button by state, then the strip of shared
 * counts and "In common with you" (skills, gaps and path, mutual connections). Connect opens the how-you-know pick
 * inline; Remove, Block and Report open inline. No connection count and nobody's list: only the people both know.
 * Everything here was cut on the server to what the owner's choices let this viewer see. Interests wait for profile
 * interests. Without actions (example data) nothing is sent.
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
  inCommon: ProfileInCommon;
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
        <button type="button" className={quiet} aria-disabled={busy} aria-expanded={panel === "report"} onClick={() => setPanel("report")}>
          <Flag {...ICON} />
          Report
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
      {panel === "report" && (
        <ReportPerson
          name={name}
          busy={busy}
          onSend={(reason, note) => run((a) => a.report(personId, reason, note), null, `Report sent. Our team reviews it; ${first} isn't told who reported.`)}
          onCancel={() => setPanel(null)}
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

      <InCommon first={first} inCommon={inCommon} />

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

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** The strip of shared counts, then "In common with you": skills, gaps and path, and mutual connections. */
function InCommon({ first, inCommon }: { first: string; inCommon: ProfileInCommon }) {
  const { skills, role, path, mutual } = inCommon;
  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-wrap gap-x-6 gap-y-1 border-y border-line py-3 text-[0.82rem] text-muted" aria-label="What you share">
        {skills && (
          <li>
            <b className="mr-1 font-mono font-medium text-ink">{skills.length}</b>shared skill{skills.length === 1 ? "" : "s"}
          </li>
        )}
        {path && (
          <li>
            <b className="mr-1 font-mono font-medium text-ink">{path.gaps.length}</b>shared gap{path.gaps.length === 1 ? "" : "s"}
          </li>
        )}
        <li>
          <b className="mr-1 font-mono font-medium text-ink">{mutual.length}</b>mutual connection{mutual.length === 1 ? "" : "s"}
        </li>
      </ul>

      <section aria-label="In common with you" className="flex flex-col gap-3.5">
        <h2 className="flex flex-wrap items-baseline gap-x-2.5 text-[1rem] font-semibold">
          In common with you
          <span className="font-mono text-[0.7rem] font-normal uppercase tracking-wide text-muted">Only {first}&rsquo;s public fields are used</span>
        </h2>
        {role && <p className="text-[0.84rem]">You are both aiming for {role}.</p>}

        {skills && skills.length > 0 && (
          <Block title="Skills" note={`${skills.length} you both have`}>
            <ul className="flex flex-wrap gap-1.5" aria-label="Skills you both have">
              {skills.map((s) => (
                <li key={s} className="rounded-full bg-surface-2 px-2.5 py-1 text-[0.78rem]">
                  {s}
                </li>
              ))}
            </ul>
          </Block>
        )}

        {path && <GapsAndPath first={first} path={path} />}

        <Block title="Mutual connections" note="only people you both know">
          {mutual.length ? (
            <p className="text-[0.84rem]">
              {mutual.map((m, i) => (
                <span key={m.id}>
                  {i > 0 && (i === mutual.length - 1 ? " and " : ", ")}
                  {m.username ? (
                    <Link href={`/u/${m.username}`} className="font-medium underline underline-offset-2">
                      {m.name}
                    </Link>
                  ) : (
                    m.name
                  )}
                </span>
              ))}
            </p>
          ) : (
            <p className="text-[0.84rem] text-muted">No mutual connections yet.</p>
          )}
          <p className="text-[0.8rem] text-muted">Nobody sees anyone else&rsquo;s full list of connections, only the people you share.</p>
        </Block>
      </section>
    </div>
  );
}

function Block({ title, note, children }: { title: string; note: string; children: ReactNode }) {
  return (
    <div className="grid gap-1.5 border-t border-line pt-3.5 first-of-type:border-t-0 first-of-type:pt-0 min-[760px]:grid-cols-[150px_minmax(0,1fr)] min-[760px]:gap-x-4">
      <h3 className="flex flex-col gap-0.5 text-[0.9rem] font-semibold">
        {title}
        <small className="font-mono text-[0.68rem] font-normal text-muted">{note}</small>
      </h3>
      <div className="flex min-w-0 flex-col gap-1.5">{children}</div>
    </div>
  );
}

/** "Gaps and path": the gaps both still have and where each one is on the same role's line. */
function GapsAndPath({ first, path }: { first: string; path: PathTogether }) {
  const apart = path.apart === null ? "same role" : path.apart === 0 ? "same role, same step" : `same role, ${plural(path.apart, "step")} apart`;
  const dot = "grid size-7 shrink-0 place-items-center rounded-full font-mono text-[0.72rem] font-medium";
  return (
    <Block title="Gaps and path" note={apart}>
      <p className="text-[0.8rem] text-muted">
        {path.sharedWith === "connections"
          ? `You are connected, so you see the gaps ${first} shares with connections.`
          : `${first} shows their gaps to everyone who can open this profile.`}
      </p>
      <ol className="flex flex-col gap-2.5">
        <li className="flex items-start gap-3">
          <span aria-hidden="true" className={`${dot} bg-ink text-bg`}>
            <Check size={12} strokeWidth={1.75} />
          </span>
          <span className="flex flex-col text-[0.84rem]">
            Resume and Gaps
            <small className="text-[0.78rem] text-muted">
              {path.gaps.length ? `Both done. ${plural(path.gaps.length, "gap")} in common: ${path.gaps.join(", ")}.` : "Both done. No gaps in common."}
            </small>
          </span>
        </li>
        <Step dot={dot} who="You" step={path.you} detail="Your current step." strong />
        <Step dot={dot} who={first} step={path.them} detail={`${first}’s current step.`} />
      </ol>
    </Block>
  );
}

function Step({ dot, who, step, detail, strong }: { dot: string; who: string; step: PathTogether["you"]; detail: string; strong?: boolean }) {
  return (
    <li className="flex items-start gap-3">
      <span className={`${dot} ${strong ? "border-2 border-ink" : "border border-line-strong"} bg-surface`}>
        <span aria-hidden="true">{step ? step.step : <Check size={12} strokeWidth={1.75} />}</span>
        {step && <span className="sr-only">Goal {step.step}</span>}
      </span>
      <span className="flex flex-col text-[0.84rem]">
        {who}: {step ? step.name : "every goal met"}
        <small className="text-[0.78rem] text-muted">{step ? detail : "Ready for Match."}</small>
      </span>
    </li>
  );
}
