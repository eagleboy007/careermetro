"use client";

import { CircleAlert } from "lucide-react";
import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { smallButton } from "@/components/gaps/job-check-actions";
import { readApiReply } from "@/lib/api-reply";
import type { ScreeningKeyword, ScreeningTarget } from "@/lib/schemas";

/** Sends "I have this" for one skill. Answers null once saved, else the words to show. `demo` saves nothing. */
async function sendConfirm(resumeId: string, body: { skillId: string; target: ScreeningTarget; version: number }, demo: boolean): Promise<string | null> {
  if (demo) return "This is example data, so nothing is saved.";
  try {
    const reply = await readApiReply(
      await fetch(`/api/resume/${resumeId}/keywords`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
    );
    return reply.ok ? null : (reply.error ?? "Something went wrong. Please try again.");
  } catch {
    return "We couldn't reach CareerMetro. Check your connection and try again.";
  }
}

/** Tells the section a skill was added: it says so in its live region, refreshes the page and then moves focus. */
const Announce = createContext<((message: string) => void) | null>(null);

/**
 * Wraps a screening section (or a job check result) that has "I have this" buttons. Its live region stays mounted
 * while the page refreshes and the row that was pressed disappears, so the confirmation is always read out; once the
 * refresh lands, focus moves to the section's heading (`headingId`, which needs tabIndex -1) instead of the page.
 */
export function KeywordAnnouncer({ headingId, children }: { headingId: string; children: ReactNode }) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [refreshing, startRefresh] = useTransition();
  const waiting = useRef(false);
  useEffect(() => {
    if (refreshing || !waiting.current) return;
    waiting.current = false;
    document.getElementById(headingId)?.focus();
  }, [refreshing, headingId]);
  const announce = useCallback(
    (text: string) => {
      setMessage(text);
      waiting.current = true;
      startRefresh(() => router.refresh());
    },
    [router],
  );
  return (
    <Announce.Provider value={announce}>
      {children}
      <p role="status" aria-live="polite" className="text-sm font-medium text-muted">
        {message}
      </p>
    </Announce.Provider>
  );
}

/**
 * "I have this" for a keyword the resume doesn't name (FR-34). Nothing is saved until the person says which skill and
 * presses Add; then the skill joins their skills list, listed only, for this `target` on the profile `version` the
 * page showed, and the page refreshes. It stays a gap and a goal until proved. A "one of these" group asks which of its
 * skills they have. Must sit inside a KeywordAnnouncer.
 */
export function ConfirmKeyword({
  resumeId,
  keyword,
  target,
  version,
  demo = false,
}: {
  resumeId: string;
  keyword: ScreeningKeyword;
  target: ScreeningTarget;
  version: number;
  demo?: boolean;
}) {
  const announce = useContext(Announce);
  const [open, setOpen] = useState(false);
  const [sending, setSending] = useState<string | null>(null);
  const [error, setError] = useState("");
  const opener = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const moved = useRef<"open" | "closed" | null>(null);
  // Focus follows what replaced the button pressed, and never drops to the page.
  useEffect(() => {
    if (moved.current === "open") panel.current?.querySelector("button")?.focus();
    if (moved.current === "closed") opener.current?.focus();
    moved.current = null;
  }, [open]);

  async function add(skillId: string, skillName: string) {
    setError("");
    setSending(skillId);
    const failed = await sendConfirm(resumeId, { skillId, target, version }, demo);
    setSending(null);
    if (failed) {
      setError(failed);
      return;
    }
    announce?.(`Added ${skillName} to your skills list. It stays a goal until you prove it.`);
  }

  const group = keyword.options.length > 1;
  return (
    <span className="flex w-full flex-col items-stretch gap-2 sm:w-auto sm:items-end">
      {!open && (
        <button
          ref={opener}
          type="button"
          aria-label={`I have this: ${keyword.skillName}`}
          onClick={() => {
            moved.current = "open";
            setOpen(true);
          }}
          className={`${smallButton} self-start sm:self-end`}
        >
          I have this
        </button>
      )}
      {open && (
        <div ref={panel} className="flex flex-col gap-2 rounded-md border border-line bg-surface-2 p-3 text-sm">
          <p>
            {group ? "Which one do you have? " : `Add ${keyword.skillName} to the skills list on your resume? `}
            We add only the skill&apos;s name. It stays a goal until you prove it.
          </p>
          <div className="flex flex-wrap gap-2">
            {keyword.options.map((o) => (
              <button key={o.skillId} type="button" disabled={sending !== null} onClick={() => add(o.skillId, o.skillName)} className={smallButton}>
                {sending === o.skillId ? "Adding…" : `Add ${o.skillName}`}
              </button>
            ))}
            <button
              type="button"
              disabled={sending !== null}
              onClick={() => {
                setError("");
                moved.current = "closed";
                setOpen(false);
              }}
              className={smallButton}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
      {error && (
        <span role="alert" className="inline-flex items-start gap-1.5 text-xs text-ink">
          <CircleAlert size={14} strokeWidth={1.75} aria-hidden="true" className="mt-px shrink-0" />
          {error}
        </span>
      )}
    </span>
  );
}
