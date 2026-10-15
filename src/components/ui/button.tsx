import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

type Variant = "primary" | "ghost";

const base =
  "inline-flex items-center justify-center gap-2 rounded-full px-4 py-2.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60 aria-disabled:cursor-not-allowed aria-disabled:opacity-60";
const variants: Record<Variant, string> = {
  primary: "bg-accent text-on-accent hover:opacity-90",
  ghost: "border border-line text-ink hover:bg-surface-2",
};

/**
 * `busy` is for a button whose work is under way: it looks and reads as unavailable, but unlike `disabled` it keeps
 * keyboard focus, which would otherwise drop to the page (WCAG 2.4.3). The caller ignores presses while busy (for a
 * submit button, its form's onSubmit does).
 */
export function Button({
  variant = "primary",
  className = "",
  busy,
  ...props
}: ComponentProps<"button"> & { variant?: Variant; busy?: boolean }) {
  return <button className={`${base} ${variants[variant]} ${className}`} aria-disabled={busy || undefined} {...props} />;
}

export function ButtonLink({
  href,
  variant = "primary",
  className = "",
  children,
}: {
  href: string;
  variant?: Variant;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Link href={href} className={`${base} ${variants[variant]} ${className}`}>
      {children}
    </Link>
  );
}
