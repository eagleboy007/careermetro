"use client";

import { Check } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { smallButton } from "@/components/gaps/job-check-actions";
import { readApiReply } from "@/lib/api-reply";
import type { ScreeningKeyword } from "@/lib/schemas";

/** Sends "I have this" for one skill. Answers null once saved, else the words to show. `demo` saves nothing. */
async function sendConfirm(resumeId: string, skillId: string, demo: boolean): Promise<string | null> {
  if (demo) return "This is example data, so nothing is saved.";
  try {
    const reply = await readApiReply(
      await fetch(`/api/resume/${resumeId}/keywords`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ skillId }) }),
    );
    return reply.ok ? null : (reply.error ?? "Something went wrong. Please try again.");
  } catch {
    return "We couldn't reach CareerMetro. Check your connection and try again.";
  }
}

/**
 * "I have this" for a keyword the resume doesn't name (FR-34). Nothing is saved until the person says which skill and
 * presses Add; then the skill joins their skills list, listed only, and the page refreshes. It stays a gap and a goal
 * until proved. A "one of these" group asks which of its skills they have.
 */
export function ConfirmKeyword({ resumeId, keyword, demo = false }: { resumeId: string; keyword: ScreeningKeyword; demo?: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [sending, setSending] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [added, setAdded] = useState<string | null>(null);
  const [, startRefresh] = useTransition();
  const opener = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const done = useRef<HTMLSpanElement>(null);
  const moved = useRef<"open" | "closed" | "added" | null>(null);
  // Focus follows what replaced the button pressed, and never drops to the page.
  useEffect(() => {
    if (moved.current === "open") panel.current?.querySelector("button")?.focus();
    if (moved.current === "closed") opener.current?.focus();
    if (moved.current === "added") done.current?.focus();
    moved.current = null;
  }, [open, added]);

  async function add(skillId: string, skillName: string) {
    setError("");
    setSending(skillId);
    const failed = await sendConfirm(resumeId, skillId, demo);
    setSending(null);
    if (failed) {
      setError(failed);
      return;
    }
    moved.current = "added";
    setAdded(skillName);
    setOpen(false);
    startRefresh(() => router.refresh());
  }

  if (added) {
    return (
      <span ref={done} tabIndex={-1} role="status" className="inline-flex min-h-11 items-center gap-1.5 text-[0.8rem] font-semibold text-muted focus:outline-none">
        <Check size={14} strokeWidth={1.75} aria-hidden="true" />
        Added {added} to your skills list
      </span>
    );
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
        <span role="alert" className="text-xs text-bad">
          {error}
        </span>
      )}
    </span>
  );
}
