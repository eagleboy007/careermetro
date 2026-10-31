"use client";

import { ArrowBigUp, Flag, Trash2 } from "lucide-react";
import { useId, useRef, useState, useTransition, type FormEvent } from "react";
import { FieldError } from "@/components/ui/field-error";
import { istDayWords } from "@/lib/day-words";
import { agoWords, type CommentActions } from "@/lib/junction/types";
import { JUNCTION_COMMENT_MAX } from "@/lib/schemas/constants";
import type { CommentView } from "@/lib/schemas/junction";
import { DeleteConfirm, HeldNotice, HiddenNotice, JunctionReportPanel } from "./post-card";
import { field, ICON, ink, quiet, toggle } from "./styles";

const FAILED = "That didn't work. Please try again.";

/** One comment: the author, the text, an upvote (not your own), and Report or Delete inline. */
function CommentRow({ comment, now, actions }: { comment: CommentView; now: string; actions?: CommentActions }) {
  const [voted, setVoted] = useState(comment.voted);
  const [upvotes, setUpvotes] = useState(comment.upvotes);
  const [panel, setPanel] = useState<"report" | "delete" | null>(null);
  const bar = useRef<HTMLDivElement>(null);
  const close = () => {
    setPanel(null);
    requestAnimationFrame(() => bar.current?.querySelector<HTMLElement>("button")?.focus());
  };
  const [message, setMessage] = useState<string | null>(null);
  const [gone, setGone] = useState(false);
  const [pending, start] = useTransition();
  const own = comment.author.isYou;
  if (gone)
    return (
      <li role="status" className="py-3 text-[0.84rem] text-muted">
        Comment deleted.
      </li>
    );
  const vote = () => {
    if (pending || own) return;
    if (!actions) {
      setVoted(!voted);
      setUpvotes((n) => n + (voted ? -1 : 1));
      return;
    }
    start(async () => {
      const r = await actions.vote(comment.id).catch(() => ({ ok: false as const, message: FAILED }));
      if (!r.ok) return setMessage(r.message);
      setMessage(null);
      if (r.on !== voted) setUpvotes((n) => Math.max(0, n + (r.on ? 1 : -1)));
      setVoted(r.on);
    });
  };
  return (
    <li className="flex flex-col gap-2 border-t border-line py-3 first:border-t-0">
      <div className="flex flex-wrap items-center gap-x-2 text-[0.8rem] text-muted">
        <span aria-hidden="true" className="grid size-7 place-items-center rounded-full bg-surface-2 text-[0.62rem] font-semibold text-ink">
          {comment.author.initials}
        </span>
        <span className="font-semibold text-ink">
          {comment.author.name}
          {own && <span className="font-normal text-muted"> (you)</span>}
        </span>
        <span>· {agoWords(comment.createdAt, now, (at) => istDayWords(at))}</span>
      </div>
      {own && comment.status === "held" && <HeldNotice what="comment" />}
      {own && comment.status === "hidden" && <HiddenNotice what="comment" appealHref="/junction/mine" />}
      <p className="whitespace-pre-line break-words text-[0.88rem] text-ink">{comment.body}</p>
      <div ref={bar} className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          className={toggle}
          aria-pressed={voted}
          aria-disabled={pending || own || undefined}
          title={own ? "You can't upvote your own comment." : undefined}
          onClick={vote}
        >
          <ArrowBigUp {...ICON} />
          {voted ? "Upvoted" : "Upvote"} <span className="tabular-nums">{upvotes}</span>
          <span className="sr-only">{upvotes === 1 ? "vote" : "votes"}</span>
        </button>
        {own ? (
          <button type="button" className={quiet} onClick={() => setPanel(panel === "delete" ? null : "delete")}>
            <Trash2 {...ICON} />
            Delete
          </button>
        ) : (
          <button type="button" className={quiet} onClick={() => setPanel(panel === "report" ? null : "report")}>
            <Flag {...ICON} />
            Report
          </button>
        )}
      </div>
      {message && (
        <p role="alert" className="text-[0.84rem] font-medium text-ink">
          {message}
        </p>
      )}
      {panel === "report" && <JunctionReportPanel target="comment" targetId={comment.id} onReport={actions?.report} onClose={close} />}
      {panel === "delete" && (
        <DeleteConfirm
          what="comment"
          busy={pending}
          onKeep={close}
          onDelete={() =>
            start(async () => {
              const r = actions ? await actions.remove(comment.id).catch(() => ({ ok: false as const, message: FAILED })) : { ok: true as const };
              if (r.ok) setGone(true);
              else setMessage(r.message);
            })
          }
        />
      )}
    </li>
  );
}

/** A post's comments, oldest first. */
export function CommentList({ comments, now, actions }: { comments: CommentView[]; now: string; actions?: CommentActions }) {
  if (!comments.length) return <p className="text-[0.86rem] text-muted">No comments yet. Be the first to answer.</p>;
  return (
    <ul aria-label="Comments" className="flex flex-col">
      {comments.map((c) => (
        <CommentRow key={c.id} comment={c} now={now} actions={actions} />
      ))}
    </ul>
  );
}

/** The comment box: 1 to 1,000 characters, no links, no phone numbers or email addresses. */
export function CommentBox({ postId, actions, closed }: { postId: string; actions?: CommentActions; closed?: string }) {
  const ids = useId();
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const box = useRef<HTMLTextAreaElement>(null);
  if (closed) return <p className="text-[0.84rem] text-muted">{closed}</p>;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (pending) return;
    if (!text.trim()) {
      setError("Write a comment first.");
      box.current?.focus();
      return;
    }
    start(async () => {
      const r = actions ? await actions.add(postId, text).catch(() => ({ ok: false as const, message: FAILED })) : { ok: true as const };
      if (r.ok) {
        setText("");
        setError(null);
        setDone("Comment posted.");
        box.current?.focus();
      } else {
        setError(r.message);
        setDone(null);
        box.current?.focus();
      }
    });
  };
  return (
    <form onSubmit={submit} className="flex flex-col gap-2">
      <label htmlFor={`${ids}-c`} className="text-[0.84rem] font-semibold text-ink">
        Add a comment
      </label>
      <textarea
        id={`${ids}-c`}
        ref={box}
        rows={3}
        className={field}
        value={text}
        maxLength={JUNCTION_COMMENT_MAX}
        aria-invalid={error ? true : undefined}
        aria-describedby={`${ids}-h${error ? ` ${ids}-e` : ""}`}
        onChange={(e) => setText(e.target.value)}
      />
      <small id={`${ids}-h`} className="text-[0.76rem] text-muted">
        {text.length} of {JUNCTION_COMMENT_MAX.toLocaleString("en-IN")} characters. No links, phone numbers or email addresses.
      </small>
      <FieldError id={`${ids}-e`} message={error ?? undefined} />
      <p role="status" className="text-[0.82rem] text-muted">
        {done}
      </p>
      <button type="submit" className={`${ink} self-start`} aria-disabled={pending}>
        Post comment
      </button>
    </form>
  );
}
