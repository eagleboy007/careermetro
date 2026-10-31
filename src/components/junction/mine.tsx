"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState, useTransition } from "react";
import { FieldError } from "@/components/ui/field-error";
import { istDayWords } from "@/lib/day-words";
import type { MineActions, MineTab } from "@/lib/junction/types";
import { JUNCTION_APPEAL_NOTE_MAX } from "@/lib/schemas/constants";
import type { RemovalNotice } from "@/lib/schemas/junction";
import { card, field, ghost, ink, quiet } from "./styles";

const FAILED = "That didn't work. Please try again.";

/** Your posts and Saved, as links (each tab has its own address). */
export function MineTabs({ tab }: { tab: MineTab }) {
  const tabs: { key: MineTab; label: string }[] = [
    { key: "posts", label: "Your posts" },
    { key: "saved", label: "Saved" },
  ];
  return (
    <nav aria-label="Your Junction" className="flex gap-1 border-b border-line">
      {tabs.map((t) => (
        <Link
          key={t.key}
          href={t.key === "posts" ? "/junction/mine" : "/junction/mine?tab=saved"}
          aria-current={t.key === tab ? "page" : undefined}
          className="inline-flex min-h-11 items-center border-b-2 border-transparent px-3 text-[0.86rem] font-medium text-muted hover:text-ink aria-[current=page]:border-ink aria-[current=page]:font-semibold aria-[current=page]:text-ink"
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}

/** The appeal: why you think the removal was wrong, once, within 30 days. */
export function AppealForm({ removalId, onAppeal, onDone }: { removalId: string; onAppeal?: MineActions["appeal"]; onDone: (message: string) => void }) {
  const ids = useId();
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const box = useRef<HTMLTextAreaElement>(null);
  // Opened by Appeal, which goes away: focus moves into the box, never to the page.
  useEffect(() => box.current?.focus(), []);
  return (
    <form
      aria-label="Appeal"
      className="flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (pending) return;
        if (!text.trim()) {
          setError("Write why, in 1 to 1,000 characters.");
          box.current?.focus();
          return;
        }
        start(async () => {
          const r = onAppeal ? await onAppeal(removalId, text).catch(() => ({ ok: false as const, message: FAILED })) : { ok: true as const, message: "Example only: nothing was sent." };
          if (r.ok) onDone(r.message ?? "Appeal sent.");
          else {
            setError(r.message);
            box.current?.focus();
          }
        });
      }}
    >
      <label htmlFor={`${ids}-n`} className="text-[0.84rem] font-semibold">
        Why should it come back?
      </label>
      <textarea
        id={`${ids}-n`}
        ref={box}
        rows={3}
        className={field}
        value={text}
        maxLength={JUNCTION_APPEAL_NOTE_MAX}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${ids}-e` : undefined}
        onChange={(e) => setText(e.target.value)}
      />
      <FieldError id={`${ids}-e`} message={error ?? undefined} />
      <button type="submit" className={`${ink} self-start`} aria-disabled={pending}>
        Send appeal
      </button>
    </form>
  );
}

const appealWords = (n: RemovalNotice): string | null => {
  if (!n.appeal) return null;
  if (n.appeal.status === "open") return "You appealed. We decide within 15 days and tell you in your notifications.";
  if (n.appeal.status === "reversed") return "We looked at your appeal and brought it back.";
  return "We looked at your appeal. It stays hidden.";
};

/** One notice on your own hidden post or comment: the rule, when, and the appeal or its outcome. */
function NoticeRow({ notice, onAppeal }: { notice: RemovalNotice; onAppeal?: MineActions["appeal"] }) {
  const [open, setOpen] = useState(false);
  const [sent, setSent] = useState<string | null>(null);
  const what = notice.target === "post" ? "post" : "comment";
  const outcome = sent ?? appealWords(notice);
  const said = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (sent) said.current?.focus();
  }, [sent]);
  return (
    <li className={card}>
      <p className="text-[0.9rem] font-semibold">
        CareerMetro hid your {what} on {istDayWords(notice.removedAt, { year: true })} after a report.
      </p>
      <p className="text-[0.86rem]">Rule: {notice.rule}</p>
      {outcome && (
        <p ref={said} tabIndex={-1} role={sent ? "status" : undefined} className="text-[0.84rem] text-muted">
          {outcome}
        </p>
      )}
      {!sent && notice.canAppeal && (
        <>
          <p className="text-[0.84rem] text-muted">You can appeal until {istDayWords(notice.appealBy, { year: true })}. A person at CareerMetro reads it.</p>
          {open ? (
            <>
              <AppealForm removalId={notice.removalId} onAppeal={onAppeal} onDone={setSent} />
              <button type="button" className={`${quiet} self-start`} onClick={() => setOpen(false)}>
                Cancel
              </button>
            </>
          ) : (
            <button type="button" className={`${ghost} self-start`} onClick={() => setOpen(true)}>
              Appeal
            </button>
          )}
        </>
      )}
      {!sent && !notice.canAppeal && !notice.appeal && (
        <p className="text-[0.84rem] text-muted">
          The 30 days to appeal have passed. You can still write to the{" "}
          <Link href="/grievances" className="font-semibold text-ink underline underline-offset-2">
            grievance officer
          </Link>
          .
        </p>
      )}
    </li>
  );
}

/** Removal notices on your own posts and comments (plan section 2.6), newest first, each with its appeal. */
export function RemovalNotices({ notices, onAppeal }: { notices: RemovalNotice[]; onAppeal?: MineActions["appeal"] }) {
  if (!notices.length) return null;
  return (
    <section aria-labelledby="junction-notices" className="flex flex-col gap-2">
      <h2 id="junction-notices" className="text-[1.08rem] font-semibold">
        Notices
      </h2>
      <ul className="flex flex-col gap-2">
        {notices.map((n) => (
          <NoticeRow key={n.removalId} notice={n} onAppeal={onAppeal} />
        ))}
      </ul>
    </section>
  );
}
