"use client";

import { BadgeCheck, Ban, CalendarDays, Clock, Flag, Link2, MapPin, MessageSquare, Plus, Route, Search, UserMinus, Users } from "lucide-react";
import Link from "next/link";
import { useEffect, useId, useRef, useState, useTransition, type KeyboardEvent, type ReactNode } from "react";
import { Switch } from "@/components/ui/switch";
import { MessageBox } from "./message-box";
import { ReportPerson } from "./report-person";
import { CONNECTION_HOW_LABELS, CONNECTION_HOWS } from "@/lib/schemas/constants";
import type { ReportReason } from "@/lib/schemas/inbox";
import type { NetworkActions, NetworkData, NetworkFilters, NetworkRow, NetworkTab } from "@/lib/network/types";

type How = (typeof CONNECTION_HOWS)[number];

const ICON = { size: 16, strokeWidth: 1.75, "aria-hidden": true } as const;
const ink = "inline-flex min-h-11 items-center gap-1.5 rounded-full bg-ink px-3.5 text-[0.82rem] font-medium text-bg hover:opacity-90 aria-disabled:opacity-60";
const ghost =
  "inline-flex min-h-11 items-center gap-1.5 rounded-full border border-line bg-surface px-3.5 text-[0.82rem] font-medium text-ink hover:bg-surface-2 aria-disabled:opacity-60";
const quiet = "inline-flex min-h-11 items-center gap-1.5 rounded-full px-3 text-[0.82rem] font-medium text-muted hover:text-ink aria-disabled:opacity-60";

const TABS: { key: NetworkTab; label: string; short?: string }[] = [
  { key: "connections", label: "Connections" },
  { key: "requests", label: "Requests" },
  { key: "sent", label: "Sent" },
  { key: "find", label: "Find people", short: "Find" },
];

type Panel = { id: string; kind: "pick" | "withdraw" | "remove" | "block" | "message" | "report" } | null;

const NO_FILTERS: NetworkFilters = { sameRole: false, sameCity: false, verified: false };

/** The example search narrowed as the server narrows a real one (/design and the preview without accounts). */
const exampleFiltered = (rows: NetworkRow[], f: NetworkFilters, data: NetworkData) =>
  rows.filter((p) => (!f.sameRole || (p.aim !== null && p.aim === data.myRole)) && (!f.sameCity || (p.city !== null && p.city === data.myCity)) && (!f.verified || p.verified));

const FAILED = "That didn't work. Please try again.";

/**
 * Network (FR-49, handoff 12j): the "Let people find me" bar, then tabs for Connections, Requests, Sent and Find
 * people (with the optional filters Aiming for my role, In <city> and Verified, applied on the server). Connect opens
 * an inline "How do you know them?" pick, and Remove, Block and Report open inline under the row; there are no pop-ups.
 * Then "On your line" (Later) and the Mentors teaser (after the beta). Without actions (example data, /design) nothing
 * is sent and the buttons only show what they do.
 */
export function NetworkView({ data, actions, note, example }: { data: NetworkData; actions?: NetworkActions; note?: ReactNode; example?: NetworkRow[] }) {
  const ids = useId();
  const [tab, setTab] = useState<NetworkTab>(data.requests.length ? "requests" : "connections");
  const [lists, setLists] = useState({ connections: data.connections, requests: data.requests, sent: data.sent });
  const [results, setResults] = useState<NetworkRow[] | null>(null);
  const [query, setQuery] = useState("");
  // The query and filters of the last search, so a filter turned on or off searches the same name again.
  const [searched, setSearched] = useState<string | null>(null);
  const [filters, setFilters] = useState<NetworkFilters>(NO_FILTERS);
  const [findMe, setFindMe] = useState(data.peopleCanFind);
  const [panel, setPanel] = useState<Panel>(null);
  const [pick, setPick] = useState<How>("same_line");
  const [sort, setSort] = useState<"recent" | "az">("recent");
  const [message, setMessage] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const statusRef = useRef<HTMLParagraphElement>(null);
  const tabRefs = useRef<Partial<Record<NetworkTab, HTMLButtonElement | null>>>({});
  const searchRef = useRef<HTMLInputElement>(null);
  // Moves focus after the page re-renders: to the status line when the pressed button went away (WCAG 2.4.3).
  const [focusTick, setFocusTick] = useState(0);
  useEffect(() => {
    if (focusTick) statusRef.current?.focus();
  }, [focusTick]);

  const say = (text: string) => {
    setMessage(text);
    setFocusTick((n) => n + 1);
  };

  /** Moves a person between lists after an action worked, so the page needn't reload. */
  const move = (person: NetworkRow, to: NetworkRow["state"]) => {
    const next = { ...person, state: to, when: to === "connected" ? "Connected today" : to === "requested" ? "Sent today · ends in 30 days if not answered" : null };
    setLists((l) => {
      const out = {
        connections: l.connections.filter((p) => p.id !== person.id),
        requests: l.requests.filter((p) => p.id !== person.id),
        sent: l.sent.filter((p) => p.id !== person.id),
      };
      if (to === "connected") out.connections = [next, ...out.connections];
      if (to === "requested") out.sent = [next, ...out.sent];
      return out;
    });
    setResults((r) => r?.map((p) => (p.id === person.id ? { ...p, state: to } : p)) ?? null);
  };
  const drop = (person: NetworkRow) => {
    setLists((l) => ({
      connections: l.connections.filter((p) => p.id !== person.id),
      requests: l.requests.filter((p) => p.id !== person.id),
      sent: l.sent.filter((p) => p.id !== person.id),
    }));
    setResults((r) => r?.filter((p) => p.id !== person.id) ?? null);
  };

  const run = (work: () => Promise<string | null>, done: () => void, words: string | (() => string)) => {
    if (pending) return;
    if (!actions) {
      say("This is an example. Nothing is sent.");
      return;
    }
    start(async () => {
      // A dropped connection says so here instead of replacing the page with the error screen.
      const error = await work().catch(() => FAILED);
      if (error) say(error);
      else {
        setPanel(null);
        done();
        say(typeof words === "string" ? words : words());
      }
    });
  };

  const first = (p: NetworkRow) => p.name.split(" ")[0];
  const act = {
    connect: (p: NetworkRow) => {
      setPick(p.how ?? "same_line");
      setPanel({ id: p.id, kind: "pick" });
    },
    // Connect connects at once when they had already asked, so the screen follows what the server says.
    send: (p: NetworkRow) => {
      let state: NetworkRow["state"] = "requested";
      run(
        async () => {
          const r = await actions!.connect(p.id, pick);
          if ("error" in r) return r.error;
          state = r.state;
          return null;
        },
        () => move(p, state),
        () => (state === "connected" ? `You and ${first(p)} are connected.` : `Request sent to ${first(p)}. It shows under Sent until they answer.`),
      );
    },
    accept: (p: NetworkRow) => run(() => actions!.answer(p.id, "accept"), () => move(p, "connected"), `You and ${first(p)} are connected.`),
    ignore: (p: NetworkRow) => run(() => actions!.answer(p.id, "ignore"), () => move(p, "none"), `Request ignored. ${first(p)} isn't told.`),
    withdraw: (p: NetworkRow) => run(() => actions!.withdraw(p.id), () => move(p, "none"), `Request to ${first(p)} withdrawn. You can ask again 30 days after you sent it.`),
    remove: (p: NetworkRow) => run(() => actions!.remove(p.id), () => move(p, "none"), `${first(p)} removed from your connections.`),
    block: (p: NetworkRow) => run(() => actions!.block(p.id), () => drop(p), `${first(p)} is blocked.`),
    message: (p: NetworkRow, body: string) => run(() => actions!.message(p.id, body), () => undefined, `Sent to ${first(p)}. The chat is in your Inbox.`),
    report: (p: NetworkRow, reason: ReportReason, note: string) =>
      run(() => actions!.report(p.id, reason, note), () => undefined, `Report sent. Our team reviews it; ${first(p)} isn't told who reported.`),
  };

  const onTabKey = (e: KeyboardEvent<HTMLButtonElement>, key: NetworkTab) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    const i = TABS.findIndex((t) => t.key === key);
    const next = TABS[(i + (e.key === "ArrowRight" ? 1 : TABS.length - 1)) % TABS.length].key;
    setTab(next);
    setPanel(null);
    tabRefs.current[next]?.focus();
  };

  const search = (q: string, f: NetworkFilters = filters) => {
    if (pending) return;
    if (!actions) {
      setSearched(q);
      setResults(exampleFiltered(example ?? [], f, data));
      return;
    }
    start(async () => {
      const r = await actions.search(q, f).catch(() => ({ error: FAILED }));
      setSearched(q);
      if ("error" in r) {
        setResults(null);
        say(r.error);
      } else {
        setResults(r.people);
        setMessage(null);
      }
    });
  };

  const toggleFindMe = (on: boolean) => {
    if (!actions) {
      setFindMe(on);
      return;
    }
    start(async () => {
      const error = await actions.findMe(on).catch(() => FAILED);
      if (error) say(error);
      else {
        setFindMe(on);
        say(on ? "People can now find you by name." : "You are out of name search. Your connections still see you.");
      }
    });
  };

  /** A filter turned on or off searches the last name again, on the server; before any search it only waits for one. */
  const toggleFilter = (key: keyof NetworkFilters) => {
    if (pending) return;
    const next = { ...filters, [key]: !filters[key] };
    setFilters(next);
    if (searched !== null) search(searched, next);
  };
  const filtered = filters.sameRole || filters.sameCity || filters.verified;
  const filterButtons: { key: keyof NetworkFilters; label: string; icon: ReactNode }[] = [
    ...(data.myRole ? [{ key: "sameRole" as const, label: "Aiming for my role", icon: <Route {...ICON} size={14} /> }] : []),
    ...(data.myCity ? [{ key: "sameCity" as const, label: `In ${data.myCity}`, icon: <MapPin {...ICON} size={14} /> }] : []),
    { key: "verified", label: "Verified", icon: <BadgeCheck {...ICON} size={14} /> },
  ];

  const shown = tab === "connections" ? (sort === "az" ? [...lists.connections].sort((a, b) => a.name.localeCompare(b.name, "en")) : lists.connections) : tab === "find" ? [] : lists[tab];
  const count = (key: NetworkTab) => (key === "find" ? null : lists[key].length);

  return (
    <div className="flex min-w-0 flex-col gap-5" data-network>
      <header className="flex flex-col gap-1">
        <h1 className="text-[clamp(1.9rem,4.5vw,2.4rem)] font-semibold leading-[1.05]">Network</h1>
        <p className="text-[0.9rem] text-muted">People you know and people on your line. A connection works both ways and needs the other person to accept. There are no followers and no feed.</p>
      </header>
      {note}

      <div className="flex flex-wrap items-center gap-3 rounded-[14px] border border-line bg-surface px-3.5 py-2.5">
        <span className="min-w-0 flex-1 text-[0.84rem]">
          <b className="block font-semibold">{findMe ? "People can find you by name." : "People can't find you by name."}</b>
          <small className="block text-[0.78rem] text-muted">
            {findMe ? "Signed-in people can find you by name or @handle. Your email and phone never show." : "Turn this on to show in name search. Your connections can always find you."}
          </small>
        </span>
        <Switch checked={findMe} onChange={toggleFindMe} disabled={pending}>
          Let people find me
        </Switch>
      </div>

      <div className="flex min-w-0 flex-col gap-3">
        <div role="tablist" aria-label="Your network" className="flex gap-1 overflow-x-auto border-b border-line">
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
              onClick={() => {
                setTab(t.key);
                setPanel(null);
              }}
              onKeyDown={(e) => onTabKey(e, t.key)}
              className={`flex min-h-11 flex-1 items-center justify-center gap-1.5 whitespace-nowrap border-b-2 px-3 text-[0.86rem] min-[760px]:flex-none ${tab === t.key ? "border-ink font-semibold text-ink" : "border-transparent text-muted hover:text-ink"}`}
            >
              {t.key === "find" && <Search {...ICON} />}
              {t.short ? (
                <>
                  <span className="hidden min-[760px]:inline">{t.label}</span>
                  <span className="min-[760px]:hidden">{t.short}</span>
                </>
              ) : (
                t.label
              )}
              {count(t.key) !== null && (
                <span className={`rounded-full px-1.5 font-mono text-[0.7rem] ${t.key === "requests" && count(t.key) ? "bg-ink text-bg" : "bg-surface-2 text-muted"}`}>{count(t.key)}</span>
              )}
            </button>
          ))}
        </div>

        <div id={`${ids}-panel`} role="tabpanel" aria-labelledby={`${ids}-tab-${tab}`} className="flex min-w-0 flex-col gap-3">
          {tab === "find" ? (
            <form
              role="search"
              className="flex flex-wrap items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                search(query);
              }}
            >
              <label className="flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-full border border-line-strong bg-surface px-3.5 focus-within:outline-2 focus-within:outline-offset-1 focus-within:outline-accent">
                <Search {...ICON} />
                <span className="sr-only">Find people by name or @handle</span>
                <input
                  ref={searchRef}
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Name or @handle"
                  autoComplete="off"
                  enterKeyHint="search"
                  maxLength={80}
                  className="min-w-0 flex-1 bg-transparent text-[0.9rem] outline-none placeholder:text-muted"
                />
              </label>
              <button type="submit" className={ink} aria-disabled={pending || undefined}>
                Search
              </button>
              <div role="group" aria-label="Narrow the results" className="flex basis-full flex-wrap gap-1.5">
                {filterButtons.map((f) => (
                  <button
                    key={f.key}
                    type="button"
                    aria-pressed={filters[f.key]}
                    aria-disabled={pending || undefined}
                    onClick={() => toggleFilter(f.key)}
                    className={`inline-flex min-h-11 items-center gap-1.5 rounded-full border px-3 text-[0.8rem] font-[550] ${filters[f.key] ? "border-ink bg-ink text-bg" : "border-line-strong bg-surface text-ink"}`}
                  >
                    {f.icon}
                    {f.label}
                  </button>
                ))}
              </div>
            </form>
          ) : (
            tab === "connections" &&
            lists.connections.length > 1 && (
              <div role="group" aria-label="Sort connections" className="flex items-center gap-1 text-[0.8rem]">
                <span className="font-mono text-[0.7rem] uppercase text-muted">Sort</span>
                {(["recent", "az"] as const).map((o) => (
                  <button key={o} type="button" aria-pressed={sort === o} onClick={() => setSort(o)} className={`min-h-11 rounded-full px-3 ${sort === o ? "bg-surface-2 font-semibold text-ink" : "text-muted"}`}>
                    {o === "recent" ? "Recent" : "Name A to Z"}
                  </button>
                ))}
              </div>
            )
          )}

          {tab === "find" ? (
            results === null ? (
              <p className="text-[0.82rem] text-muted">Finds your connections and people who turned on &ldquo;Let people find me&rdquo;. Never people you blocked or who blocked you.</p>
            ) : results.length ? (
              <PeopleList rows={results} tab="find" panel={panel} pick={pick} setPick={setPick} setPanel={setPanel} act={act} pending={pending} />
            ) : filtered ? (
              <p className="text-[0.86rem] text-muted">No one found with these filters. Turn one off to see more.</p>
            ) : (
              <p className="text-[0.86rem] text-muted">People who keep &ldquo;Let people find me&rdquo; off can&rsquo;t be found by name. Ask them for their profile link instead.</p>
            )
          ) : shown.length ? (
            <PeopleList rows={shown} tab={tab} panel={panel} pick={pick} setPick={setPick} setPanel={setPanel} act={act} pending={pending} />
          ) : (
            <Empty
              tab={tab}
              profileLink={data.profileLink}
              onFind={() => {
                setTab("find");
                requestAnimationFrame(() => searchRef.current?.focus());
              }}
              onCopied={say}
            />
          )}
        </div>
      </div>

      <p ref={statusRef} tabIndex={-1} role="status" className="text-[0.84rem] text-muted outline-none empty:hidden">
        {message}
      </p>

      <section aria-labelledby={`${ids}-line`} className="flex flex-col gap-2">
        <div className="flex flex-wrap items-baseline gap-2.5">
          <h2 id={`${ids}-line`} className="flex items-center gap-2 text-[1.1rem] font-semibold">
            On your line
            <Tag>Later</Tag>
          </h2>
          {data.myRole && <span className="font-mono text-[0.72rem] text-muted">{data.myRole}</span>}
        </div>
        <p className="text-[0.82rem] text-muted">
          Proposed for after v1: people aiming at the same role who turned on &ldquo;Let people find me&rdquo;, ordered by skills you share, never by anything paid.
        </p>
      </section>

      <section aria-labelledby={`${ids}-mentors`} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 rounded-[14px] border border-dashed border-line px-5 py-4">
        <div>
          <h2 id={`${ids}-mentors`} className="flex flex-wrap items-center gap-2 text-[1.05rem] font-semibold">
            <CalendarDays {...ICON} />
            Mentors
            <Tag>After the beta</Tag>
          </h2>
          <p className="mt-1 max-w-[60ch] text-[0.86rem] text-muted">
            Book an hour with someone who already does the job: role prep, your interview questions, a look at your resume. Mentors come after the beta.
          </p>
        </div>
        <span aria-hidden="true" className="flex">
          {["VR", "PK", "AS"].map((i, n) => (
            <span key={i} className={`grid size-9 place-items-center rounded-full border-2 border-bg bg-surface-2 font-mono text-[0.68rem] font-medium ${n ? "-ml-2" : ""}`}>
              {i}
            </span>
          ))}
        </span>
      </section>
    </div>
  );
}

/** A small mono tag on a heading for what isn't built yet ("Later", "After the beta"). */
function Tag({ children }: { children: ReactNode }) {
  return <span className="rounded-full bg-surface-2 px-[7px] py-px font-mono text-[0.64rem] font-normal uppercase tracking-[0.05em] text-muted">{children}</span>;
}

type Act = Record<"connect" | "send" | "accept" | "ignore" | "withdraw" | "remove" | "block", (p: NetworkRow) => void> & {
  message: (p: NetworkRow, body: string) => void;
  report: (p: NetworkRow, reason: ReportReason, note: string) => void;
};

function PeopleList(props: { rows: NetworkRow[]; tab: NetworkTab; panel: Panel; pick: How; setPick: (h: How) => void; setPanel: (p: Panel) => void; act: Act; pending: boolean }) {
  return (
    <ul className="flex flex-col divide-y divide-line overflow-hidden rounded-[14px] border border-line bg-surface">
      {props.rows.map((p) => (
        <PersonRow key={p.id} person={p} {...props} />
      ))}
    </ul>
  );
}

function PersonRow({ person: p, tab, panel, pick, setPick, setPanel, act, pending }: { person: NetworkRow; tab: NetworkTab; panel: Panel; pick: How; setPick: (h: How) => void; setPanel: (p: Panel) => void; act: Act; pending: boolean }) {
  const open = panel?.id === p.id ? panel.kind : null;
  const busy = pending || undefined;
  const firstName = p.name.split(" ")[0];
  // Cancel closes the panel and puts focus back on the button that opened it, never on the page (WCAG 2.4.3).
  const buttons = useRef<HTMLDivElement>(null);
  const [back, setBack] = useState<{ kind: NonNullable<Panel>["kind"]; n: number } | null>(null);
  useEffect(() => {
    if (back) buttons.current?.querySelector<HTMLButtonElement>(`[data-opens="${back.kind}"]`)?.focus();
  }, [back]);
  const cancel = () => {
    if (open) setBack((b) => ({ kind: open, n: (b?.n ?? 0) + 1 }));
    setPanel(null);
  };
  const initials = p.name
    .split(" ")
    .slice(0, 2)
    .map((w) => w[0] ?? "")
    .join("")
    .toUpperCase();
  return (
    <li className="flex flex-col gap-2 px-3.5 py-3" data-person={p.id}>
      <div className="flex flex-wrap items-start gap-3">
        <span aria-hidden="true" className="grid size-10 shrink-0 place-items-center rounded-full bg-surface-2 font-mono text-[0.72rem] font-medium">
          {initials}
        </span>
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-x-1.5 text-[0.92rem]">
            {p.username ? (
              <Link href={`/u/${p.username}`} className="font-semibold underline-offset-2 hover:underline">
                {p.name}
              </Link>
            ) : (
              <b className="font-semibold">{p.name}</b>
            )}
            {p.verified && (
              <span className="inline-flex items-center" title="At least one proved skill">
                <BadgeCheck {...ICON} />
                <span className="sr-only">, verified</span>
              </span>
            )}
            {p.username && <span className="font-mono text-[0.74rem] text-muted">@{p.username}</span>}
          </p>
          <p className="flex flex-wrap gap-x-2 text-[0.8rem] text-muted">
            {p.aim && <span>Aiming for {p.aim}</span>}
            {p.city && <span>{p.city}</span>}
            <span>
              {p.common} shared skill{p.common === 1 ? "" : "s"}
            </span>
            {p.mutual > 0 && (
              <span>
                {p.mutual} mutual connection{p.mutual === 1 ? "" : "s"}
              </span>
            )}
          </p>
          {(p.how || p.when) && (
            <p className="flex flex-wrap gap-x-2 text-[0.78rem] text-muted">
              {p.how && (
                <span className="inline-flex items-center gap-1">
                  <Users {...ICON} size={14} />
                  {tab === "requests" ? "Says: " : ""}
                  {CONNECTION_HOW_LABELS[p.how]}
                </span>
              )}
              {p.when && <span>{p.when}</span>}
            </p>
          )}
        </div>
        <div ref={buttons} className="flex flex-wrap items-center gap-1.5 max-[759px]:basis-full">
          {p.state === "connected" ? (
            <>
              <button type="button" className={ghost} aria-disabled={busy} aria-expanded={open === "message"} data-opens="message" onClick={() => setPanel({ id: p.id, kind: "message" })}>
                <MessageSquare {...ICON} />
                Message<span className="sr-only"> {p.name}</span>
              </button>
              <button type="button" className={quiet} aria-disabled={busy} aria-expanded={open === "remove"} data-opens="remove" onClick={() => setPanel({ id: p.id, kind: "remove" })}>
                <UserMinus {...ICON} />
                Remove<span className="sr-only"> {p.name}</span>
              </button>
            </>
          ) : p.state === "incoming" ? (
            <>
              <button type="button" className={ink} aria-disabled={busy} onClick={() => act.accept(p)}>
                Accept<span className="sr-only"> {p.name}</span>
              </button>
              <button type="button" className={quiet} aria-disabled={busy} onClick={() => act.ignore(p)}>
                Ignore<span className="sr-only"> {p.name}</span>
              </button>
            </>
          ) : p.state === "requested" ? (
            <>
              <span className="inline-flex min-h-11 items-center gap-1.5 px-1 text-[0.82rem] font-medium text-muted">
                <Clock {...ICON} />
                Requested
              </span>
              <button type="button" className={quiet} aria-disabled={busy} aria-expanded={open === "withdraw"} data-opens="withdraw" onClick={() => setPanel({ id: p.id, kind: "withdraw" })}>
                Withdraw<span className="sr-only"> request to {p.name}</span>
              </button>
            </>
          ) : (
            <button type="button" className={ink} aria-disabled={busy} aria-expanded={open === "pick"} data-opens="pick" onClick={() => act.connect(p)}>
              <Plus {...ICON} />
              Connect<span className="sr-only"> with {p.name}</span>
            </button>
          )}
          <button type="button" className={quiet} aria-disabled={busy} aria-expanded={open === "block"} data-opens="block" onClick={() => setPanel({ id: p.id, kind: "block" })}>
            <Ban {...ICON} />
            Block<span className="sr-only"> {p.name}</span>
          </button>
          <button type="button" className={quiet} aria-disabled={busy} aria-expanded={open === "report"} data-opens="report" onClick={() => setPanel({ id: p.id, kind: "report" })}>
            <Flag {...ICON} />
            Report<span className="sr-only"> {p.name}</span>
          </button>
        </div>
      </div>

      {open === "pick" && (
        <div role="group" aria-label={`How you know ${p.name}`} className="flex flex-col gap-2 rounded-md bg-surface-2 p-3">
          <b className="text-[0.86rem]">How do you know {firstName}?</b>
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
          <small className="text-[0.78rem] text-muted">
            {firstName} sees this with your name and shared skills. Requests carry no message. You can send 20 a day.
          </small>
          <div className="flex flex-wrap gap-1.5">
            <button type="button" className={ink} aria-disabled={busy} onClick={() => act.send(p)}>
              Send request
            </button>
            <button type="button" className={quiet} onClick={cancel}>
              Cancel
            </button>
          </div>
        </div>
      )}
      {open === "withdraw" && (
        <Confirm
          title={`Withdraw your request to ${p.name}?`}
          body={`${firstName} isn't told. You can ask again 30 days after you sent it.`}
          yes="Withdraw"
          onYes={() => act.withdraw(p)}
          onNo={cancel}
          busy={busy}
        />
      )}
      {open === "message" && <MessageBox name={firstName} busy={busy} onSend={(body) => act.message(p, body)} onCancel={cancel} />}
      {open === "remove" && (
        <Confirm
          title={`Remove ${p.name} from your connections?`}
          body={`${firstName} isn't told. What only connections see ends for both of you. Either of you can connect again later.`}
          yes="Remove"
          onYes={() => act.remove(p)}
          onNo={cancel}
          busy={busy}
        />
      )}
      {open === "report" && <ReportPerson name={p.name} busy={busy} onSend={(reason, note) => act.report(p, reason, note)} onCancel={cancel} />}
      {open === "block" && (
        <Confirm
          title={`Block ${p.name}?`}
          body="You disappear from each other's search, lists and profiles, any connection or request between you ends, and neither of you can message the other. They aren't told."
          yes="Block"
          onYes={() => act.block(p)}
          onNo={cancel}
          busy={busy}
        />
      )}
    </li>
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

function Empty({ tab, profileLink, onFind, onCopied }: { tab: NetworkTab; profileLink: string | null; onFind: () => void; onCopied: (text: string) => void }) {
  if (tab === "requests") return <EmptyBox title="No requests waiting">When someone asks to connect, it shows here and as a count next to Network. Requests you ignore end quietly; the sender isn&rsquo;t told.</EmptyBox>;
  if (tab === "sent") return <EmptyBox title="No requests sent">Requests you send wait here until they are accepted, withdrawn, or 30 days pass.</EmptyBox>;
  return (
    <EmptyBox title="No connections yet">
      Find people you already know by name. Connections can see your gaps if you share them with connections.
      <span className="mt-2 flex flex-wrap gap-1.5">
        <button type="button" className={ink} onClick={onFind}>
          <Search {...ICON} />
          Find someone you know
        </button>
        {profileLink && (
          <button
            type="button"
            className={ghost}
            onClick={() => {
              const link = `${window.location.origin}${profileLink}`;
              if (!navigator.clipboard) {
                onCopied(`Your profile link: ${link}`);
                return;
              }
              navigator.clipboard.writeText(link).then(
                () => onCopied("Your profile link is copied."),
                () => onCopied(`Your profile link: ${link}`),
              );
            }}
          >
            <Link2 {...ICON} />
            Copy your profile link
          </button>
        )}
      </span>
    </EmptyBox>
  );
}

function EmptyBox({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1 rounded-[14px] border border-dashed border-line px-4 py-5">
      <h2 className="text-[0.95rem] font-semibold">{title}</h2>
      <p className="flex flex-col text-[0.84rem] text-muted">{children}</p>
    </div>
  );
}
