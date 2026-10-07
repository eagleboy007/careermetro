"use client";

import { ArrowRight, Search } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

export type RoleOption = { slug: string; title: string; experience: string; topSkills: string[] };

/** FR-8: pick the target role. Each card opens the Gaps page for that role. `demo` makes the cards inert. */
export function RolePicker({ resumeId, roles, demo = false }: { resumeId: string; roles: RoleOption[]; demo?: boolean }) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const shown = q ? roles.filter((r) => [r.title, ...r.topSkills].some((t) => t.toLowerCase().includes(q))) : roles;

  return (
    <div className="flex flex-col gap-4">
      <label className="flex items-center gap-2 rounded-full border border-line bg-surface px-4 py-2.5 focus-within:border-ink">
        <Search size={18} strokeWidth={1.75} className="text-muted" aria-hidden="true" />
        <span className="sr-only">Search roles or skills</span>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search roles or skills, like SQL"
          className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted"
        />
      </label>
      <p aria-live="polite" className="sr-only">
        {q ? `${shown.length} ${shown.length === 1 ? "role" : "roles"} found` : ""}
      </p>
      {shown.length === 0 ? (
        <p className="text-sm text-muted">No role matches “{query}”. Try a shorter word.</p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {shown.map((r) => (
            <li key={r.slug} className="flex">
              <Link
                href={demo ? "#" : `/resume/${resumeId}/gaps/${r.slug}`}
                // The Gaps page may call the model, so it only loads when chosen.
                prefetch={false}
                className="group flex flex-1 flex-col gap-2 rounded-lg border border-line bg-surface p-4 transition-colors hover:border-ink"
              >
                <span className="flex items-start justify-between gap-3">
                  <span className="font-semibold leading-snug">{r.title}</span>
                  <ArrowRight size={18} strokeWidth={1.75} className="mt-0.5 shrink-0 text-muted group-hover:text-ink" aria-hidden="true" />
                </span>
                <span className="font-mono text-xs uppercase tracking-wider text-muted">{r.experience}</span>
                {r.topSkills.length > 0 && <span className="text-sm text-muted">Most asked: {r.topSkills.join(", ")}</span>}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
