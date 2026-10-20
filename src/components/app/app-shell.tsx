"use client";

import { Award, Lock, LogOut, MessageSquare, User } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { StreakChip } from "@/components/today/streak-chip";
import { Logo } from "@/components/ui/logo";
import { ADMIN_LINK, MENU_NAV, TAB_NAV, TOP_NAV, type NavItem } from "./nav-items";

export type ShellUser = {
  name: string;
  initials: string;
  streakDays: number;
  todayCounted: boolean;
  showStreak: boolean;
  /** False on example data, where there is no session to end. */
  canSignOut: boolean;
  /** Unread chats and message requests, for the badge on the Inbox icon. */
  inboxUnread: number;
  /** Unread company chats for someone with a company role (corporate build step 7): a count on Corporate in the menu. */
  corporateUnread?: number;
  /** Connection requests waiting on the person (FR-49): a count on Network in the menu. */
  networkRequests?: number;
  /** CareerMetro's own admins (ADMIN_EMAILS), worked out on the server: the menu shows Admin. */
  isAdmin?: boolean;
  /** Elite is on (FR-50): the award mark on the avatar and "Elite · beta" in the menu. */
  elite?: boolean;
};

/**
 * The signed-in frame: top bar with the main sections on desktop, a tab bar on phones (under 760 px), and the avatar
 * menu. Sections that are not built yet show as "Soon" and are not links. With no user yet (the account is still
 * loading) the frame shows with an empty avatar, so a screen never opens blank.
 */
export function AppShell({ user, children, embedded = false }: { user: ShellUser | null; children: ReactNode; embedded?: boolean }) {
  const path = usePathname();
  const active = (item: NavItem) => path === item.href || path.startsWith(`${item.href}/`);
  return (
    <div className={`flex flex-col ${embedded ? "relative min-h-full" : "min-h-full"}`}>
      <header className="sticky top-0 z-20 border-b border-line bg-bg/90 backdrop-blur">
        <div className="mx-auto flex w-full max-w-[1240px] items-center gap-4 px-4 py-3">
          <Link href="/today" aria-label="CareerMetro, Today">
            <Logo wordmarkClassName="max-[359px]:hidden" />
          </Link>
          <nav aria-label="Main" className="hidden flex-1 items-center gap-1 text-sm min-[760px]:flex">
            {TOP_NAV.map((item) => (
              <TopLink key={item.key} item={item} active={active(item)} />
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-2.5">
            {user?.showStreak && <StreakChip days={user.streakDays} todayCounted={user.todayCounted} />}
            <InboxLink unread={user?.inboxUnread ?? 0} active={path === "/inbox" || path.startsWith("/inbox/")} />
            {user ? <AvatarMenu user={user} /> : <span aria-hidden="true" className="size-9 rounded-full bg-surface-2" />}
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-[1240px] flex-1 px-4 pb-24 pt-6 min-[760px]:pb-10">{children}</main>
      <nav
        aria-label="Main tabs"
        className={`${embedded ? "absolute" : "fixed"} inset-x-0 bottom-0 z-20 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] min-[760px]:hidden`}
      >
        <ul className="grid grid-cols-5">
          {TAB_NAV.map((item) => (
            <li key={item.key}>
              <TabLink item={item} active={active(item)} />
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}

/** The message icon on every screen (handoff 12b), with the unread count. */
function InboxLink({ unread, active }: { unread: number; active: boolean }) {
  return (
    <Link
      href="/inbox"
      aria-current={active ? "page" : undefined}
      aria-label={unread ? `Inbox, ${unread} unread` : "Inbox"}
      className="relative grid size-9 place-items-center rounded-full border border-line bg-surface text-ink hover:bg-surface-2 aria-[current=page]:bg-surface-2"
    >
      <MessageSquare size={20} strokeWidth={1.75} aria-hidden="true" />
      {unread > 0 && (
        <span
          aria-hidden="true"
          className="absolute -right-[5px] -top-1 box-content grid h-[17px] min-w-[17px] place-items-center rounded-full border-2 border-surface bg-ink px-1 font-mono text-[0.62rem] text-surface"
        >
          {unread}
        </span>
      )}
    </Link>
  );
}

function TopLink({ item, active }: { item: NavItem; active: boolean }) {
  if (!item.built) {
    return (
      // A link that isn't built yet: disabled controls are exempt from the contrast minimum, and screen readers say so.
      <span role="link" aria-disabled="true" className="cursor-default rounded-full px-3 py-1.5 text-muted/70">
        {item.label}
        <span className="sr-only">, coming soon</span>
      </span>
    );
  }
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      // Market is in the avatar menu too, so the top bar keeps it only where there is room for it.
      className={`rounded-full px-3 py-1.5 font-medium ${active ? "bg-surface-2 text-ink" : "text-muted hover:text-ink"} ${item.key === "market" ? "max-[999px]:hidden" : ""}`}
    >
      {item.label}
    </Link>
  );
}

function TabLink({ item, active }: { item: NavItem; active: boolean }) {
  const body = (
    <>
      <item.Icon size={20} strokeWidth={1.75} aria-hidden="true" />
      <span>{item.label}</span>
    </>
  );
  const base = "flex flex-col items-center gap-0.5 py-2 text-[0.68rem] font-medium";
  if (!item.built) {
    return (
      <span role="link" aria-disabled="true" className={`${base} text-muted/60`}>
        {body}
        <span className="sr-only">, coming soon</span>
      </span>
    );
  }
  return (
    <Link href={item.href} aria-current={active ? "page" : undefined} className={`${base} ${active ? "text-ink" : "text-muted"}`}>
      {body}
    </Link>
  );
}

function AvatarMenu({ user }: { user: ShellUser }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const wrap = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    const onFocus = (e: FocusEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("focusin", onFocus);
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      button.current?.focus();
    };
    document.addEventListener("click", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("click", onClick);
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("focusin", onFocus);
    };
  }, [open]);

  const row = "flex items-center gap-2.5 rounded-sm px-2.5 py-2 text-sm";
  const corporateUnread = user.corporateUnread ?? 0;
  const networkRequests = user.networkRequests ?? 0;
  const counts: Partial<Record<NavItem["key"], { n: number; words: string }>> = {
    corporate: { n: corporateUnread, words: "unread" },
    network: { n: networkRequests, words: networkRequests === 1 ? "connection request" : "connection requests" },
  };
  return (
    <div ref={wrap} className="relative">
      <button
        ref={button}
        type="button"
        aria-expanded={open}
        aria-controls={menuId}
        // Starts with the initials it shows (WCAG 2.5.3, label in name).
        aria-label={`${user.initials}: ${user.name}${user.elite ? ", Elite" : ""}, open menu${corporateUnread ? `, Corporate ${corporateUnread} unread` : ""}${networkRequests ? `, Network ${networkRequests} ${counts.network!.words}` : ""}`}
        onClick={() => setOpen((o) => !o)}
        className="relative grid size-9 place-items-center rounded-full bg-ink font-mono text-[0.72rem] font-medium text-bg"
      >
        {user.initials}
        {corporateUnread + networkRequests > 0 && <span aria-hidden="true" className="absolute -right-0.5 -top-0.5 size-2.5 rounded-full border-2 border-bg bg-ink" />}
        {user.elite && (
          <span aria-hidden="true" data-elite-mark="" className="absolute -bottom-1 -right-1 grid size-[18px] place-items-center rounded-full border-2 border-bg bg-elite text-on-elite">
            <Award size={10} strokeWidth={1.75} />
          </span>
        )}
      </button>
      <div
        id={menuId}
        hidden={!open}
        className="shadow-raised absolute right-0 top-[calc(100%+8px)] z-30 flex w-56 flex-col gap-0.5 rounded-md border border-line bg-surface p-1.5"
      >
        <div className="flex flex-col items-start gap-1.5 px-2.5 pb-1.5 pt-1">
          <p className="text-sm font-semibold">{user.name}</p>
          <span
            className={`rounded-full px-2 py-0.5 font-mono text-[0.62rem] uppercase tracking-[0.06em] ${user.elite ? "bg-elite text-on-elite" : "bg-surface-2 text-muted"}`}
          >
            {user.elite ? "Elite · beta" : "Free"}
          </span>
        </div>
        <ul className="flex flex-col gap-0.5">
          <li>
            <Link href="/me" onClick={() => setOpen(false)} className={`${row} hover:bg-surface-2`}>
              <User size={16} strokeWidth={1.75} aria-hidden="true" />
              Your profile
            </Link>
          </li>
          <li>
            <Link href="/settings" onClick={() => setOpen(false)} className={`${row} hover:bg-surface-2`}>
              <Lock size={16} strokeWidth={1.75} aria-hidden="true" />
              Account settings
            </Link>
          </li>
          <li>
            <Link href="/elite" onClick={() => setOpen(false)} aria-current={path === "/elite" ? "page" : undefined} className={`${row} hover:bg-surface-2`}>
              <Award size={16} strokeWidth={1.75} aria-hidden="true" />
              {user.elite ? "Elite is on" : "Elite, free in the beta"}
            </Link>
          </li>
          {MENU_NAV.map((item) =>
            item.built ? (
              <li key={item.key}>
                <Link href={item.href} onClick={() => setOpen(false)} aria-current={path === item.href ? "page" : undefined} className={`${row} hover:bg-surface-2`}>
                  <item.Icon size={16} strokeWidth={1.75} aria-hidden="true" />
                  {item.label}
                  {(counts[item.key]?.n ?? 0) > 0 && (
                    <span className="ml-auto grid h-[18px] min-w-[18px] place-items-center rounded-full bg-ink px-1 font-mono text-[0.62rem] text-bg">
                      {counts[item.key]!.n}
                      <span className="sr-only"> {counts[item.key]!.words}</span>
                    </span>
                  )}
                </Link>
              </li>
            ) : (
              <li key={item.key} className={`${row} text-muted ${item.key === "timetable" ? "min-[760px]:hidden" : ""}`}>
                <item.Icon size={16} strokeWidth={1.75} aria-hidden="true" />
                {item.label} <Soon />
              </li>
            ),
          )}
          {user.isAdmin && (
            <li className="border-t border-line pt-0.5">
              <Link href={ADMIN_LINK.href} onClick={() => setOpen(false)} aria-current={path.startsWith("/admin") ? "page" : undefined} className={`${row} hover:bg-surface-2`}>
                <ADMIN_LINK.Icon size={16} strokeWidth={1.75} aria-hidden="true" />
                {ADMIN_LINK.label}
              </Link>
            </li>
          )}
          <li className="border-t border-line pt-0.5">
            {user.canSignOut ? (
              <form method="post" action="/auth/sign-out">
                <button type="submit" className={`${row} w-full text-left hover:bg-surface-2`}>
                  <LogOut size={16} strokeWidth={1.75} aria-hidden="true" />
                  Sign out
                </button>
              </form>
            ) : (
              <span className={`${row} text-muted`}>
                <LogOut size={16} strokeWidth={1.75} aria-hidden="true" />
                Sign out <Soon />
              </span>
            )}
          </li>
        </ul>
      </div>
    </div>
  );
}

function Soon() {
  return (
    <span className="ml-auto font-mono text-[0.62rem] uppercase">
      <span aria-hidden="true">Soon</span>
      <span className="sr-only">, coming soon</span>
    </span>
  );
}
