"use client";

import { ChevronDown } from "lucide-react";
import { useEffect, useState, type RefObject } from "react";
import { LIST_PAGE_SIZE } from "@/lib/schemas/constants";

/**
 * Paging for a list that can grow long (Testing Run 7, T147): the first LIST_PAGE_SIZE rows, then each "Show more"
 * adds that many. Client state only: the store still returns every row. When `resetKey` changes (a tab, filter or
 * sort), the list starts again from its first page.
 */
export function usePaged<T>(items: T[], resetKey: string | number | null = null, page = LIST_PAGE_SIZE) {
  const [state, setState] = useState({ key: resetKey, limit: page });
  const limit = state.key === resetKey ? state.limit : page;
  return {
    shown: items.length > limit ? items.slice(0, limit) : items,
    left: Math.max(0, items.length - limit),
    more: () => setState({ key: resetKey, limit: limit + page }),
  };
}

/**
 * The "Show more" button under a paged list. `list` is the list element whose children are the rows and `shown` how
 * many of them show now. After a click, focus moves to the first new row (its first link or button), so it never
 * drops to the page when the last page shows and the button goes away; so render it always, not behind `left > 0`.
 * `noun` names the rows ("chats", "jobs"), so two lists on one page never share a button name. `className` styles
 * the box around the button. `focusRow`, where the rows are not the list's children or a row's first control can be
 * hidden (inside a closed details), picks the element to focus instead; it gets tabindex -1 when it can't take focus.
 * Pass a function declared outside the component, so it stays the same between renders.
 */
export function ShowMore({
  left,
  shown,
  onMore,
  list,
  noun,
  className = "flex",
  focusRow,
}: {
  left: number;
  shown: number;
  onMore: () => void;
  list: RefObject<HTMLElement | null>;
  noun: string;
  className?: string;
  focusRow?: (list: HTMLElement, index: number) => HTMLElement | null;
}) {
  const [focusAt, setFocusAt] = useState<{ index: number; n: number } | null>(null);
  useEffect(() => {
    if (!focusAt) return;
    if (focusRow) {
      const el = list.current ? focusRow(list.current, focusAt.index) : null;
      if (!el) return;
      if (el.tabIndex < 0) el.setAttribute("tabindex", "-1");
      el.focus();
      return;
    }
    const row = list.current?.children[focusAt.index];
    if (!(row instanceof HTMLElement)) return;
    const target = row.querySelector<HTMLElement>("a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex='-1'])");
    if (target) target.focus();
    else {
      row.setAttribute("tabindex", "-1");
      row.focus();
    }
  }, [focusAt, list, focusRow]);
  if (left <= 0) return null;
  return (
    <div className={className}>
      <button
        type="button"
        onClick={() => {
          setFocusAt((f) => ({ index: shown, n: (f?.n ?? 0) + 1 }));
          onMore();
        }}
        className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-line bg-surface px-3.5 py-2 text-[0.84rem] font-medium text-ink hover:bg-surface-2"
      >
        <ChevronDown size={16} strokeWidth={1.75} aria-hidden="true" />
        Show more {noun}
        <span className="font-mono text-[0.72rem] font-normal text-muted">{left} left</span>
      </button>
    </div>
  );
}
