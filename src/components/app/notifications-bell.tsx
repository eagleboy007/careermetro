"use client";

import { Bell, CalendarCheck, CalendarX, CircleX, MoveRight, UserCheck, UserPlus, X, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { NOTIFICATIONS_EMPTY, type NotificationKind } from "@/lib/schemas/constants";
import { exampleNotifications } from "@/lib/notifications/fixtures";
import { bellLabel } from "@/lib/notifications/rules";
import type { NotificationView, OpenNotifications } from "@/lib/notifications/types";

const ICONS: Record<NotificationKind, LucideIcon> = {
  connection_request: UserPlus,
  connection_accepted: UserCheck,
  application_moved: MoveRight,
  application_closed: CircleX,
  interview_scheduled: CalendarCheck,
  interview_cancelled: CalendarX,
};

/** Example data, for the example shell and /design: nothing is read or marked. */
const examples: OpenNotifications = async () => ({ items: exampleNotifications });

type Panel = { state: "loading" } | { state: "error"; message: string } | { state: "ready"; items: NotificationView[] };

/**
 * The bell in the top bar (docs/plans/notifications-plan.md, v44 gap item 15). A disclosure button: its label says how
 * many are new ("Notifications, 2 new") and a small ink dot shows while any are (cobalt stays for progress). Opening it
 * reads the newest notifications from the server, which marks them all read, so the dot clears; rows that were new stay
 * bold until the panel closes. Esc and Close shut it and put focus back on the bell, as clicking outside does unless it
 * lands on another control. At phone width the panel fills the screen under the top bar.
 */
export function NotificationsBell({
  count,
  open: load = examples,
  startItems,
}: {
  count: number;
  open?: OpenNotifications;
  /** /design only: the panel shown open from the start with these rows. */
  startItems?: NotificationView[];
}) {
  // On /design the panel sits in the page: it starts open and doesn't listen for clicks or keys elsewhere.
  const inPage = !!startItems;
  const [expanded, setExpanded] = useState(inPage);
  // The dot clears once the panel has loaded; a new count from the server (a page load or refresh) shows again.
  const [cleared, setCleared] = useState(false);
  const [shownCount, setShownCount] = useState(count);
  if (count !== shownCount) {
    setShownCount(count);
    setCleared(false);
  }
  const fresh = cleared ? 0 : count;
  const [panel, setPanel] = useState<Panel>(startItems ? { state: "ready", items: startItems } : { state: "loading" });
  const [focusTick, setFocusTick] = useState(0);
  const panelId = useId();
  const wrap = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const asked = useRef(0);

  const fetchRows = () => {
    const ask = ++asked.current;
    setPanel({ state: "loading" });
    load()
      .catch(() => ({ error: "Notifications can't be shown just now. Please try again." }))
      .then((r) => {
        if (ask !== asked.current) return;
        if ("error" in r) return setPanel({ state: "error", message: r.error });
        setPanel({ state: "ready", items: r.items });
        setCleared(true);
      });
  };

  const close = useCallback((refocus: boolean) => {
    setExpanded(false);
    // What was new is now read: next time it opens, nothing reads as new unless it came since.
    setPanel((p) => (p.state === "ready" ? { state: "ready", items: p.items.map((n) => ({ ...n, isNew: false })) } : p));
    if (refocus) setFocusTick((t) => t + 1);
  }, []);

  useEffect(() => {
    if (focusTick) button.current?.focus();
  }, [focusTick]);

  useEffect(() => {
    if (!expanded || inPage) return;
    const onClick = (e: MouseEvent) => {
      if (wrap.current?.contains(e.target as Node)) return;
      // Clicking a control elsewhere keeps its focus; clicking the page itself puts focus back on the bell.
      const target = e.target as HTMLElement | null;
      close(!target?.closest("a, button, input, select, textarea, [tabindex]"));
    };
    const onFocus = (e: FocusEvent) => {
      if (!wrap.current?.contains(e.target as Node)) close(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close(true);
    };
    document.addEventListener("click", onClick);
    document.addEventListener("focusin", onFocus);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("click", onClick);
      document.removeEventListener("focusin", onFocus);
      document.removeEventListener("keydown", onKey);
    };
  }, [expanded, inPage, close]);

  const toggle = () => {
    if (expanded) return close(false);
    setExpanded(true);
    fetchRows();
  };

  return (
    <div ref={wrap} className="relative">
      <button
        ref={button}
        type="button"
        data-bell=""
        aria-expanded={expanded}
        aria-controls={panelId}
        aria-label={bellLabel(fresh)}
        onClick={toggle}
        className="relative grid size-9 place-items-center rounded-full border border-line bg-surface text-ink hover:bg-surface-2 aria-expanded:bg-surface-2"
      >
        <Bell size={20} strokeWidth={1.75} aria-hidden="true" />
        {fresh > 0 && <span aria-hidden="true" data-bell-dot="" className="absolute right-[7px] top-[6px] box-content size-[7px] rounded-full border-2 border-surface bg-ink" />}
      </button>
      <div
        id={panelId}
        hidden={!expanded}
        className={
          inPage
            ? // On /design: in the page, not over it.
              "mt-2 flex w-full max-w-[360px] flex-col rounded-md border border-line bg-surface"
            : // A height, not bottom-0: the top bar's backdrop blur makes it the box a fixed panel is placed in. The bottom
              // padding keeps the last row clear of the tab bar.
              "shadow-raised fixed inset-x-0 top-[61px] z-30 flex h-[calc(100dvh-61px)] flex-col overflow-y-auto border-t border-line bg-surface pb-[calc(64px+env(safe-area-inset-bottom))] min-[760px]:absolute min-[760px]:pb-0 min-[760px]:inset-x-auto min-[760px]:right-0 min-[760px]:h-auto min-[760px]:top-[calc(100%+8px)] min-[760px]:max-h-[min(560px,calc(100vh-96px))] min-[760px]:w-[360px] min-[760px]:rounded-md min-[760px]:border"
        }
      >
        <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-2.5">
          <h2 className="font-display text-[1rem] font-semibold">
            Notifications
          </h2>
          <button type="button" onClick={() => close(true)} className="grid size-9 place-items-center rounded-full text-muted hover:bg-surface-2 hover:text-ink" aria-label="Close notifications">
            <X size={18} strokeWidth={1.75} aria-hidden="true" />
          </button>
        </div>
        {panel.state === "loading" ? (
          <p role="status" className="px-4 py-5 text-[0.86rem] text-muted">
            Getting your notifications…
          </p>
        ) : panel.state === "error" ? (
          <p role="alert" className="px-4 py-5 text-[0.86rem] text-ink">
            {panel.message}
          </p>
        ) : panel.items.length === 0 ? (
          <p className="px-4 py-5 text-[0.86rem] text-muted">{NOTIFICATIONS_EMPTY}</p>
        ) : (
          <ul className="flex flex-col py-1">
            {panel.items.map((n) => {
              const Icon = ICONS[n.kind];
              return (
                <li key={n.id}>
                  <Link
                    href={n.href}
                    onClick={() => close(false)}
                    className="flex items-start gap-3 px-4 py-2.5 hover:bg-surface-2 focus-visible:bg-surface-2"
                    data-notification-new={n.isNew ? "" : undefined}
                  >
                    <span aria-hidden="true" className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-full bg-surface-2 text-ink">
                      <Icon size={16} strokeWidth={1.75} />
                    </span>
                    <span className="flex min-w-0 flex-col gap-0.5">
                      <span className={`text-[0.86rem] leading-snug ${n.isNew ? "font-semibold text-ink" : "text-ink"}`}>
                        {n.isNew && <span className="sr-only">New: </span>}
                        {n.text}
                      </span>
                      <span className="font-mono text-[0.68rem] text-muted">{n.when}</span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
