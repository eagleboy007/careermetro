"use client";

import { LogOut, User } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { StreakChip } from "@/components/today/streak-chip";
import { Logo } from "@/components/ui/logo";
import { MENU_NAV, TAB_NAV, TOP_NAV, type NavItem } from "./nav-items";

export type ShellUser = {
  name: string;
  initials: string;
  streakDays: number;
  todayCounted: boolean;
  showStreak: boolean;
  /** False on example data, where there is no session to end. */
  canSignOut: boolean;
};

/**
 * The signed-in frame: top bar with the main sections on desktop, a tab bar on phones (under 760 px), and the avatar
 * menu. Sections that are not built yet show as "Soon" and are not links.
 */
export function AppShell({ user, children, embedded = false }: { user: ShellUser; children: ReactNode; embedded?: boolean }) {
  const path = usePathname();
  const active = (item: NavItem) => path === item.href || path.startsWith(`${item.href}/`);
  return (
    <div className={`flex flex-col ${embedded ? "relative min-h-full" : "min-h-full"}`}>
      <header className="sticky top-0 z-20 border-b border-line bg-bg/90 backdrop-blur">
        <div className="mx-auto flex w-full max-w-[1240px] items-center gap-4 px-4 py-3">
          <Link href="/today" aria-label="CareerMetro, Today">
            <Logo />
          </Link>
          <nav aria-label="Main" className="hidden flex-1 items-center gap-1 text-sm min-[760px]:flex">
            {TOP_NAV.map((item) => (
              <TopLink key={item.key} item={item} active={active(item)} />
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-2.5">
            {user.showStreak && <StreakChip days={user.streakDays} todayCounted={user.todayCounted} />}
            <AvatarMenu user={user} />
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

function TopLink({ item, active }: { item: NavItem; active: boolean }) {
  if (!item.built) {
    return (
      <span className="cursor-default rounded-full px-3 py-1.5 text-muted/70">
        {item.label}
        <span className="sr-only">, coming soon</span>
      </span>
    );
  }
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={`rounded-full px-3 py-1.5 font-medium ${active ? "bg-surface-2 text-ink" : "text-muted hover:text-ink"}`}
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
      <span className={`${base} text-muted/60`}>
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
  return (
    <div ref={wrap} className="relative">
      <button
        ref={button}
        type="button"
        aria-expanded={open}
        aria-controls={menuId}
        aria-label={`${user.name}, open menu`}
        onClick={() => setOpen((o) => !o)}
        className="grid size-9 place-items-center rounded-full bg-ink font-mono text-[0.72rem] font-medium text-bg"
      >
        {user.initials}
      </button>
      <div
        id={menuId}
        hidden={!open}
        className="shadow-raised absolute right-0 top-[calc(100%+8px)] z-30 flex w-56 flex-col gap-0.5 rounded-md border border-line bg-surface p-1.5"
      >
        <p className="px-2.5 pb-1.5 pt-1 text-sm font-semibold">{user.name}</p>
        <ul className="flex flex-col gap-0.5">
          <li className={`${row} text-muted`}>
            <User size={16} strokeWidth={1.75} aria-hidden="true" />
            Your profile <Soon />
          </li>
          {MENU_NAV.map((item) => (
            <li key={item.key} className={`${row} text-muted ${item.key === "timetable" ? "min-[760px]:hidden" : ""}`}>
              <item.Icon size={16} strokeWidth={1.75} aria-hidden="true" />
              {item.label} <Soon />
            </li>
          ))}
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
