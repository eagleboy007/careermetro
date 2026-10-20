"use client";

import { UserX } from "lucide-react";
import { useEffect, useRef, useState, useTransition } from "react";

const ICON = { size: 16, strokeWidth: 1.75, "aria-hidden": true } as const;
const ghostSm =
  "inline-flex min-h-11 items-center gap-1.5 rounded-full border border-line bg-surface px-3 text-[0.8rem] font-medium text-ink hover:bg-surface-2 aria-disabled:opacity-60";

/** A person the signed-in person blocked, as Settings lists them: name and the day, nothing else. */
export type BlockedPersonLine = { id: string; name: string; since: string };

/**
 * "Blocked people" in Settings > Privacy (gap list item 34, handoff 12j: "Unblock in Account settings"). People blocked
 * from Network or the Inbox. Unblock is silent: they aren't told, and a connection or request the block ended stays
 * ended. Without an action (example data, /design) the buttons do nothing.
 */
export function BlockedPeople({ people, unblock }: { people: BlockedPersonLine[]; unblock?: (id: string) => Promise<string | null> }) {
  const [list, setList] = useState(people);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const statusRef = useRef<HTMLParagraphElement>(null);
  // The button pressed goes with its row, so focus moves to the line saying what happened, never to the page.
  const [focusTick, setFocusTick] = useState(0);
  useEffect(() => {
    if (focusTick) statusRef.current?.focus();
  }, [focusTick]);

  const run = (person: BlockedPersonLine) => {
    if (pending) return;
    if (!unblock) {
      setMessage("Example data: nothing changes here.");
      setFocusTick((n) => n + 1);
      return;
    }
    start(async () => {
      const error = await unblock(person.id).catch(() => "That didn't work. Please try again.");
      if (error) setMessage(error);
      else {
        setList((rows) => rows.filter((r) => r.id !== person.id));
        setMessage(`Unblocked ${person.name}. They aren't told.`);
      }
      setFocusTick((n) => n + 1);
    });
  };

  return (
    <div className="flex min-w-0 flex-col gap-1.5" data-blocked-people>
      <h3 className="text-[0.82rem] font-semibold">Blocked people</h3>
      <small className="text-[0.78rem] text-muted">
        People you blocked on Network or in the Inbox. You don&apos;t see each other in search, lists or profiles, and neither of you can message the
        other.
      </small>
      {list.length ? (
        <ul className="flex flex-col divide-y divide-line overflow-hidden rounded-[14px] border border-line">
          {list.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center gap-3 px-3.5 py-2">
              <span className="grid size-[30px] shrink-0 place-items-center rounded-[10px] bg-surface-2">
                <UserX {...ICON} />
              </span>
              <span className="min-w-0 flex-1">
                <b className="block text-[0.9rem] font-semibold [overflow-wrap:anywhere]">{p.name}</b>
                <small className="block text-[0.78rem] text-muted">Blocked since {p.since}</small>
              </span>
              <button type="button" className={ghostSm} aria-disabled={pending || undefined} onClick={() => run(p)}>
                Unblock<span className="sr-only"> {p.name}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[0.82rem] text-muted">You haven&apos;t blocked anyone.</p>
      )}
      <p ref={statusRef} tabIndex={-1} role="status" className="text-[0.78rem] text-muted outline-none empty:hidden">
        {message}
      </p>
    </div>
  );
}
