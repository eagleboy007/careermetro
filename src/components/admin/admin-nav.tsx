import Link from "next/link";

/** Links between CareerMetro's own admin pages. Neutral: the current page is marked with weight and aria-current. */
const PAGES = [
  { key: "companies", href: "/admin/companies", label: "Company review" },
  { key: "proofs", href: "/admin/proofs", label: "Held proofs" },
  { key: "reports", href: "/admin/reports", label: "Reports" },
] as const;

export function AdminNav({ current }: { current: (typeof PAGES)[number]["key"] }) {
  return (
    <nav aria-label="Admin pages" className="mx-auto w-full max-w-[920px]">
      <ul className="flex flex-wrap gap-2">
        {PAGES.map((p) => (
          <li key={p.key}>
            <Link
              href={p.href}
              aria-current={p.key === current ? "page" : undefined}
              className="inline-flex min-h-11 items-center rounded-full border border-line px-4 text-[0.86rem] text-ink hover:bg-surface-2 aria-[current=page]:border-ink aria-[current=page]:font-semibold"
            >
              {p.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
