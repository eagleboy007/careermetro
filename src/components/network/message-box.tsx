"use client";

import Link from "next/link";
import { useId, useState } from "react";
import { MESSAGE_MAX_CHARS } from "@/lib/schemas/constants";

const ink = "inline-flex min-h-11 items-center gap-1.5 rounded-full bg-ink px-3.5 text-[0.82rem] font-medium text-bg hover:opacity-90 aria-disabled:opacity-60";
const quiet = "inline-flex min-h-11 items-center gap-1.5 rounded-full px-3 text-[0.82rem] font-medium text-muted hover:text-ink aria-disabled:opacity-60";

/**
 * Message a connection, inline under their row or profile header (handoff 12j: no pop-ups). Between connections the
 * chat opens at once, so the message lands in both Inboxes; "Open Inbox" follows it there.
 */
export function MessageBox({ name, busy, onSend, onCancel }: { name: string; busy?: true; onSend: (body: string) => void; onCancel: () => void }) {
  const id = useId();
  const [body, setBody] = useState("");
  return (
    <form
      className="flex flex-col gap-2 rounded-md bg-surface-2 p-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!busy && body.trim()) onSend(body);
      }}
    >
      <label htmlFor={id} className="text-[0.86rem] font-semibold">
        Message {name}
      </label>
      <textarea
        id={id}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        maxLength={MESSAGE_MAX_CHARS}
        rows={3}
        className="min-h-20 rounded-md border border-line-strong bg-bg px-3 py-2 text-[0.9rem] text-ink outline-none focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
      />
      <small className="text-[0.78rem] text-muted">You are connected, so this opens a chat in both your Inboxes.</small>
      <div className="flex flex-wrap items-center gap-1.5">
        <button type="submit" className={ink} aria-disabled={busy || !body.trim() || undefined}>
          Send
        </button>
        <button type="button" className={quiet} onClick={onCancel}>
          Cancel
        </button>
        <Link href="/inbox" className={quiet}>
          Open Inbox
        </Link>
      </div>
    </form>
  );
}
