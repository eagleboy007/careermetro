"use client";

import { Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, useTransition, type KeyboardEvent } from "react";
import { searchMarket, type MarketChoice } from "@/lib/market/search";

/*
 * The Market's controls (handoff C6). Each choice is a link to the same screen with the address changed, so the
 * server works out the figures and nothing is stored. Navigation runs in a transition: the screen stays as it is,
 * focus included, until the new figures are in.
 */

const ICON = { strokeWidth: 1.75, "aria-hidden": true } as const;
export const field =
  "min-h-11 w-full min-w-0 rounded-full border border-line bg-surface px-3.5 text-[0.88rem] text-ink hover:border-muted focus-visible:border-ink";

function useGo() {
  const router = useRouter();
  const [pending, start] = useTransition();
  return { pending, go: (href: string) => start(() => router.push(href, { scroll: false })) };
}

export type PickOption = { label: string; href: string };
export type PickGroup = { label: string; options: PickOption[] };

/** How long a run of arrow or type-ahead steps must pause before the select's choice counts as made. */
const KEY_SETTLE_MS = 700;

/**
 * A labelled select whose options are addresses: picking one shows it. A pick with the pointer (or from the open
 * list) goes at once. Arrow keys and type-ahead on a closed select change it one step at a time, so those wait until
 * Enter, leaving the select, or a short pause, instead of loading the page for every step. The select keeps showing
 * the person's choice while the new figures load.
 */
export function MarketSelect({ label, value, options, groups = [], className = "" }: { label: string; value: string; options?: PickOption[]; groups?: PickGroup[]; className?: string }) {
  const { go, pending } = useGo();
  const id = useId();
  const [local, setLocal] = useState(value);
  const [seen, setSeen] = useState(value);
  const lastKey = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // The address changed (this pick landed, or something else moved): show what the server says.
  if (value !== seen) {
    setSeen(value);
    setLocal(value);
  }
  useEffect(() => () => clearTimeout(timer.current), []);
  // The last address this select asked for, so leaving it after a pick doesn't ask again.
  const sent = useRef<string | null>(null);
  const commit = (next: string) => {
    clearTimeout(timer.current);
    if (next === value || next === sent.current) return;
    sent.current = next;
    go(next);
  };
  return (
    <div className={`flex min-w-0 flex-col gap-1 ${className}`}>
      <label htmlFor={id} className="font-mono text-[0.68rem] uppercase tracking-[0.06em] text-muted">
        {label}
      </label>
      <select
        id={id}
        value={local}
        aria-busy={pending || undefined}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit(local);
          else lastKey.current = Date.now();
        }}
        onChange={(e) => {
          const next = e.target.value;
          setLocal(next);
          clearTimeout(timer.current);
          if (Date.now() - lastKey.current < 100) timer.current = setTimeout(() => commit(next), KEY_SETTLE_MS);
          else commit(next);
        }}
        onBlur={() => commit(local)}
        className={`${field} cursor-pointer`}
      >
        {options?.map((o) => (
          <option key={o.href} value={o.href}>
            {o.label}
          </option>
        ))}
        {groups.map((g) => (
          <optgroup key={g.label} label={g.label}>
            {g.options.map((o) => (
              <option key={o.href} value={o.href}>
                {o.label}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    </div>
  );
}

export type SearchChoice = MarketChoice & { href: string };

/**
 * Search by role, state or city: a combobox (ARIA 1.2 pattern). Up and Down move through the matches, Enter picks the
 * highlighted one (or the first), Escape closes the list.
 */
export function MarketSearch({ choices }: { choices: SearchChoice[] }) {
  const { go } = useGo();
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const listId = useId();
  const statusId = useId();
  const matches = open ? (searchMarket(choices, text) as SearchChoice[]) : [];
  const pick = (c: SearchChoice | undefined) => {
    if (!c) return;
    setText("");
    setOpen(false);
    setActive(-1);
    go(c.href);
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (!matches.length) return;
      e.preventDefault();
      setOpen(true);
      setActive((a) => (a + (e.key === "ArrowDown" ? 1 : -1) + matches.length) % matches.length);
    } else if (e.key === "Enter") {
      if (!text.trim()) return;
      e.preventDefault();
      pick(matches[active] ?? matches[0]);
    } else if (e.key === "Escape") {
      setOpen(false);
      setActive(-1);
    }
  };
  const said = !open || !text.trim() ? "" : matches.length ? `${matches.length} ${matches.length === 1 ? "match" : "matches"}` : "No role, state or city matches. Try SOC, Pune or Kerala.";
  return (
    <div className="relative min-w-0">
      <div className="flex min-h-11 items-center gap-2.5 rounded-full border border-line bg-surface px-4 focus-within:border-ink">
        <Search size={18} {...ICON} className="shrink-0 text-muted" />
        <input
          type="search"
          role="combobox"
          aria-label="Search a role, state or city"
          aria-expanded={matches.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={active >= 0 && matches[active] ? `${listId}-${active}` : undefined}
          aria-describedby={statusId}
          autoComplete="off"
          placeholder="Search a role, state or city"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setOpen(true);
            setActive(-1);
          }}
          onKeyDown={onKey}
          onBlur={() => setOpen(false)}
          onFocus={() => setOpen(true)}
          className="min-h-11 min-w-0 flex-1 bg-transparent text-[0.92rem] text-ink outline-none placeholder:text-muted"
        />
      </div>
      <ul
        id={listId}
        role="listbox"
        aria-label="Matches"
        hidden={!matches.length}
        className="shadow-raised absolute inset-x-0 top-[calc(100%+6px)] z-10 flex max-h-72 flex-col overflow-auto rounded-md border border-line bg-surface p-1.5"
      >
        {matches.map((c, i) => (
          <li
            key={c.href}
            id={`${listId}-${i}`}
            role="option"
            aria-selected={i === active}
            // Pressing on an option must not blur the input first, or the list closes before the click lands.
            onMouseDown={(e) => {
              e.preventDefault();
              pick(c);
            }}
            className="flex min-h-11 cursor-pointer items-center gap-2.5 rounded-sm px-2.5 text-[0.9rem] hover:bg-surface-2 aria-selected:bg-surface-2"
          >
            <span className="min-w-0 flex-1 truncate">{c.label}</span>
            <span className="shrink-0 font-mono text-[0.66rem] uppercase tracking-[0.05em] text-muted">{c.hint}</span>
          </li>
        ))}
      </ul>
      {/* The match count is for screen readers; "no matches" shows for everyone. */}
      <p id={statusId} role="status" className={matches.length ? "sr-only" : "px-4 pt-1.5 text-[0.82rem] text-muted empty:p-0"}>
        {said}
      </p>
    </div>
  );
}
