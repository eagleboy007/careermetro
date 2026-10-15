"use client";

import { ArrowRight, FileText, Search } from "lucide-react";
import Link from "next/link";
import { useRef, useState } from "react";
import { saveStandInTitle } from "@/lib/stand-in-title";

export type RoleOption = { slug: string; title: string; experience: string; topSkills: string[] };
export type SuggestedRole = { slug: string; title: string; experience: string; met: number; total: number; shown: string[]; fits: boolean };
/** A saved job check standing in for a role we don't have (role-suggest-plan.md part B, point 4). */
export type StandInLink = { id: string; title: string; company: string };

/** Shorter than this is too vague to say which role is missing. */
const COUNT_MIN_CHARS = 3;

/** "JavaScript, Node.js and SQL". */
const listWords = (words: string[]) => (words.length < 2 ? words.join("") : `${words.slice(0, -1).join(", ")} and ${words.at(-1)}`);

/**
 * FR-8: pick the target role. Each card opens the Gaps page for that role. `demo` makes the cards inert and counts
 * nothing. `suggestions` (the roles the resume already covers best, src/lib/gaps/suggest.ts) show first when given.
 * "My role isn't listed" leads to a job posting that stands in for the role. Only deliberate actions count a missing
 * role (role_requests, nothing about the person): Enter in a search that finds nothing, and a click on "My role isn't
 * listed" while the search finds nothing (otherwise the stand-in posting counts its title once saved). Typing alone
 * never counts. The typed text goes to the next page through sessionStorage,
 * never the address (role-suggest-plan.md part B).
 */
export function RolePicker({
  resumeId,
  roles,
  suggestions,
  standIns = [],
  demo = false,
}: {
  resumeId: string;
  roles: RoleOption[];
  suggestions?: SuggestedRole[];
  standIns?: StandInLink[];
  demo?: boolean;
}) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const shown = q ? roles.filter((r) => [r.title, ...r.topSkills].some((t) => t.toLowerCase().includes(q))) : roles;
  const typed = q.replace(/\s+/g, " ");

  // Each title is sent once per visit; the server counts it at most once a day per person. keepalive lets the request
  // finish while the page moves on.
  const sent = useRef(new Set<string>());
  const countMissing = (title: string) => {
    if (demo || title.length < COUNT_MIN_CHARS || sent.current.has(title)) return;
    sent.current.add(title);
    fetch("/api/role-requests", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title }), keepalive: true }).catch(
      () => {},
    );
  };

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
      {standIns.length > 0 && (
        <section aria-labelledby="stand-in-checks" className="flex flex-col gap-3">
          <h2 id="stand-in-checks" className="mt-4 text-xl font-semibold">
            Jobs you checked instead
          </h2>
          <ul className="grid gap-3">
            {standIns.map((c) => (
              <li key={c.id} className="flex">
                <Link
                  href={demo ? "#" : `/resume/${resumeId}/job/${c.id}`}
                  prefetch={false}
                  className="group flex min-h-11 flex-1 items-center justify-between gap-3 rounded-lg border border-line bg-surface p-4 transition-colors hover:border-ink"
                >
                  <span className="min-w-0 break-words">
                    <span className="font-semibold">{c.title}</span> <span className="text-muted">at {c.company}</span>
                  </span>
                  <ArrowRight size={18} strokeWidth={1.75} className="shrink-0 text-muted group-hover:text-ink" aria-hidden="true" />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
      {suggestions && <h2 className="mt-4 text-xl font-semibold">All roles</h2>}
      <label className="flex items-center gap-2 rounded-full border border-line-strong bg-surface px-4 py-2.5 focus-within:border-ink focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-accent">
        <Search size={18} strokeWidth={1.75} className="text-muted" aria-hidden="true" />
        <span className="sr-only">Search roles or skills</span>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && shown.length === 0 && countMissing(typed)}
          placeholder="Search roles or skills, like SQL"
          className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted"
        />
      </label>
      <p aria-live="polite" className="sr-only">
        {q ? `${shown.length} ${shown.length === 1 ? "role" : "roles"} found` : ""}
      </p>
      {shown.length === 0 ? (
        <p className="text-sm text-muted">
          No role matches “<span className="break-words">{query}</span>”. Try a shorter word, or check a job posting for it below.
        </p>
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
      <Link
        href={demo ? "#" : `/resume/${resumeId}/role/other`}
        prefetch={false}
        onClick={() => {
          if (demo) return;
          saveStandInTitle(query);
          // Only a search that found nothing; otherwise the stand-in check counts its title once it is saved.
          if (shown.length === 0) countMissing(typed);
        }}
        className="group flex items-start gap-3 rounded-lg border border-dashed border-line bg-bg p-4 transition-colors hover:border-ink"
      >
        <FileText size={20} strokeWidth={1.75} className="mt-0.5 shrink-0 text-muted group-hover:text-ink" aria-hidden="true" />
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="font-semibold leading-snug">My role isn&apos;t listed</span>
          <span className="text-sm text-muted">Paste a job posting for it. It stands in as your target until we add the role.</span>
        </span>
        <ArrowRight size={18} strokeWidth={1.75} className="mt-0.5 shrink-0 text-muted group-hover:text-ink" aria-hidden="true" />
      </Link>
    </div>
  );
}
