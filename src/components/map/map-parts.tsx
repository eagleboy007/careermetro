import { ArrowRight, Users, type LucideIcon } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

/* Pieces shared by the Role line and the Life line on the Map. */

export const ICON = { strokeWidth: 1.75, "aria-hidden": true } as const;

export type Item = { Icon: LucideIcon; title: string; detail: string };

export const seg =
  "rounded-full px-3 py-[5px] text-[0.82rem] font-[550] text-muted aria-pressed:bg-surface aria-pressed:text-ink aria-pressed:shadow-[0_1px_2px_var(--shadow)]";
export const ghost = "inline-flex items-center gap-2 rounded-full border border-line bg-surface px-3.5 py-2 text-[0.84rem] font-medium text-ink hover:bg-surface-2";

export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export function Key({ swatch, children }: { swatch: string; children: ReactNode }) {
  return (
    <li className="inline-flex items-center gap-[7px]">
      <i className={`inline-block h-1.5 w-[22px] rounded-full ${swatch}`} />
      {children}
    </li>
  );
}

export function Panel({ kicker, title, children }: { kicker: string; title: string; children: ReactNode }) {
  return (
    <div className="flex animate-[sheet-in_.3s_cubic-bezier(.2,.8,.2,1)] flex-col gap-3.5 [&>p]:text-[0.88rem] [&>p]:text-muted">
      <span className="font-mono text-[0.72rem] uppercase tracking-[0.06em] text-muted">{kicker}</span>
      <h3 className="text-[1.35rem] font-semibold leading-[1.15]">{title}</h3>
      {children}
    </div>
  );
}

export const Label = ({ children }: { children: ReactNode }) => (
  <span className="font-mono text-[0.72rem] uppercase tracking-[0.06em] text-muted">{children}</span>
);

export function List({ items }: { items: Item[] }) {
  return (
    <ul className="flex flex-col gap-1.5">
      {items.map(({ Icon, title, detail }, i) => (
        <li key={i} className="flex items-center gap-2.5 rounded-md bg-surface-2 px-[11px] py-[9px] text-[0.84rem]">
          <Icon size={16} className="shrink-0 text-muted" {...ICON} />
          <span className="min-w-0 flex-1">{title}</span>
          <small className="max-w-[45%] text-right font-mono text-[0.7rem] text-muted">{detail}</small>
        </li>
      ))}
    </ul>
  );
}

export function Cta({ href, ghost: isGhost = false, children }: { href: string; ghost?: boolean; children: ReactNode }) {
  return (
    <div className="flex">
      <Link
        href={href}
        className={
          isGhost
            ? ghost
            : "inline-flex items-center gap-2 rounded-full bg-accent px-3.5 py-2 text-[0.84rem] font-medium text-on-accent hover:opacity-90"
        }
      >
        {children}
        <ArrowRight size={16} {...ICON} />
      </Link>
    </div>
  );
}

export const Soon = ({ children }: { children: ReactNode }) => (
  <span className="inline-flex items-center gap-2 text-[0.84rem] font-medium text-muted">
    <Users size={16} {...ICON} />
    {children} · soon
  </span>
);

