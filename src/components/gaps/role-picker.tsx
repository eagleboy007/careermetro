"use client";

import { ArrowRight, Search } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

export type RoleOption = { slug: string; title: string; experience: string; topSkills: string[] };
export type SuggestedRole = { slug: string; title: string; experience: string; met: number; total: number; shown: string[]; fits: boolean };

/** "JavaScript, Node.js and SQL". */
const listWords = (words: string[]) => (words.length < 2 ? words.join("") : `${words.slice(0, -1).join(", ")} and ${words.at(-1)}`);

/**
 * FR-8: pick the target role. Each card opens the Gaps page for that role. `demo` makes the cards inert. `suggestions`
 * (the roles the resume already covers best, src/lib/gaps/suggest.ts) show first when given.
 */
export function RolePicker({ resumeId, roles, suggestions, demo = false }: { resumeId: string; roles: RoleOption[]; suggestions?: SuggestedRole[]; demo?: boolean }) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const shown = q ? roles.filter((r) => [r.title, ...r.topSkills].some((t) => t.toLowerCase().includes(q))) : roles;

  const href = (slug: string) => (demo ? "#" : `/resume/${resumeId}/gaps/${slug}`);

  return (
    <div className="flex flex-col gap-4">
      {suggestions && (
        <section aria-labelledby="suggested-roles" className="flex flex-col gap-3">
          <div className="flex flex-col gap-0.5">
            <h2 id="suggested-roles" className="text-xl font-semibold">
              Closest to your resume
            </h2>
            <p className="text-sm text-muted">
              {suggestions.length
                ? "The roles your resume already covers best. Not sure? Start with one; you can pick another any time."
                : "None of our roles is a close match for your resume yet. Search all roles below."}
            </p>
          </div>
          {suggestions.length > 0 && (
            <ul className="grid gap-3">
              {suggestions.map((r) => (
                <li key={r.slug} className="flex">
                  <Link
                    href={href(r.slug)}
                    prefetch={false}
                    className="group flex flex-1 flex-col gap-2 rounded-lg border border-line bg-surface p-4 transition-colors hover:border-ink"
                  >
                    <span className="flex items-start justify-between gap-3">
                      <span className="font-semibold leading-snug">{r.title}</span>
                      <ArrowRight size={18} strokeWidth={1.75} className="mt-0.5 shrink-0 text-muted group-hover:text-ink" aria-hidden="true" />
                    </span>
                    <span className="font-mono text-xs uppercase tracking-wider text-muted">{r.experience}</span>
                    <span className="text-sm text-ink">
                      Your resume shows {r.met} of its {r.total} key skills, like {listWords(r.shown)}.
                    </span>
                    {!r.fits && <span className="text-sm text-muted">It usually asks for more experience than your resume shows.</span>}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
      {suggestions && <h2 className="mt-4 text-xl font-semibold">All roles</h2>}
      <label className="flex items-center gap-2 rounded-full border border-line bg-surface px-4 py-2.5 focus-within:border-ink focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-accent">
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
                href={href(r.slug)}
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
